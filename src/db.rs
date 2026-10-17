use crate::error::{AppError, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

const DB_FILE: &str = "rbox.db";
pub const SCHEMA_VERSION: i64 = 1;

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
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "BEGIN;
         CREATE TABLE IF NOT EXISTS meta (
             key   TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );
         INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
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
             id         INTEGER PRIMARY KEY AUTOINCREMENT,
             user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             file_path  TEXT NOT NULL,
             token      TEXT NOT NULL UNIQUE,
             created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
