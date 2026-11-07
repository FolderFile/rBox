use crate::error::{other, Result};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
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
pub async fn serve(uri: Uri, headers: HeaderMap) -> Result<Response> {
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
    let key = if Assets::get(path).is_some() {
        path
    } else {
        "index.html"
    };
    let mut res = if compressible(&mime) && accepts_gzip(&headers) {
        let body = gzipped(key, &asset.data);
        let mut res = (StatusCode::OK, body).into_response();
        res.headers_mut()
            .insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
        res
    } else {
        (StatusCode::OK, asset.data.into_owned()).into_response()
    };
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime).map_err(|e| other(e.to_string()))?,
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_str(&cache).map_err(|e| other(e.to_string()))?,
    );
    h.insert(header::VARY, HeaderValue::from_static("accept-encoding"));
    Ok(res)
}

fn compressible(mime: &str) -> bool {
    mime.starts_with("text/")
        || matches!(
            mime,
            "application/javascript" | "application/json" | "image/svg+xml" | "application/wasm"
        )
}

fn accepts_gzip(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',').any(|enc| {
                let mut parts = enc.split(';');
                let name = parts.next().unwrap_or("").trim();
                let refused = parts.any(|p| p.trim().replace(' ', "") == "q=0");
                (name.eq_ignore_ascii_case("gzip") || name == "*") && !refused
            })
        })
}

/// the embedded bundle is ~1.6 MB of JS that shrinks ~3-4x; compress each
/// asset once on first request and keep the result for the process lifetime
fn gzipped(key: &str, data: &[u8]) -> bytes::Bytes {
    use std::collections::HashMap;
    use std::io::Write;
    use std::sync::{Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<HashMap<String, bytes::Bytes>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = cache.lock().ok().and_then(|c| c.get(key).cloned()) {
        return hit;
    }
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    let out = enc
        .write_all(data)
        .and_then(|_| enc.finish())
        .map(bytes::Bytes::from)
        .unwrap_or_else(|_| bytes::Bytes::copy_from_slice(data));
    if let Ok(mut c) = cache.lock() {
        c.insert(key.to_string(), out.clone());
    }
    out
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
