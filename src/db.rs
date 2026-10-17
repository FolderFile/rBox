use crate::error::{other, AppError, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

const DB_FILE: &str = "rbox.db";
pub const SCHEMA_VERSION: i64 = 2;

pub fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DB_FILE)
}

pub fn users_root(data_dir: &Path) -> PathBuf {
    data_dir.join("users")
}

pub fn user_dir(data_dir: &Path, user_id: i64) -> PathBuf {
    users_root(data_dir).join(user_id.to_string())
}

pub fn is_initialized(data_dir: &Path) -> bool {
    db_path(data_dir).exists()
}

pub fn open(data_dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(data_dir)?;
    let conn = Connection::open(db_path(data_dir))?;
    // journal_mode returns a row, hence query_row instead of pragma_update
    conn.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

/// v1 databases predate share expiry and passwords; bring them up silently.
/// fresh dirs (version 0) are handled by init_schema.
fn migrate(conn: &Connection) -> Result<()> {
    match schema_version(conn).unwrap_or(0) {
        0 | SCHEMA_VERSION => Ok(()),
        1 => {
            // guard each column so partially-migrated databases don't choke
            for (col, ddl) in [
                ("expires_at", "ALTER TABLE shares ADD COLUMN expires_at INTEGER"),
                ("password_hash", "ALTER TABLE shares ADD COLUMN password_hash TEXT"),
            ] {
                let exists: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('shares') WHERE name = ?1",
                    [col],
                    |r| r.get(0),
                )?;
                if exists == 0 {
                    conn.execute(ddl, [])?;
                }
            }
            conn.execute("UPDATE meta SET value = '2' WHERE key = 'schema_version'", [])?;
            Ok(())
        }
        v => Err(other(format!(
            "database schema version {v} is newer than supported version {SCHEMA_VERSION}"
        ))),
    }
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "BEGIN;
         CREATE TABLE IF NOT EXISTS meta (
             key   TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );
         INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '2');
         CREATE TABLE IF NOT EXISTS users (
             id            INTEGER PRIMARY KEY AUTOINCREMENT,
             username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
             password_hash TEXT NOT NULL,
             quota_bytes   INTEGER NOT NULL,
             used_bytes    INTEGER NOT NULL DEFAULT 0,
             is_admin      INTEGER NOT NULL DEFAULT 0,
             created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         );
         CREATE TABLE IF NOT EXISTS shares (
             id            INTEGER PRIMARY KEY AUTOINCREMENT,
             user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             file_path     TEXT NOT NULL,
             token         TEXT NOT NULL UNIQUE,
             expires_at    INTEGER,
             password_hash TEXT,
             created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         );
         CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
         COMMIT;",
    )?;
    Ok(())
}

pub fn require_initialized(data_dir: &Path) -> Result<()> {
    if !is_initialized(data_dir) {
        return Err(AppError::NotInitialized(data_dir.to_path_buf()));
    }
    Ok(())
}

pub fn schema_version(conn: &Connection) -> Result<i64> {
    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='schema_version'",
            [],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(version.and_then(|v| v.parse().ok()).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_v1_database_in_place() {
        let dir = tempfile::tempdir().unwrap();
        {
            let conn = Connection::open(db_path(dir.path())).unwrap();
            conn.execute_batch(
                "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO meta VALUES ('schema_version', '1');
                 CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
                     quota_bytes INTEGER NOT NULL, used_bytes INTEGER NOT NULL DEFAULT 0,
                     is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
                 CREATE TABLE shares (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     user_id INTEGER NOT NULL, file_path TEXT NOT NULL,
                     token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);",
            )
            .unwrap();
        }

        let conn = open(dir.path()).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
        conn.execute(
            "INSERT INTO shares (user_id, file_path, token, expires_at, password_hash, created_at)
             VALUES (1, 'a.txt', 't', NULL, NULL, 'x')",
            [],
        )
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM shares WHERE token = 't'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}
