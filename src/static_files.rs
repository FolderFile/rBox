use crate::error::{other, Result};
use axum::http::Uri;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "web/dist/"]
struct Assets;

/// embedded SPA shell, shared by the fallback and the share landing handler
pub fn index_bytes() -> Result<rust_embed::EmbeddedFile> {
    Assets::get("index.html").ok_or_else(|| other("frontend is not embedded in this build"))
}

/// asset-like requests must never receive the HTML fallback: a stale tab
/// asking for a retired hashed chunk would otherwise load index.html as a
/// module script and die on a blank white page. serve it a real 404 instead
/// so the browser can surface the failure and the tab reloads cleanly.
fn is_asset_request(path: &str) -> bool {
    if path.starts_with("assets/") {
        return true;
    }
    let lower = path.to_lowercase();
    [
        ".js", ".mjs", ".css", ".map", ".wasm", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico",
        ".gif", ".woff", ".woff2", ".ttf", ".mp4", ".mp3",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

/// embedded SPA. any non-GET (or missing) asset falls back to index.html so
/// client-side routing works; hashed files under /assets/ get immutable
/// caching, everything else revalidates on each load.
pub async fn serve(uri: Uri) -> Result<Response> {
    let path = uri.path().trim_start_matches('/');

    let (asset, cache, mime) = match Assets::get(path) {
        Some(a) => {
            let mime = mime_guess::from_path(uri.path())
                .first_or_octet_stream()
                .to_string();
            (a, immutable_cache(path), mime)
        }
        None => {
            if is_asset_request(path) {
                return Err(crate::error::AppError::NotFound("asset not found".into()));
            }
            // client-side route: always the SPA shell, so always text/html
            (
                index_bytes()?,
                "no-cache".to_string(),
                "text/html".to_string(),
            )
        }
    };
    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_str(&mime).map_err(|e| other(e.to_string()))?,
            ),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_str(&cache).map_err(|e| other(e.to_string()))?,
            ),
        ],
        asset.data,
    )
        .into_response())
}

fn immutable_cache(path: &str) -> String {
    // vite emits content-hashed names under assets/, so those are safe to
    // pin; everything else gets revalidated
    if path.starts_with("assets/") {
        "public, max-age=31536000, immutable".to_string()
    } else {
        "no-cache".to_string()
    }
}
