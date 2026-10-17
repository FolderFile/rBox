use crate::error::{other, AppError, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub quota_bytes: i64,
    pub used_bytes: i64,
    pub is_admin: bool,
}

pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| other(format!("password hashing failed: {e}")))
}

#[allow(dead_code)]
pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .ok()
        .and_then(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .ok()
        })
        .is_some()
}

pub fn validate_username(username: &str) -> Result<()> {
    let ok = (1..=64).contains(&username.len())
        && username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '@'));
    if ok {
        Ok(())
    } else {
        Err(AppError::InvalidUsername(username.to_string()))
    }
}

pub fn create(
    conn: &Connection,
    username: &str,
    password: &str,
    quota_bytes: u64,
    is_admin: bool,
) -> Result<i64> {
    validate_username(username)?;
    if find_by_username(conn, username)?.is_some() {
        return Err(AppError::UserExists(username.to_string()));
    }
    let hash = hash_password(password)?;
    conn.execute(
        "INSERT INTO users (username, password_hash, quota_bytes, is_admin)
         VALUES (?1, ?2, ?3, ?4)",
        params![username, hash, quota_bytes as i64, is_admin as i64],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn find_by_username(conn: &Connection, username: &str) -> Result<Option<User>> {
    conn.query_row(
        "SELECT id, username, quota_bytes, used_bytes, is_admin
         FROM users WHERE username = ?1 COLLATE NOCASE",
        params![username],
        row_to_user,
    )
    .optional()
    .map_err(Into::into)
}

#[allow(dead_code)]
pub fn find_by_id(conn: &Connection, id: i64) -> Result<Option<User>> {
    conn.query_row(
        "SELECT id, username, quota_bytes, used_bytes, is_admin
         FROM users WHERE id = ?1",
        params![id],
        row_to_user,
    )
    .optional()
    .map_err(Into::into)
}

pub fn list(conn: &Connection) -> Result<Vec<User>> {
    let mut stmt = conn.prepare(
        "SELECT id, username, quota_bytes, used_bytes, is_admin
         FROM users ORDER BY username COLLATE NOCASE",
    )?;
    let users = stmt
        .query_map([], row_to_user)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(users)
}

pub fn set_quota(conn: &Connection, username: &str, quota: u64) -> Result<User> {
    let Some(mut user) = find_by_username(conn, username)? else {
        return Err(AppError::UserNotFound(username.to_string()));
    };
    conn.execute(
        "UPDATE users SET quota_bytes = ?1 WHERE id = ?2",
        params![quota as i64, user.id],
    )?;
    user.quota_bytes = quota as i64;
    Ok(user)
}

#[allow(dead_code)] // consumed by upload/download handlers
pub fn adjust_used_bytes(conn: &mut Connection, user_id: i64, delta: i64) -> Result<i64> {
    // clamped at 0 so a stale delta can never push usage negative
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE users SET used_bytes = MAX(0, used_bytes + ?1) WHERE id = ?2",
        params![delta, user_id],
    )?;
    let used: i64 = tx.query_row(
        "SELECT used_bytes FROM users WHERE id = ?1",
        params![user_id],
        |r| r.get(0),
    )?;
    tx.commit()?;
    Ok(used)
}

pub fn set_used_bytes(conn: &Connection, user_id: i64, used: u64) -> Result<()> {
    conn.execute(
        "UPDATE users SET used_bytes = ?1 WHERE id = ?2",
        params![used as i64, user_id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, username: &str) -> Result<i64> {
    let user = find_by_username(conn, username)?
        .ok_or_else(|| AppError::UserNotFound(username.to_string()))?;
    conn.execute("DELETE FROM users WHERE id = ?1", params![user.id])?;
    Ok(user.id)
}

fn row_to_user(row: &rusqlite::Row<'_>) -> rusqlite::Result<User> {
    Ok(User {
        id: row.get(0)?,
        username: row.get(1)?,
        quota_bytes: row.get(2)?,
        used_bytes: row.get(3)?,
        is_admin: row.get::<_, i64>(4)? != 0,
    })
}
