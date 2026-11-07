use crate::error::{bad, other, Result};
use std::path::{Component, Path, PathBuf};

/// real folders backing the sidebar shortcuts; every user root gets them so
/// navigation never lands on a 404
pub const DEFAULT_FOLDERS: &[&str] =
    &["Images", "Videos", "Audio", "Documents", "Code", "Archives"];

/// prefix of every in-flight staging file/dir; user paths may never name one
pub const STAGING_PREFIX: &str = ".rbox-tmp";

pub fn ensure_default_folders(root: &Path) {
    for name in DEFAULT_FOLDERS {
        let _ = std::fs::create_dir_all(root.join(name));
    }
}

/// Resolve a user-supplied relative path under `root`. Absolute paths, `..`,
/// null bytes and staging names are rejected; the result is always inside
/// `root`. Empty components and `.` are dropped. The redundant starts_with
/// check stays in as defense in depth if the strip logic ever changes.
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
            p if p.starts_with(STAGING_PREFIX) => return Err(bad("reserved file name")),
            p => safe.push(p),
        }
    }
    if !safe.starts_with(root) {
        return Err(bad("path traversal rejected"));
    }
    Ok(safe)
}

/// A single file or folder name as typed by a user (rename, upload, new
/// folder): no separators, no `.`/`..`, no control chars, no staging prefix.
pub fn validate_name(name: &str) -> Result<&str> {
    let ok = !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\'])
        && !name.chars().any(char::is_control)
        && !name.starts_with(STAGING_PREFIX);
    if ok {
        Ok(name)
    } else {
        Err(bad(format!("'{name}' is not a valid name")))
    }
}

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
        // DirEntry::metadata does not traverse symlinks
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
    if meta.is_dir() {
        let size = disk_usage(path);
        std::fs::remove_dir_all(path)?;
        Ok(size)
    } else {
        std::fs::remove_file(path)?;
        Ok(if meta.is_file() { meta.len() } else { 0 })
    }
}

/// Recursive copy, returns bytes written. Symlinks are skipped, never followed,
/// so a link can't smuggle data from outside the user's root into it.
pub fn copy_path(src: &Path, dst: &Path) -> Result<u64> {
    let meta = std::fs::symlink_metadata(src)
        .map_err(|e| other(format!("cannot stat '{}': {e}", src.display())))?;
    if meta.file_type().is_symlink() {
        return Ok(0);
    }
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

/// staging file or directory; removed on drop unless `keep()` was called, so
/// every early return and client disconnect cleans up after itself
pub struct Staging(Option<PathBuf>);

impl Staging {
    pub fn new(path: PathBuf) -> Self {
        Self(Some(path))
    }

    pub fn path(&self) -> &Path {
        self.0.as_deref().expect("staging path used after keep()")
    }

    /// the staged data now lives at its final path; don't delete anything
    pub fn keep(mut self) {
        self.0 = None;
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        // sync unlink: drop runs before the handler returns, so callers never
        // observe the partial data
        let Some(p) = &self.0 else { return };
        match std::fs::symlink_metadata(p) {
            Ok(m) if m.is_dir() => {
                let _ = std::fs::remove_dir_all(p);
            }
            Ok(_) => {
                let _ = std::fs::remove_file(p);
            }
            Err(_) => {}
        }
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
        assert!(sanitize(root(), ".rbox-tmp-abc").is_err());
        assert!(sanitize(root(), "docs/.rbox-tmp-abc.d/x").is_err());
    }

    #[test]
    fn names_are_single_components() {
        for ok in ["a.txt", ".env", "with space", "ünïcode"] {
            assert!(validate_name(ok).is_ok(), "{ok}");
        }
        for bad in ["", ".", "..", "a/b", "a\\b", "x\ny", ".rbox-tmp-1"] {
            assert!(validate_name(bad).is_err(), "{bad:?}");
        }
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

    #[test]
    fn staging_guard_removes_files_and_dirs_unless_kept() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join(".rbox-tmp-f");
        let d = dir.path().join(".rbox-tmp-d");
        std::fs::write(&f, "x").unwrap();
        std::fs::create_dir_all(d.join("nested")).unwrap();
        drop(Staging::new(f.clone()));
        drop(Staging::new(d.clone()));
        assert!(!f.exists() && !d.exists());

        std::fs::write(&f, "x").unwrap();
        Staging::new(f.clone()).keep();
        assert!(f.exists());
    }
}
