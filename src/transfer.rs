use crate::auth::AuthUser;
use crate::error::{bad, conflict, other, AppError, Result};
use crate::files::staging_path;
use crate::quota;
use crate::state::AppState;
use crate::storage::{self, Staging};
use axum::body::Body;
use axum::extract::{Multipart, Query, State};
use axum::http::header::{self, HeaderMap};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;

#[derive(Deserialize)]
pub struct DirReq {
    path: String,
}

/// attachment header with an ascii-quoted fallback plus RFC 5987 filename* so
/// non-ascii names survive browsers that mangle the plain parameter
fn content_disposition(name: &str, inline: bool) -> String {
    if inline {
        return format!("inline; filename=\"{}\"", name.replace('"', ""));
    }
    let fallback: String = name
        .chars()
        .map(|c| {
            if c.is_ascii() && !matches!(c, '"' | '\\' | '\n' | '\r') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let mut encoded = String::with_capacity(name.len() * 3);
    for b in name.bytes() {
        // attribute chars from RFC 5987 stay raw, everything else is %-escaped
        if b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'!' | b'#' | b'$' | b'&' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~'
            )
        {
            encoded.push(b as char)
        } else {
            encoded.push_str(&format!("%{b:02X}"))
        }
    }
    format!("attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}")
}

/// multipart upload; each file streams to a staging file next to the target
/// so the final rename() is atomic. the stream aborts early once a chunk
/// pushes past the remaining headroom (refilled by the file it overwrites);
/// every finished file is then committed on its own through `quota::commit`,
/// so files that landed before a later one overflows stay on the books.
pub async fn upload(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(req): Query<DirReq>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    let root = state.user_dir(auth.user.id);
    let dir = storage::sanitize(&root, &req.path)?;
    match tokio::fs::metadata(&dir).await {
        Ok(m) if m.is_dir() => {}
        _ => return Err(AppError::NotFound(req.path)),
    }

    let mut total_delta: i64 = 0;
    let mut files = 0usize;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| bad(format!("malformed multipart body: {e}")))?
    {
        let Some(name) = field.file_name().map(str::to_string) else {
            continue;
        };
        let name = sanitize_file_name(&name)?;
        let dst = dir.join(&name);
        let old_size = match tokio::fs::metadata(&dst).await {
            Ok(meta) if meta.is_dir() => {
                return Err(conflict(format!("a folder named '{name}' already exists")))
            }
            Ok(meta) => meta.len() as i64,
            Err(_) => 0,
        };
        let budget = quota::budget(&state, auth.user.id).await?;
        let avail = budget.headroom() + old_size;

        let staging = Staging::new(staging_path(&root));
        let mut out = tokio::io::BufWriter::new(tokio::fs::File::create(staging.path()).await?);
        let mut written: i64 = 0;
        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|e| other(format!("upload stream error: {e}")))?
        {
            written += chunk.len() as i64;
            if written > avail {
                return Err(budget.exceeded());
            }
            out.write_all(&chunk).await?;
        }
        out.flush().await?;
        drop(out);

        let delta = quota::commit(&state, auth.user.id, |budget| {
            // re-stat under the lock: another request may have replaced dst
            let old = match std::fs::metadata(&dst) {
                Ok(m) if m.is_dir() => {
                    return Err(conflict(format!("a folder named '{name}' already exists")))
                }
                Ok(m) => m.len() as i64,
                Err(_) => 0,
            };
            budget.check(written - old)?;
            std::fs::rename(staging.path(), &dst)?;
            Ok((written - old, written - old))
        })
        .await?;
        staging.keep();
        total_delta += delta;
        files += 1;
    }

    Ok(Json(
        serde_json::json!({ "ok": true, "files": files, "delta": total_delta }),
    ))
}

fn sanitize_file_name(name: &str) -> Result<String> {
    // only the basename is trusted; browsers can send full windows paths
    let name = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let name = name
        .chars()
        .map(|c| if c.is_control() { '_' } else { c })
        .collect::<String>();
    storage::validate_name(&name)?;
    Ok(name)
}

/// inline responses render user content on our own origin; a sandbox CSP
/// strips scripts, forms and same-origin access so a shared .html or .svg
/// can't act with a viewer's session. PDFs are exempt because browser PDF
/// viewers refuse to load in a sandboxed document, and they run isolated
/// from the page origin anyway.
fn inline_csp(mime: &str) -> Option<&'static str> {
    (mime != "application/pdf").then_some("sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'")
}

pub async fn download(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(crate::files::PathReq { path }): Query<crate::files::PathReq>,
    headers: HeaderMap,
) -> Result<Response> {
    let root = state.user_dir(auth.user.id);
    serve_file(&root, &path, &headers, false).await
}

/// range-aware file download rooted at `root`; shared by the authenticated
/// download handler and public share downloads
/// `inline` streams the file for in-browser display (og embeds, media
/// players); `attachment` forces a download
pub async fn serve_file(
    root: &std::path::Path,
    path: &str,
    headers: &HeaderMap,
    inline: bool,
) -> Result<Response> {
    let file = storage::sanitize(root, path)?;
    let meta = tokio::fs::symlink_metadata(&file).await?;
    if meta.is_dir() {
        return Err(bad("path is a directory; use the zip endpoint"));
    }
    if !meta.is_file() {
        return Err(AppError::NotFound(path.to_string()));
    }
    let size = meta.len();
    let mime = mime_guess::from_path(&file)
        .first_or_octet_stream()
        .to_string();
    let file_name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let disposition = content_disposition(&file_name, inline);
    let csp = if inline { inline_csp(&mime) } else { None };
    let with_csp = |mut res: Response| {
        if let Some(csp) = csp {
            res.headers_mut().insert(
                header::CONTENT_SECURITY_POLICY,
                header::HeaderValue::from_static(csp),
            );
        }
        res
    };

    let Some(range) = headers.get(header::RANGE) else {
        let stream = ReaderStream::new(tokio::fs::File::open(&file).await?);
        return Ok(with_csp(
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, mime),
                    (header::CONTENT_LENGTH, size.to_string()),
                    (header::ACCEPT_RANGES, "bytes".to_string()),
                    (header::CONTENT_DISPOSITION, disposition),
                ],
                Body::from_stream(stream),
            )
                .into_response(),
        ));
    };

    let raw = range.to_str().map_err(|_| bad("bad range header"))?;
    let r = parse_range(raw, size)?;
    let mut f = tokio::fs::File::open(&file).await?;
    f.seek(std::io::SeekFrom::Start(r.start)).await?;
    // 64KB chunks keep media scrubbing responsive without thrashing allocs
    let stream = ReaderStream::with_capacity(f.take(r.len), 64 * 1024);
    Ok(with_csp(
        (
            StatusCode::PARTIAL_CONTENT,
            [
                (header::CONTENT_TYPE, mime),
                (header::CONTENT_LENGTH, r.len.to_string()),
                (header::ACCEPT_RANGES, "bytes".to_string()),
                (
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", r.start, r.end, size),
                ),
                (header::CONTENT_DISPOSITION, disposition),
            ],
            Body::from_stream(stream),
        )
            .into_response(),
    ))
}

struct ByteRange {
    start: u64,
    end: u64,
    len: u64,
}

/// single-range forms only: `a-b`, `a-`, `-n`. multi-range gets a 400 since
/// merging is rarely used and not worth the complexity.
fn parse_range(raw: &str, size: u64) -> Result<ByteRange> {
    let Some(spec) = raw.strip_prefix("bytes=") else {
        return Err(AppError::UnsatisfiableRange);
    };
    if spec.contains(',') {
        return Err(bad("multi-range requests are not supported"));
    }
    let (start_s, end_s) = spec.split_once('-').ok_or(AppError::UnsatisfiableRange)?;
    let r = match (start_s.trim(), end_s.trim()) {
        ("", suffix) => {
            let suffix: u64 = suffix.parse().map_err(|_| AppError::UnsatisfiableRange)?;
            let len = suffix.min(size);
            ByteRange {
                start: size - len,
                end: size.saturating_sub(1),
                len,
            }
        }
        (start, "") => {
            let start: u64 = start.parse().map_err(|_| AppError::UnsatisfiableRange)?;
            if start >= size {
                return Err(AppError::UnsatisfiableRange);
            }
            ByteRange {
                start,
                end: size - 1,
                len: size - start,
            }
        }
        (start, end) => {
            let (start, end): (u64, u64) = (
                start.parse().map_err(|_| AppError::UnsatisfiableRange)?,
                end.parse().map_err(|_| AppError::UnsatisfiableRange)?,
            );
            if start > end || start >= size {
                return Err(AppError::UnsatisfiableRange);
            }
            let end = end.min(size - 1);
            ByteRange {
                start,
                end,
                len: end - start + 1,
            }
        }
    };
    if r.len == 0 {
        return Err(AppError::UnsatisfiableRange);
    }
    Ok(r)
}

/// stream a directory as a zip. the archive is built by a spawned task
/// writing into a duplex pipe; the response body drains the other end, so
/// nothing ever hits disk. backpressure is free: the pipe blocks the writer
/// when the client isn't consuming.
pub async fn zip(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(crate::files::PathReq { path }): Query<crate::files::PathReq>,
) -> Result<Response> {
    let root = state.user_dir(auth.user.id);
    serve_zip(&root, &path).await
}

/// streamed zip of a directory under `root`; shared by the authenticated zip
/// handler and public share downloads
pub async fn serve_zip(root: &std::path::Path, path: &str) -> Result<Response> {
    let dir = storage::sanitize(root, path)?;
    if !tokio::fs::metadata(&dir).await?.is_dir() {
        return Err(bad("path is not a directory"));
    }

    let archive_name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "files".into());

    let (rx, wx) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        if let Err(e) = write_zip(dir, wx).await {
            eprintln!("zip stream error: {e}");
        }
    });

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                content_disposition(&format!("{archive_name}.zip"), false),
            ),
        ],
        Body::from_stream(ReaderStream::new(rx)),
    )
        .into_response())
}

async fn write_zip(
    root: PathBuf,
    mut writer: tokio::io::DuplexStream,
) -> std::result::Result<(), async_zip::error::ZipError> {
    use async_zip::tokio::write::ZipFileWriter;
    use async_zip::{Compression, ZipEntryBuilder};

    let mut zw = ZipFileWriter::with_tokio(&mut writer);
    let mut stack = vec![(root.clone(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = rd.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(storage::STAGING_PREFIX) {
                continue;
            }
            let file_type = entry.file_type().await?;
            if file_type.is_symlink() {
                continue; // never follow a link out of the shared tree
            }
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let path = entry.path();
            if file_type.is_dir() {
                // explicit entries keep empty folders in the archive
                zw.write_entry_stream(ZipEntryBuilder::new(
                    format!("{rel}/").into(),
                    Compression::Deflate,
                ))
                .await?
                .close()
                .await?;
                stack.push((path, rel));
            } else {
                let mut ew = zw
                    .write_entry_stream(ZipEntryBuilder::new(rel.into(), Compression::Deflate))
                    .await?;
                let mut f = tokio::io::BufReader::new(tokio::fs::File::open(&path).await?);
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    let n = f.read(&mut buf).await?;
                    if n == 0 {
                        break;
                    }
                    futures_util::io::AsyncWriteExt::write_all(&mut ew, &buf[..n]).await?;
                }
                ew.close().await?;
            }
        }
    }
    zw.close().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disposition_escapes_non_ascii() {
        let d = content_disposition("report final.txt", false);
        assert!(d.contains("filename=\"report final.txt\""));
        assert!(d.contains("filename*=UTF-8''report%20final.txt"));

        let d = content_disposition("Bericht für Köln.zip", false);
        assert!(d.contains("filename=\"Bericht f_r K_ln.zip\""));
        assert!(d.contains("filename*=UTF-8''Bericht%20f%C3%BCr%20K%C3%B6ln.zip"));
    }
}

#[test]
fn inline_disposition_has_no_rfc5987_suffix() {
    let d = content_disposition("pic.png", true);
    assert_eq!(d, r#"inline; filename="pic.png""#);
}
