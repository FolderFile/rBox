use crate::auth::AuthUser;
use crate::error::{bad, conflict, other, AppError, Result};
use crate::quota;
use crate::state::AppState;
use crate::storage::{self, Staging};
use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

pub const TEXT_READ_CAP: u64 = 5 * 1024 * 1024;

#[derive(Deserialize)]
pub struct PathReq {
    pub path: String,
}

fn unix_secs(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
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
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(storage::STAGING_PREFIX) {
            continue; // in-flight staging data never shows up in listings
        }
        // an entry can vanish between readdir and stat; skip it, don't 404
        let Ok(meta) = entry.metadata().await else {
            continue;
        };
        entries.push(serde_json::json!({
            "name": name,
            "is_dir": meta.is_dir(),
            "size": if meta.is_dir() { 0 } else { meta.len() },
            "modified": unix_secs(&meta),
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
    if dir == root {
        return Err(bad("folder name must not be empty"));
    }
    if let Some(name) = dir.file_name() {
        storage::validate_name(&name.to_string_lossy())?;
    }
    if tokio::fs::try_exists(&dir).await? {
        return Err(conflict(format!("'{}' already exists", req.path)));
    }
    tokio::fs::create_dir_all(&dir).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// the user's root can be listed but never be the subject of a rename, move,
/// copy or delete: its parent is the directory holding every other user
fn not_root(root: &Path, p: &Path, what: &str) -> Result<()> {
    if p == root {
        return Err(bad(format!("cannot {what} your storage root")));
    }
    Ok(())
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
    not_root(&root, &src, "rename")?;
    let new_name = storage::validate_name(req.new_name.trim())?;
    let parent = src.parent().ok_or_else(|| bad("invalid path"))?;
    let dst = parent.join(new_name);
    if !tokio::fs::try_exists(&src).await? {
        return Err(AppError::NotFound(req.path));
    }
    if dst == src {
        return Ok(Json(serde_json::json!({ "ok": true })));
    }
    if tokio::fs::try_exists(&dst).await? {
        return Err(conflict(format!("'{new_name}' already exists")));
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

/// shared by move and copy: resolves source and destination, refusing the
/// root, missing paths, name clashes and folders nested into themselves
async fn resolve_transfer(
    root: &Path,
    path: &str,
    dest_dir: &str,
    what: &str,
) -> Result<(PathBuf, PathBuf)> {
    let src = storage::sanitize(root, path)?;
    not_root(root, &src, what)?;
    if tokio::fs::symlink_metadata(&src).await.is_err() {
        return Err(AppError::NotFound(path.to_string()));
    }
    let file_name = src.file_name().ok_or_else(|| bad("invalid path"))?;
    let dst_dir = storage::sanitize(root, dest_dir)?;
    match tokio::fs::metadata(&dst_dir).await {
        Ok(m) if m.is_dir() => {}
        _ => return Err(AppError::NotFound(dest_dir.to_string())),
    }
    if dst_dir.starts_with(&src) {
        return Err(bad(format!("cannot {what} a folder into itself")));
    }
    let dst = dst_dir.join(file_name);
    if tokio::fs::try_exists(&dst).await? {
        return Err(conflict(format!(
            "'{}' already exists there",
            file_name.to_string_lossy()
        )));
    }
    Ok((src, dst))
}

pub async fn move_path(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<MoveReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let (src, dst) = resolve_transfer(&root, &req.path, &req.dest_dir, "move").await?;
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

pub async fn copy(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<MoveReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let (src, dst) = resolve_transfer(&root, &req.path, &req.dest_dir, "copy").await?;

    // cheap pre-check so an obviously oversized copy fails before any I/O
    let size = tokio::task::spawn_blocking({
        let src = src.clone();
        move || match std::fs::symlink_metadata(&src) {
            Ok(m) if m.is_dir() => storage::disk_usage(&src),
            Ok(m) if m.is_file() => m.len(),
            _ => 0,
        }
    })
    .await
    .map_err(|e| other(format!("join error: {e}")))?;
    quota::budget(&state, auth.user.id)
        .await?
        .check(size as i64)?;

    // copy into staging, then publish atomically: a failed or interrupted copy
    // never leaves a half-populated folder behind
    let staging = Staging::new(staging_path(&root));
    let bytes = tokio::task::spawn_blocking({
        let (src, tmp) = (src.clone(), staging.path().to_path_buf());
        move || storage::copy_path(&src, &tmp)
    })
    .await
    .map_err(|e| other(format!("join error: {e}")))??;

    quota::commit(&state, auth.user.id, |budget| {
        budget.check(bytes as i64)?;
        if dst.exists() {
            return Err(conflict("destination appeared while copying"));
        }
        std::fs::rename(staging.path(), &dst)?;
        Ok(((), bytes as i64))
    })
    .await?;
    staging.keep();
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
    not_root(&root, &target, "delete")?;
    if tokio::fs::symlink_metadata(&target).await.is_err() {
        return Err(AppError::NotFound(req.path));
    }
    let del = target.clone();
    let bytes = tokio::task::spawn_blocking(move || storage::delete_path(&del))
        .await
        .map_err(|e| other(format!("join error: {e}")))??;
    {
        let mut conn = state.conn().await;
        crate::users::adjust_used_bytes(&mut conn, auth.user.id, -(bytes as i64))?;
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
        return Err(AppError::PayloadTooLarge(
            "file exceeds the 5 MB text editor limit".into(),
        ));
    }
    let bytes = tokio::fs::read(&file).await?;
    let content = String::from_utf8(bytes).map_err(|_| {
        AppError::UnsupportedMedia(
            "this file is binary, not UTF-8 text; download it instead".into(),
        )
    })?;
    Ok(Json(serde_json::json!({
        "path": req.path,
        "content": content,
        "modified": unix_secs(&meta),
    })))
}

#[derive(Deserialize)]
pub struct WriteReq {
    pub path: String,
    /// "new file": refuse to clobber an existing file instead of overwriting
    #[serde(default, deserialize_with = "query_flag")]
    pub create: bool,
}

/// query-string booleans as people write them: `1`, `true`, `yes`, `on`
fn query_flag<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<bool, D::Error> {
    let raw = String::deserialize(d)?;
    Ok(matches!(
        raw.to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    ))
}

pub async fn write_content(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(req): Query<WriteReq>,
    body: bytes::Bytes,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let file = storage::sanitize(&root, &req.path)?;
    not_root(&root, &file, "overwrite")?;
    if let Some(name) = file.file_name() {
        storage::validate_name(&name.to_string_lossy())?;
    }
    if let Ok(meta) = tokio::fs::metadata(&file).await {
        if meta.is_dir() {
            return Err(bad("path is a directory"));
        }
        if req.create {
            return Err(conflict(format!("'{}' already exists", req.path)));
        }
    }
    match file.parent().map(std::fs::metadata) {
        Some(Ok(m)) if m.is_dir() => {}
        _ => return Err(AppError::NotFound("parent folder does not exist".into())),
    }

    // write-then-rename so a crash mid-save never leaves a truncated file
    let staging = Staging::new(staging_path(&root));
    let mut f = tokio::io::BufWriter::new(tokio::fs::File::create(staging.path()).await?);
    f.write_all(&body).await?;
    f.flush().await?;
    drop(f);

    let new_len = body.len() as i64;
    quota::commit(&state, auth.user.id, |budget| {
        let old = match std::fs::metadata(&file) {
            Ok(_) if req.create => return Err(conflict(format!("'{}' already exists", req.path))),
            Ok(m) => m.len() as i64,
            Err(_) => 0,
        };
        budget.check(new_len - old)?;
        std::fs::rename(staging.path(), &file)?;
        Ok(((), new_len - old))
    })
    .await?;
    staging.keep();
    Ok(Json(serde_json::json!({ "ok": true, "size": body.len() })))
}

/// staging file on the same filesystem as the user dir so the final rename()
/// is atomic; wrap it in `storage::Staging` so it's removed on any error
pub fn staging_path(user_root: &Path) -> PathBuf {
    use rand::distributions::{Alphanumeric, DistString};
    user_root.join(format!(
        "{}-{}",
        storage::STAGING_PREFIX,
        Alphanumeric.sample_string(&mut rand::thread_rng(), 12)
    ))
}
