use crate::auth::AuthUser;
use crate::error::{bad, AppError, Result};
use crate::files;
use crate::state::AppState;
use crate::storage;
use crate::users;
use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

const MAX_LEVEL: i32 = 9;

#[derive(Deserialize)]
pub struct CreateReq {
    paths: Vec<String>,
    dest_path: String,
    format: String,
    level: Option<i32>,
    password: Option<String>,
}

/// wraps a writer and fails the whole archive the moment the running total
/// would cross the user's remaining quota; every encoder stacks on top of it
struct QuotaWriter<W: Write> {
    inner: W,
    budget: i64,
    written: i64,
}

impl<W: Write> Write for QuotaWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.written += buf.len() as i64;
        if self.written > self.budget {
            return Err(std::io::Error::other("archive would exceed quota"));
        }
        self.inner.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

impl<W: Write + Seek> Seek for QuotaWriter<W> {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

/// every file/dir under `src`, as (abs, name-inside-archive)
fn collect(src: &Path, name: &str, out: &mut Vec<(PathBuf, String)>) -> Result<()> {
    let meta = std::fs::metadata(src).map_err(|_| AppError::NotFound(name.to_string()))?;
    if meta.is_dir() {
        out.push((src.to_path_buf(), name.to_string()));
        let mut entries: Vec<_> = std::fs::read_dir(src)?.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            if e.file_name().to_string_lossy().starts_with(".rbox-tmp") {
                continue;
            }
            let child_name = if name.is_empty() {
                e.file_name().to_string_lossy().into_owned()
            } else {
                format!("{name}/{}", e.file_name().to_string_lossy())
            };
            collect(&e.path(), &child_name, out)?;
        }
    } else {
        out.push((src.to_path_buf(), name.to_string()));
    }
    Ok(())
}

fn deflate_level(level: i32) -> Option<i64> {
    Some(level.clamp(0, MAX_LEVEL) as i64)
}

fn zstd_level(level: i32) -> i32 {
    // ui presets run 1..=9; zstd goes deeper so stretch them onto 1..=19
    (level.clamp(1, MAX_LEVEL) * 2 - 1).min(19)
}

fn tar_encoder(
    format: &str,
    level: i32,
    out: std::io::BufWriter<QuotaWriter<File>>,
) -> Result<Box<dyn Write>> {
    Ok(match format {
        "tar" => Box::new(out),
        "tar.gz" | "tgz" => Box::new(flate2::write::GzEncoder::new(
            out,
            flate2::Compression::new(level.clamp(1, MAX_LEVEL) as u32),
        )),
        "tar.zst" => {
            let enc = zstd::Encoder::new(out, zstd_level(level))?;
            Box::new(enc)
        }
        "tar.xz" => Box::new(xz2::write::XzEncoder::new(
            out,
            level.clamp(1, MAX_LEVEL).clamp(1, 9) as u32,
        )),
        other => return Err(bad(format!("unsupported archive format '{other}'"))),
    })
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateReq>,
) -> Result<Json<serde_json::Value>> {
    if req.paths.is_empty() {
        return Err(bad("paths must not be empty"));
    }
    let level = req.level.unwrap_or(6).clamp(0, MAX_LEVEL);
    let zip = req.format == "zip";
    let tar_format = matches!(
        req.format.as_str(),
        "tar" | "tar.gz" | "tgz" | "tar.zst" | "tar.xz"
    );
    if !zip && !tar_format {
        return Err(bad(format!("unsupported archive format '{}'", req.format)));
    }
    if !zip && req.password.is_some() {
        return Err(bad("password protection is only available for zip"));
    }

    let root = state.user_dir(auth.user.id);
    let mut sources = Vec::new();
    for p in &req.paths {
        let abs = storage::sanitize(&root, p)?;
        let name = storage::to_relative(&root, &abs)?;
        collect(&abs, &name, &mut sources)?;
    }
    let dest = storage::sanitize(&root, &req.dest_path)?;
    if dest == root {
        return Err(bad("invalid destination path"));
    }
    let budget = auth.user.quota_bytes - auth.user.used_bytes;

    let staging = files::staging_path(&root)?;
    let guard = files::TempGuard(staging.clone());
    let f = std::fs::File::create(&staging)?;
    let counter = QuotaWriter {
        inner: f,
        budget,
        written: 0,
    };
    let bufw = std::io::BufWriter::new(counter);

    let password = req.password.clone();
    let format = req.format.clone();
    let written = tokio::task::spawn_blocking(move || -> Result<i64> {
        if zip {
            let mut zw = zip::ZipWriter::new(bufw);
            for (abs, name) in &sources {
                if std::fs::metadata(abs)?.is_dir() {
                    zw.add_directory(format!("{name}/"), zip::write::SimpleFileOptions::default())?;
                    continue;
                }
                let mut opts = zip::write::SimpleFileOptions::default().large_file(true);
                opts = if level == 0 {
                    opts.compression_method(zip::CompressionMethod::Stored)
                } else {
                    opts.compression_method(zip::CompressionMethod::Deflated)
                        .compression_level(deflate_level(level))
                };
                if let Some(ref pw) = password {
                    opts = opts.with_aes_encryption(zip::AesMode::Aes256, pw);
                }
                zw.start_file(name.clone(), opts)?;
                std::io::copy(&mut File::open(abs)?, &mut zw)?;
            }
            zw.finish()?;
            Ok(0)
        } else {
            let mut tar = tar::Builder::new(tar_encoder(&format, level, bufw)?);
            for (abs, name) in &sources {
                tar.append_path_with_name(abs, name)?;
            }
            tar.into_inner()?.flush()?;
            Ok(0)
        }
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e)))??;

    let _ = written;
    let final_size = std::fs::metadata(&staging)?.len();

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&staging, &dest)?;
    // the archive is in place now; the guard must not unlink it on return
    std::mem::forget(guard);

    {
        let mut conn = state.conn().await;
        users::adjust_used_bytes(&mut conn, auth.user.id, final_size as i64)?;
    }
    Ok(Json(serde_json::json!({
        "ok": true,
        "path": req.dest_path,
        "size": final_size,
    })))
}

fn open_format(path: &Path) -> Result<&'static str> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
        .to_lowercase();
    Ok(if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        "tar.gz"
    } else if name.ends_with(".tar.zst") {
        "tar.zst"
    } else if name.ends_with(".tar.xz") {
        "tar.xz"
    } else if name.ends_with(".tar") {
        "tar"
    } else if name.ends_with(".zip") {
        "zip"
    } else {
        return Err(bad("not a supported archive"));
    })
}

fn tar_reader(format: &str, f: File) -> Result<Box<dyn Read>> {
    Ok(match format {
        "tar" => Box::new(f),
        "tar.gz" => Box::new(flate2::read::GzDecoder::new(f)),
        "tar.zst" => Box::new(zstd::Decoder::new(f)?),
        "tar.xz" => Box::new(xz2::read::XzDecoder::new(f)),
        _ => unreachable!(),
    })
}

#[derive(Deserialize)]
pub struct ListReq {
    path: String,
    password: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(req): Query<ListReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let target = storage::sanitize(&root, &req.path)?;
    if !tokio::fs::try_exists(&target).await? {
        return Err(AppError::NotFound(req.path));
    }
    let format = open_format(&target)?;
    let password = req.password;

    let entries = tokio::task::spawn_blocking(move || -> Result<serde_json::Value> {
        let mut out = Vec::new();
        if format == "zip" {
            let f = File::open(&target)?;
            let mut za = zip::ZipArchive::new(std::io::BufReader::new(f))?;
            for i in 0..za.len() {
                // raw read works without a password, unlike by_index which
                // refuses encrypted entries outright
                let f = za.by_index_raw(i)?;
                if f.encrypted() && password.is_none() {
                    return Err(AppError::ArchivePassword("password_required"));
                }
                out.push(serde_json::json!({
                    "name": f.name()?.trim_end_matches('/'),
                    "is_dir": f.is_dir(),
                    "size": f.size(),
                    "compressed_size": f.compressed_size(),
                    "encrypted": f.encrypted(),
                }));
            }
        } else {
            let f = File::open(&target)?;
            let mut tar = tar::Archive::new(tar_reader(format, f)?);
            for e in tar.entries()? {
                let e = e?;
                let name = e.path()?.to_string_lossy().trim_end_matches('/').to_owned();
                out.push(serde_json::json!({
                    "name": name,
                    "is_dir": e.header().entry_type().is_dir(),
                    "size": e.header().size()?,
                    "compressed_size": 0,
                    "encrypted": false,
                }));
            }
        }
        Ok(serde_json::json!({ "entries": out }))
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e)))??;
    Ok(Json(entries))
}

#[derive(Deserialize)]
pub struct ExtractReq {
    path: String,
    dest_dir: Option<String>,
    password: Option<String>,
}

/// every extraction lands in a staging dir first; any failure (bad password,
/// quota, traversal entry) deletes it wholesale so no partial files survive
pub async fn extract(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<ExtractReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let target = storage::sanitize(&root, &req.path)?;
    if !tokio::fs::try_exists(&target).await? {
        return Err(AppError::NotFound(req.path));
    }
    let format = open_format(&target)?;
    let dest_rel = req.dest_dir.clone().unwrap_or_default();
    let dest = storage::sanitize(&root, &dest_rel)?;

    let staging = files::staging_path(&root)?;
    let dir = staging.with_extension("d");
    std::fs::create_dir_all(&dir)?;
    let dir_c = dir.clone();
    let budget = auth.user.quota_bytes - auth.user.used_bytes;
    let quota_str = crate::size::format_size(auth.user.quota_bytes.max(0) as u64);
    let password = req.password;

    let (written, count) = tokio::task::spawn_blocking(move || -> Result<(i64, usize)> {
        let mut total = 0i64;
        let mut count = 0usize;
        if format == "zip" {
            let f = File::open(&target)?;
            let mut za = zip::ZipArchive::new(std::io::BufReader::new(f))?;
            for i in 0..za.len() {
                let mut zf = match password.as_deref() {
                    Some(pw) => za.by_index_decrypt(i, pw.as_bytes()).map_err(|e| match e {
                        zip::result::ZipError::InvalidPassword => {
                            AppError::ArchivePassword("invalid_archive_password")
                        }
                        other => AppError::Other(other.to_string()),
                    })?,
                    None => match za.by_index(i) {
                        Ok(f) => {
                            if f.encrypted() {
                                return Err(AppError::ArchivePassword("password_required"));
                            }
                            f
                        }
                        Err(zip::result::ZipError::InvalidPassword) => {
                            return Err(AppError::ArchivePassword("password_required"))
                        }
                        Err(zip::result::ZipError::UnsupportedArchive(
                            "Password required to decrypt file",
                        )) => return Err(AppError::ArchivePassword("password_required")),
                        Err(e) => return Err(e.into()),
                    },
                };
                // enclosed_name is the zip crate's own traversal guard: None
                // means absolute or ..-escaping paths, exactly what we reject
                let Some(rel) = zf.enclosed_name() else {
                    return Err(bad("archive contains an unsafe entry path"));
                };
                let out_path = dir_c.join(&rel);
                if zf.is_dir() {
                    std::fs::create_dir_all(&out_path)?;
                } else {
                    if let Some(p) = out_path.parent() {
                        std::fs::create_dir_all(p)?;
                    }
                    let mut out = std::io::BufWriter::new(File::create(&out_path)?);
                    let mut buf = vec![0u8; 64 * 1024];
                    loop {
                        let n = zf.read(&mut buf)?;
                        if n == 0 {
                            break;
                        }
                        total += n as i64;
                        if total > budget {
                            return Err(AppError::QuotaExceeded(quota_str.clone()));
                        }
                        out.write_all(&buf[..n])?;
                    }
                    out.flush()?;
                    count += 1;
                }
            }
        } else {
            let f = File::open(&target)?;
            let mut tar = tar::Archive::new(tar_reader(format, f)?);
            for e in tar.entries()? {
                let mut e = e?;
                let header = e.header();
                if !header.entry_type().is_file() && !header.entry_type().is_dir() {
                    // symlinks and links are a classic escape hatch; refuse
                    return Err(bad("archive contains links, which are not allowed"));
                }
                let raw = e.path()?.to_path_buf();
                if raw.is_absolute() {
                    return Err(bad("archive contains an absolute entry path"));
                }
                let Some(out_path) = sanitize_entry(&dir_c, &raw) else {
                    return Err(bad("archive contains an unsafe entry path"));
                };
                if header.entry_type().is_dir() {
                    std::fs::create_dir_all(&out_path)?;
                } else {
                    if let Some(p) = out_path.parent() {
                        std::fs::create_dir_all(p)?;
                    }
                    let mut out = std::io::BufWriter::new(File::create(&out_path)?);
                    let mut buf = vec![0u8; 64 * 1024];
                    loop {
                        let n = e.read(&mut buf)?;
                        if n == 0 {
                            break;
                        }
                        total += n as i64;
                        if total > budget {
                            return Err(AppError::QuotaExceeded(quota_str.clone()));
                        }
                        out.write_all(&buf[..n])?;
                    }
                    out.flush()?;
                    count += 1;
                }
            }
        }
        Ok((total, count))
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e)))??;

    // move staged entries into the destination; every name was vetted
    std::fs::create_dir_all(&dest)?;
    for e in std::fs::read_dir(&dir)? {
        let e = e?;
        let out = dest.join(e.file_name());
        if out.try_exists()? {
            std::fs::remove_dir_all(&dir).ok();
            return Err(bad("destination already contains these entries"));
        }
        std::fs::rename(e.path(), &out)?;
    }
    std::fs::remove_dir_all(&dir).ok();

    {
        let mut conn = state.conn().await;
        users::adjust_used_bytes(&mut conn, auth.user.id, written)?;
    }
    Ok(Json(serde_json::json!({
        "ok": true,
        "files": count,
        "bytes": written,
        "dest": dest_rel,
    })))
}

/// like storage::sanitize but for paths that must keep their internal
/// structure; absolute and ..-bearing entries map to None
fn sanitize_entry(root: &Path, rel: &Path) -> Option<PathBuf> {
    let mut out = root.to_path_buf();
    for c in rel.components() {
        match c {
            std::path::Component::Normal(p) => out.push(p),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    out.starts_with(root).then_some(out)
}

pub async fn stat(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(req): Query<ListReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let target = storage::sanitize(&root, &req.path)?;
    let meta = tokio::fs::symlink_metadata(&target).await?;
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let is_dir = meta.is_dir();
    let size = meta.len();

    let (size, items, sha256, mime) = tokio::task::spawn_blocking(move || -> Result<_> {
        if is_dir {
            Ok((
                storage::disk_usage(&target),
                Some(dir_count(&target)?),
                None,
                None,
            ))
        } else {
            let mime = mime_guess::from_path(&target)
                .first()
                .map(|m| m.essence_str().to_string());
            // hashing past 500MB blocks the pool thread for too long
            let sha = if size <= 500 * 1024 * 1024 {
                Some(file_sha256(&target)?)
            } else {
                None
            };
            Ok((size, None, sha, mime))
        }
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e)))??;

    Ok(Json(serde_json::json!({
        "name": name,
        "path": req.path,
        "is_dir": is_dir,
        "size": size,
        "modified": meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        "mime": mime.unwrap_or_default(),
        "sha256": sha256,
        "items": items,
    })))
}

fn dir_count(dir: &Path) -> Result<u64> {
    let mut n = 0;
    for e in std::fs::read_dir(dir)? {
        let e = e?;
        if e.file_name().to_string_lossy().starts_with(".rbox-tmp") {
            continue;
        }
        n += 1;
        if e.path().is_dir() {
            n += dir_count(&e.path())?;
        }
    }
    Ok(n)
}

fn file_sha256(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Deserialize)]
pub struct SearchReq {
    q: String,
    #[serde(rename = "type")]
    kind: Option<String>,
}

const IMAGE: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif",
];
const VIDEO: &[&str] = &["mp4", "mkv", "webm", "mov", "avi"];
const AUDIO: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac"];
const ARCHIVE: &[&str] = &["zip", "tar", "gz", "tgz", "zst", "xz", "7z", "rar"];
const CODE: &[&str] = &[
    "rs", "js", "ts", "tsx", "jsx", "py", "html", "css", "json", "toml", "yaml", "yml", "sh",
    "sql", "go", "c", "cpp", "h",
];
const DOC: &[&str] = &[
    "txt", "md", "pdf", "doc", "docx", "xls", "xlsx", "csv", "rtf", "log",
];

fn matches_kind(name: &str, kind: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or_default().to_lowercase();
    let list = match kind {
        "image" => IMAGE,
        "video" => VIDEO,
        "audio" => AUDIO,
        "archive" => ARCHIVE,
        "code" => CODE,
        "doc" => DOC,
        _ => return true,
    };
    list.contains(&ext.as_str())
}

/// recursive walk; names are the interesting part so hidden staging files stay
/// out and the result list stays bounded
fn walk_search(
    dir: &Path,
    rel: &str,
    needle: &str,
    kind: &str,
    out: &mut Vec<serde_json::Value>,
) -> Result<()> {
    for e in std::fs::read_dir(dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with(".rbox-tmp") {
            continue;
        }
        let child_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let is_dir = e.path().is_dir();
        if name.to_lowercase().contains(needle) && matches_kind(&name, kind) {
            let meta = e.metadata()?;
            out.push(serde_json::json!({
                "name": name,
                "path": child_rel,
                "is_dir": is_dir,
                "size": if is_dir { 0 } else { meta.len() },
                "modified": meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
            }));
        }
        if is_dir && out.len() < 500 {
            walk_search(&e.path(), &child_rel, needle, kind, out)?;
        }
        if out.len() >= 500 {
            break;
        }
    }
    Ok(())
}

pub async fn search(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(req): Query<SearchReq>,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let needle = req.q.to_lowercase();
    let kind = req.kind.unwrap_or_else(|| "all".into());
    let results = tokio::task::spawn_blocking(move || -> Result<Vec<serde_json::Value>> {
        let mut out = Vec::new();
        walk_search(&root, "", &needle, &kind, &mut out)?;
        Ok(out)
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e)))??;
    Ok(Json(serde_json::json!({ "results": results })))
}
