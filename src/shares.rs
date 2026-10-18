use crate::auth::AuthUser;
use crate::error::{bad, AppError, Result};
use crate::state::AppState;
use crate::storage;
use crate::transfer;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use rand::distributions::{Alphanumeric, DistString};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

#[derive(Debug, Clone)]
struct Share {
    user_id: i64,
    file_path: String,
    expires_at: Option<i64>,
    password_hash: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateReq {
    path: String,
    expires_in_secs: Option<i64>,
    expires_at: Option<i64>,
    password: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    // tolerate "docs/a.txt" and "/docs/a.txt" alike; the stored path is
    // always the clean relative form shares.rs resolves later
    let rel = req.path.trim_matches(|c| c == '/' || c == '\\');
    let target = storage::sanitize(&root, rel)?;
    if !tokio::fs::try_exists(&target).await? {
        return Err(AppError::NotFound(rel.to_string()));
    }
    if let Some(ref p) = req.password {
        if p.is_empty() {
            return Err(bad("password must not be empty"));
        }
    }
    let expires_at = match (req.expires_at, req.expires_in_secs) {
        (Some(at), _) => Some(at),
        (None, Some(secs)) => Some(Utc::now().timestamp() + secs),
        (None, None) => None,
    };
    if expires_at.is_some_and(|at| at <= Utc::now().timestamp()) {
        return Err(bad("expiry must be in the future"));
    }

    let token = Alphanumeric.sample_string(&mut rand::thread_rng(), 12);
    let hash = match req.password {
        Some(p) => Some(crate::users::hash_password(&p)?),
        None => None,
    };

    let conn = state.conn().await;
    conn.execute(
        "INSERT INTO shares (user_id, file_path, token, expires_at, password_hash)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![auth.user.id, rel, token, expires_at, hash],
    )?;
    Ok(Json(
        serde_json::json!({ "token": token, "path": rel, "expires_at": expires_at }),
    ))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let conn = state.conn().await;
    let mut stmt = conn.prepare(
        "SELECT id, token, file_path, expires_at, password_hash IS NOT NULL
         FROM shares WHERE user_id = ?1 ORDER BY id DESC",
    )?;
    let rows = stmt
        .query_map(params![auth.user.id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<i64>>(3)?,
                r.get::<_, bool>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // files deleted outside the app leave orphan rows; prune them here so
    // the shared-links view only ever shows links that still resolve
    let mut out = Vec::new();
    let mut orphans = Vec::new();
    for (id, token, path, expires_at, requires_password) in rows {
        let alive = storage::sanitize(&root, &path)
            .map(|p| p.exists())
            .unwrap_or(false);
        if alive {
            out.push(serde_json::json!({
                "id": id,
                "token": token,
                "path": path,
                "expires_at": expires_at,
                "requires_password": requires_password,
            }));
        } else {
            orphans.push(token);
        }
    }
    if !orphans.is_empty() {
        for token in &orphans {
            conn.execute(
                "DELETE FROM shares WHERE token = ?1 AND user_id = ?2",
                params![token, auth.user.id],
            )?;
        }
    }
    Ok(Json(serde_json::json!({ "shares": out })))
}

/// drop every share row pointing at `path` or anything underneath it; called
/// when the target is deleted so dead links never linger in the ui
pub fn remove_shares_under(conn: &Connection, user_id: i64, path: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM shares WHERE user_id = ?1 AND (file_path = ?2 OR file_path LIKE ?3 || '/%')",
        params![user_id, path, path],
    )
}

/// rewrite share rows whose target moved so links keep working across
/// renames and moves, children of a moved directory included
pub fn retarget_shares(
    conn: &Connection,
    user_id: i64,
    old_path: &str,
    new_path: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE shares SET file_path = ?4 || substr(file_path, length(?3) + 1)
         WHERE user_id = ?1 AND (file_path = ?2 OR file_path LIKE ?3 || '/%')",
        params![user_id, old_path, old_path, new_path],
    )
}

pub async fn revoke(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let conn = state.conn().await;
    let n = conn.execute(
        "DELETE FROM shares WHERE token = ?1 AND user_id = ?2",
        params![token, auth.user.id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("share '{token}'")));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn find_share(conn: &Connection, token: &str) -> Result<Option<Share>> {
    let share = conn
        .query_row(
            "SELECT user_id, file_path, expires_at, password_hash
             FROM shares WHERE token = ?1",
            params![token],
            |r| {
                Ok(Share {
                    user_id: r.get(0)?,
                    file_path: r.get(1)?,
                    expires_at: r.get(2)?,
                    password_hash: r.get(3)?,
                })
            },
        )
        .optional()?;
    match share {
        // expired shares behave exactly like missing ones
        Some(s) if s.expires_at.is_none_or(|at| at > Utc::now().timestamp()) => Ok(Some(s)),
        _ => Ok(None),
    }
}

/// password arrives via query param or x-share-password header; query keeps it
/// playable in <video> tags and curl-friendly
fn password_from(headers: &HeaderMap, query_password: Option<&str>) -> Option<String> {
    headers
        .get("x-share-password")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| query_password.map(str::to_string))
}

async fn resolve(
    state: &AppState,
    token: &str,
    headers: &HeaderMap,
    query_password: Option<&str>,
) -> Result<(Share, std::path::PathBuf)> {
    let share = {
        let conn = state.conn().await;
        find_share(&conn, token)?.ok_or_else(|| AppError::NotFound("share not found".into()))?
    };
    let root = state.user_dir(share.user_id);
    let target = storage::sanitize(&root, &share.file_path)?;
    if !tokio::fs::try_exists(&target).await? {
        return Err(AppError::NotFound("shared file no longer exists".into()));
    }
    if let Some(hash) = &share.password_hash {
        let ok = password_from(headers, query_password)
            .is_some_and(|p| crate::users::verify_password(&p, hash));
        if !ok {
            return Err(AppError::Unauthorized);
        }
    }
    Ok((share, target))
}

#[derive(Deserialize)]
pub struct PublicQuery {
    password: Option<String>,
}

pub async fn info(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let share = {
        let conn = state.conn().await;
        find_share(&conn, &token)?.ok_or_else(|| AppError::NotFound("share not found".into()))?
    };
    let root = state.user_dir(share.user_id);
    let target = storage::sanitize(&root, &share.file_path)?;
    let meta = tokio::fs::metadata(&target).await?;

    let (name, size) = if meta.is_dir() {
        let dir = target.clone();
        (
            target
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "files".into()),
            tokio::task::spawn_blocking(move || storage::disk_usage(&dir))
                .await
                .unwrap_or(0),
        )
    } else {
        (
            target
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "file".into()),
            meta.len(),
        )
    };
    Ok(Json(serde_json::json!({
        "name": name,
        "is_dir": meta.is_dir(),
        "size": size,
        "requires_password": share.password_hash.is_some(),
    })))
}

pub async fn download(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(q): Query<PublicQuery>,
    headers: HeaderMap,
) -> Result<Response> {
    let (share, target) = resolve(&state, &token, &headers, q.password.as_deref()).await?;
    let root = state.user_dir(share.user_id);
    if tokio::fs::metadata(&target).await?.is_dir() {
        transfer::serve_zip(&root, &share.file_path).await
    } else {
        transfer::serve_file(&root, &share.file_path, &headers, false).await
    }
}

async fn share_name_size(state: &AppState, share: &Share) -> Result<(String, u64)> {
    let root = state.user_dir(share.user_id);
    let target = storage::sanitize(&root, &share.file_path)?;
    let meta = tokio::fs::metadata(&target).await?;
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "files".into());
    let size = if meta.is_dir() {
        storage::disk_usage(&target)
    } else {
        meta.len()
    };
    Ok((name, size))
}

/// raw stream for direct embedding: inline disposition and the true mime so
/// Discord/Telegram render media inline instead of offering a download.
/// `/s/{token}/raw/{filename}` exists so the URL ends in a real extension.
pub async fn raw(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(q): Query<PublicQuery>,
    headers: HeaderMap,
) -> Result<Response> {
    raw_impl(state, token, q.password, headers).await
}

pub async fn raw_named(
    State(state): State<AppState>,
    Path((token, _filename)): Path<(String, String)>,
    Query(q): Query<PublicQuery>,
    headers: HeaderMap,
) -> Result<Response> {
    raw_impl(state, token, q.password, headers).await
}

async fn raw_impl(
    state: AppState,
    token: String,
    password: Option<String>,
    headers: HeaderMap,
) -> Result<Response> {
    let (share, _) = resolve(&state, &token, &headers, password.as_deref()).await?;
    let root = state.user_dir(share.user_id);
    transfer::serve_file(&root, &share.file_path, &headers, true).await
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// landing page for a share: the SPA shell with OpenGraph tags injected so
/// link unfurlers show a clean card. no og:image on purpose: the card points
/// at the preview page, the /raw URL is the one for media embeds.
pub async fn landing(State(state): State<AppState>, Path(token): Path<String>) -> Result<Response> {
    let share = {
        let conn = state.conn().await;
        find_share(&conn, &token)?
    };
    let mut html = String::from_utf8_lossy(&crate::static_files::index_bytes()?.data).into_owned();
    if let Some(share) = share {
        let (name, size) = share_name_size(&state, &share).await?;
        let name = html_escape(&name);
        let size = crate::size::format_size(size);
        let description = html_escape(&format!(
            "Shared via rbox — self-hosted file vault. Click to preview or download {name}."
        ));
        let meta = format!(
            "<meta property=\"og:title\" content=\"{name} ({size})\" />\
             <meta property=\"og:site_name\" content=\"rbox\" />\
             <meta property=\"og:description\" content=\"{description}\" />\
             <meta name=\"theme-color\" content=\"#e53935\" />"
        );
        // vite always emits a <head>; fall back to prepending if that changes
        if let Some(i) = html.find("</head>") {
            html.insert_str(i, &meta);
        } else {
            html = format!("{meta}{html}");
        }
    }
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("text/html")),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-cache")),
        ],
        html,
    )
        .into_response())
}
