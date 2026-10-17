use crate::auth::AuthUser;
use crate::error::{bad, AppError, Result};
use crate::state::AppState;
use crate::storage;
use crate::transfer;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::Response;
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
    let target = storage::sanitize(&root, &req.path)?;
    if !tokio::fs::try_exists(&target).await? {
        return Err(AppError::NotFound(req.path));
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
        params![auth.user.id, req.path, token, expires_at, hash],
    )?;
    Ok(Json(
        serde_json::json!({ "token": token, "path": req.path, "expires_at": expires_at }),
    ))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>> {
    let conn = state.conn().await;
    let mut stmt = conn.prepare(
        "SELECT id, token, file_path, expires_at, password_hash IS NOT NULL
         FROM shares WHERE user_id = ?1 ORDER BY id DESC",
    )?;
    let shares = stmt
        .query_map(params![auth.user.id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "token": r.get::<_, String>(1)?,
                "path": r.get::<_, String>(2)?,
                "expires_at": r.get::<_, Option<i64>>(3)?,
                "requires_password": r.get::<_, bool>(4)?,
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(serde_json::json!({ "shares": shares })))
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
        transfer::serve_file(&root, &share.file_path, &headers).await
    }
}
