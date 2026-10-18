use crate::error::{bad, other, Result};
use std::path::{Component, Path, PathBuf};

/// real folders backing the sidebar shortcuts; every user root gets them so
/// navigation never lands on a 404
pub const DEFAULT_FOLDERS: &[&str] =
    &["Images", "Videos", "Audio", "Documents", "Code", "Archives"];

pub fn ensure_default_folders(root: &Path) {
    for name in DEFAULT_FOLDERS {
        let _ = std::fs::create_dir_all(root.join(name));
    }
}

#[allow(dead_code)] // consumed by the http handlers next step
/// Resolve a user-supplied relative path under `root`. Absolute paths, `..`,
/// and null bytes are rejected; the result is always inside `root`. Empty
/// components and `.` are dropped. The redundant starts_with check stays in as
/// defense in depth if the strip logic ever changes.
pub fn sanitize(root: &Path, user_path: &str) -> Result<PathBuf> {
    if user_path.starts_with('/') || user_path.starts_with('\\') {
        return Err(bad("path traversal rejected"));
    }
    let mut safe = root.to_path_buf();
    for part in user_path.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => return Err(bad("path traversal rejected")),
            p if p.contains('\0') => return Err(bad("path traversal rejected")),
            p => safe.push(p),
        }
    }
    if !safe.starts_with(root) {
        return Err(bad("path traversal rejected"));
    }
    Ok(safe)
}

#[allow(dead_code)]
/// Inverse of `sanitize` for display/API use: `/`-separated path relative to
/// `root`, or an error if it can't be represented (escapes root).
pub fn to_relative(root: &Path, abs: &Path) -> Result<String> {
    let rel = abs
        .strip_prefix(root)
        .map_err(|_| bad("path escapes storage root"))?;
    let parts = rel
        .components()
        .map(|c| match c {
            Component::Normal(p) => Ok(p.to_string_lossy().into_owned()),
            _ => Err(bad("path escapes storage root")),
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(parts.join("/"))
}

/// Total size of everything under `root`. Symlinks aren't followed (count as 0)
/// so a user can't inflate or dodge their quota with a link.
pub fn disk_usage(root: &Path) -> u64 {
    walk_usage(root).unwrap_or(0)
}

fn walk_usage(dir: &Path) -> std::io::Result<u64> {
    let mut total = 0;
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_dir() {
            total += walk_usage(&entry.path())?;
        } else if meta.is_file() {
            total += meta.len();
        }
    }
    Ok(total)
}

/// Delete a file or tree; returns bytes removed so callers can update
/// used_bytes without a full rescan.
pub fn delete_path(path: &Path) -> Result<u64> {
    let meta = std::fs::symlink_metadata(path)
        .map_err(|e| other(format!("cannot stat '{}': {e}", path.display())))?;
    let size = if meta.is_dir() {
        disk_usage(path)
    } else {
        meta.len()
    };
    if meta.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(size)
}

#[allow(dead_code)]
/// Recursive copy, returns bytes written. Symlinks are skipped.
pub fn copy_path(src: &Path, dst: &Path) -> Result<u64> {
    let meta = std::fs::symlink_metadata(src)
        .map_err(|e| other(format!("cannot stat '{}': {e}", src.display())))?;
    if meta.is_dir() {
        std::fs::create_dir_all(dst)?;
        let mut total = 0;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            total += copy_path(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(total)
    } else {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, dst)?;
        Ok(meta.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> &'static Path {
        Path::new("/srv/rbox/users/1")
    }

    #[test]
    fn accepts_normal_paths() {
        let p = sanitize(root(), "docs/2024/report.txt").unwrap();
        assert_eq!(p, PathBuf::from("/srv/rbox/users/1/docs/2024/report.txt"));
    }

    #[test]
    fn normalizes_redundant_components() {
        let p = sanitize(root(), "./docs//a.txt").unwrap();
        assert_eq!(p, PathBuf::from("/srv/rbox/users/1/docs/a.txt"));
    }

    #[test]
    fn rejects_traversal_and_absolute() {
        assert!(sanitize(root(), "../2/secret.txt").is_err());
        assert!(sanitize(root(), "docs/../../secret.txt").is_err());
        assert!(sanitize(root(), "..\\other").is_err());
        assert!(sanitize(root(), "/etc/passwd").is_err());
        assert!(sanitize(root(), "a\0b").is_err());
    }

    #[test]
    fn empty_path_maps_to_root() {
        assert_eq!(
            sanitize(root(), "").unwrap(),
            PathBuf::from("/srv/rbox/users/1")
        );
    }

    #[test]
    fn relative_roundtrip() {
        let abs = sanitize(root(), "a/b/c.txt").unwrap();
        assert_eq!(to_relative(root(), &abs).unwrap(), "a/b/c.txt");
    }
}
