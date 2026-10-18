use crate::auth::AuthUser;
use crate::error::{bad, other, AppError, Result};
use crate::state::AppState;
use crate::storage;
use crate::users;
use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

pub const TEXT_READ_CAP: u64 = 5 * 1024 * 1024;

#[derive(Deserialize)]
pub struct PathReq {
    pub path: String,
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(req): Query<PathReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let dir = storage::sanitize(&root, &req.path)?;
    if !tokio::fs::metadata(&dir).await?.is_dir() {
        return Err(AppError::NotFound(req.path));
    }

    let mut entries = Vec::new();
    let mut rd = tokio::fs::read_dir(&dir).await?;
    while let Some(entry) = rd.next_entry().await? {
        let meta = entry.metadata().await?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(".rbox-tmp") {
            continue; // in-flight upload staging files never show up in listings
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push(serde_json::json!({
            "name": name,
            "is_dir": meta.is_dir(),
            "size": if meta.is_dir() { 0 } else { meta.len() },
            "modified": modified,
        }));
    }
    entries.sort_by(|a, b| {
        let (ad, bd) = (a["is_dir"].as_bool(), b["is_dir"].as_bool());
        bd.cmp(&ad)
            .then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
    });
    Ok(Json(serde_json::json!({ "entries": entries })))
}

#[derive(Deserialize)]
pub struct MkdirReq {
    pub path: String,
}

pub async fn mkdir(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<MkdirReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let dir = storage::sanitize(&root, &req.path)?;
    if tokio::fs::try_exists(&dir).await? {
        return Err(AppError::BadRequest(format!(
            "'{}' already exists",
            req.path
        )));
    }
    tokio::fs::create_dir_all(&dir).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct RenameReq {
    pub path: String,
    pub new_name: String,
}

pub async fn rename(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<RenameReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let src = storage::sanitize(&root, &req.path)?;
    let Some(parent) = src.parent().map(|p| p.to_path_buf()) else {
        return Err(bad("cannot rename the storage root"));
    };
    let dst = storage::sanitize(&parent, &req.new_name)?;
    if tokio::fs::try_exists(&dst).await? {
        return Err(AppError::BadRequest(format!(
            "'{}' already exists",
            req.new_name
        )));
    }
    tokio::fs::rename(&src, &dst).await?;
    {
        // existing shares follow the file to its new name so links don't break
        let conn = state.conn().await;
        let old_rel = storage::to_relative(&root, &src)?;
        let new_rel = storage::to_relative(&root, &dst)?;
        crate::shares::retarget_shares(&conn, auth.user.id, &old_rel, &new_rel)?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct MoveReq {
    pub path: String,
    pub dest_dir: String,
}

pub async fn move_path(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<MoveReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let src = storage::sanitize(&root, &req.path)?;
    let Some(file_name) = src.file_name().map(|n| n.to_string_lossy().into_owned()) else {
        return Err(bad("cannot move the storage root"));
    };
    let dst_dir = storage::sanitize(&root, &req.dest_dir)?;
    if !tokio::fs::try_exists(&dst_dir).await? || !tokio::fs::metadata(&dst_dir).await?.is_dir() {
        return Err(AppError::NotFound(req.dest_dir));
    }
    // only meaningful when src is a dir; for files dst can never be inside src
    if src == dst_dir || dst_dir.starts_with(&src) {
        return Err(bad("cannot move a directory into itself"));
    }
    let dst = dst_dir.join(&file_name);
    if tokio::fs::try_exists(&dst).await? {
        return Err(AppError::BadRequest(format!(
            "'{file_name}' already exists there"
        )));
    }
    tokio::fs::rename(&src, &dst).await?;
    {
        // shares resolve paths, not inodes: retarget them to the new location
        let conn = state.conn().await;
        let old_rel = storage::to_relative(&root, &src)?;
        let new_rel = storage::to_relative(&root, &dst)?;
        crate::shares::retarget_shares(&conn, auth.user.id, &old_rel, &new_rel)?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct CopyReq {
    pub path: String,
    pub dest_dir: String,
}

pub async fn copy(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CopyReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let src = storage::sanitize(&root, &req.path)?;
    if !tokio::fs::try_exists(&src).await? {
        return Err(AppError::NotFound(req.path));
    }
    let Some(file_name) = src.file_name().map(|n| n.to_string_lossy().into_owned()) else {
        return Err(bad("cannot copy the storage root"));
    };
    let dst_dir = storage::sanitize(&root, &req.dest_dir)?;
    if !tokio::fs::try_exists(&dst_dir).await? || !tokio::fs::metadata(&dst_dir).await?.is_dir() {
        return Err(AppError::NotFound(req.dest_dir));
    }
    let dst = dst_dir.join(&file_name);
    if tokio::fs::try_exists(&dst).await? {
        return Err(AppError::BadRequest(format!(
            "'{file_name}' already exists there"
        )));
    }

    let size = if tokio::fs::metadata(&src).await?.is_dir() {
        tokio::task::spawn_blocking({
            let src = src.clone();
            move || storage::disk_usage(&src)
        })
        .await
        .map_err(|e| other(format!("join error: {e}")))?
    } else {
        tokio::fs::metadata(&src).await?.len()
    };

    // quota gate before any bytes are written
    if auth.user.used_bytes + size as i64 > auth.user.quota_bytes {
        return Err(AppError::QuotaExceeded(crate::size::format_size(
            auth.user.quota_bytes.max(0) as u64,
        )));
    }

    let bytes = tokio::task::spawn_blocking(move || storage::copy_path(&src, &dst))
        .await
        .map_err(|e| other(format!("join error: {e}")))??;
    {
        let mut conn = state.conn().await;
        users::adjust_used_bytes(&mut conn, auth.user.id, bytes as i64)?;
    }
    Ok(Json(
        serde_json::json!({ "ok": true, "bytes_copied": bytes }),
    ))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(req): Query<PathReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let target = storage::sanitize(&root, &req.path)?;
    if target == root {
        return Err(bad("cannot delete the storage root"));
    }
    if !tokio::fs::try_exists(&target).await? {
        return Err(AppError::NotFound(req.path));
    }
    let del = target.clone();
    let bytes = tokio::task::spawn_blocking(move || storage::delete_path(&del))
        .await
        .map_err(|e| other(format!("join error: {e}")))??;
    {
        let mut conn = state.conn().await;
        users::adjust_used_bytes(&mut conn, auth.user.id, -(bytes as i64))?;
        // dead links are worse than deleted ones: purge shares for the file
        // and everything it contained
        let rel = storage::to_relative(&root, &target)?;
        crate::shares::remove_shares_under(&conn, auth.user.id, &rel)?;
    }
    Ok(Json(
        serde_json::json!({ "ok": true, "bytes_freed": bytes }),
    ))
}

pub async fn read_content(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(req): Query<PathReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let file = storage::sanitize(&root, &req.path)?;
    let meta = tokio::fs::metadata(&file).await?;
    if meta.is_dir() {
        return Err(bad("path is a directory"));
    }
    if meta.len() > TEXT_READ_CAP {
        // the frontend editor never handles files this big anyway
        return Err(bad("file exceeds the 5MB text editor limit"));
    }
    let content = tokio::fs::read_to_string(&file).await?;
    Ok(Json(
        serde_json::json!({ "path": req.path, "content": content }),
    ))
}

pub async fn write_content(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(req): Query<PathReq>,
    body: bytes::Bytes,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let file = storage::sanitize(&root, &req.path)?;
    if file == root {
        return Err(other("invalid target"));
    }

    let old_size = match tokio::fs::metadata(&file).await {
        Ok(meta) if meta.is_dir() => return Err(bad("path is a directory")),
        Ok(meta) => meta.len(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => 0,
        Err(e) => return Err(e.into()),
    };

    if auth.user.used_bytes - old_size as i64 + body.len() as i64 > auth.user.quota_bytes {
        return Err(AppError::QuotaExceeded(crate::size::format_size(
            auth.user.quota_bytes.max(0) as u64,
        )));
    }

    // write-then-rename so a crash mid-save never leaves a truncated file
    let tmp = staging_path(&root)?;
    let mut f = tokio::io::BufWriter::new(tokio::fs::File::create(&tmp).await?);
    f.write_all(&body).await?;
    f.flush().await?;
    drop(f);
    tokio::fs::rename(&tmp, &file).await?;

    {
        let mut conn = state.conn().await;
        users::adjust_used_bytes(&mut conn, auth.user.id, body.len() as i64 - old_size as i64)?;
    }
    Ok(Json(serde_json::json!({ "ok": true, "size": body.len() })))
}

/// staging file on the same filesystem as the user dir so the final rename()
/// is atomic; unlinked by the guard on any error or disconnect
pub fn staging_path(user_root: &std::path::Path) -> Result<PathBuf> {
    use rand::distributions::{Alphanumeric, DistString};
    let name = format!(
        ".rbox-tmp-{}",
        Alphanumeric.sample_string(&mut rand::thread_rng(), 12)
    );
    Ok(user_root.join(name))
}

pub struct TempGuard(pub PathBuf);

impl Drop for TempGuard {
    fn drop(&mut self) {
        // sync unlink: drop runs before the handler returns, so callers never
        // observe the partial file. unlink(2) is cheap enough to do inline.
        let _ = std::fs::remove_file(&self.0);
    }
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct _Unused(HashMap<String, String>);
