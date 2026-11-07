use crate::db;
use crate::error::Result;
use crate::users::User;
use chrono::{DateTime, Duration, TimeZone, Utc};
use rand::distributions::{Alphanumeric, DistString};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

pub const SESSION_TTL: Duration = Duration::days(7);
const FAILURE_WINDOW: Duration = Duration::minutes(1);
pub const LOGIN_MAX_FAILURES: usize = 5;
pub const SHARE_MAX_FAILURES: usize = 10;
// past this many tracked keys the limiter sweeps stale ones, so a flood of
// distinct usernames/tokens can't grow the map without bound
const FAILURE_MAP_SWEEP_AT: usize = 4096;

pub struct Session {
    pub id: i64,
    pub user_id: i64,
    pub created_at: DateTime<Utc>,
    pub user_agent: String,
    pub expires: DateTime<Utc>,
}

pub struct Inner {
    pub db: Mutex<rusqlite::Connection>,
    pub data_dir: PathBuf,
    // keyed by sha256(token): the raw token only ever lives in the cookie, so
    // a leaked database file doesn't hand out live sessions. lock order is
    // always sessions -> db, never the other way around.
    sessions: RwLock<HashMap<String, Session>>,
    // "kind|client|subject" -> recent failures; pruned on each check
    failures: Mutex<HashMap<String, VecDeque<DateTime<Utc>>>>,
    trust_proxy: AtomicBool,
}

#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

pub fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn load_sessions(conn: &rusqlite::Connection) -> rusqlite::Result<HashMap<String, Session>> {
    let now = Utc::now().timestamp();
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?1", params![now])?;
    let mut stmt = conn.prepare(
        "SELECT id, token_hash, user_id, user_agent, created_at, expires_at FROM sessions",
    )?;
    let rows = stmt.query_map([], |r| {
        let ts = |secs: i64| Utc.timestamp_opt(secs, 0).single().unwrap_or_default();
        Ok((
            r.get::<_, String>(1)?,
            Session {
                id: r.get(0)?,
                user_id: r.get(2)?,
                user_agent: r.get(3)?,
                created_at: ts(r.get(4)?),
                expires: ts(r.get(5)?),
            },
        ))
    })?;
    rows.collect()
}

impl AppState {
    pub fn new(data_dir: impl AsRef<Path>) -> Result<Self> {
        let data_dir = data_dir.as_ref();
        let conn = db::open(data_dir)?;
        // startup ensure: users created before folder shortcuts existed still
        // need their default folders before the first request resolves one
        if let Ok(list) = crate::users::list(&conn) {
            for u in &list {
                crate::storage::ensure_default_folders(&db::user_dir(data_dir, u.id));
            }
        }
        // an uninitialized dir has no sessions table yet; start empty then
        let sessions = load_sessions(&conn).unwrap_or_default();
        Ok(Self(Arc::new(Inner {
            db: Mutex::new(conn),
            data_dir: data_dir.to_path_buf(),
            sessions: RwLock::new(sessions),
            failures: Mutex::new(HashMap::new()),
            trust_proxy: AtomicBool::new(false),
        })))
    }

    /// honour X-Forwarded-For / CF-Connecting-IP for client addresses. only
    /// safe when every request arrives through a proxy that sets them.
    pub fn with_trust_proxy(self, trust: bool) -> Self {
        self.0.trust_proxy.store(trust, Ordering::Relaxed);
        self
    }

    pub fn trust_proxy(&self) -> bool {
        self.0.trust_proxy.load(Ordering::Relaxed)
    }

    pub fn data_dir(&self) -> &Path {
        &self.0.data_dir
    }

    pub fn user_dir(&self, user_id: i64) -> PathBuf {
        db::user_dir(&self.0.data_dir, user_id)
    }

    pub async fn create_session(&self, user_id: i64, user_agent: &str) -> Result<String> {
        let token = Alphanumeric.sample_string(&mut rand::thread_rng(), 48);
        let hash = hash_token(&token);
        let now = Utc::now();
        let expires = now + SESSION_TTL;
        // user agents are attacker-controlled and only for display
        let user_agent: String = user_agent.chars().take(256).collect();

        let mut sessions = self.0.sessions.write().await;
        let conn = self.conn().await;
        // opportunistic sweep keeps both the table and the map bounded
        conn.execute(
            "DELETE FROM sessions WHERE expires_at <= ?1",
            params![now.timestamp()],
        )?;
        sessions.retain(|_, s| s.expires > now);
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, user_agent, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                hash,
                user_id,
                user_agent,
                now.timestamp(),
                expires.timestamp()
            ],
        )?;
        let id = conn.last_insert_rowid();
        sessions.insert(
            hash,
            Session {
                id,
                user_id,
                created_at: now,
                user_agent,
                expires,
            },
        );
        Ok(token)
    }

    pub async fn session_info(&self, user_id: i64) -> Vec<serde_json::Value> {
        let sessions = self.0.sessions.read().await;
        let now = Utc::now();
        let mut list: Vec<_> = sessions
            .values()
            .filter(|s| s.user_id == user_id && s.expires > now)
            .map(|s| {
                serde_json::json!({
                    "id": s.id,
                    "created_at": s.created_at.to_rfc3339(),
                    "expires_at": s.expires.to_rfc3339(),
                    "user_agent": s.user_agent,
                })
            })
            .collect();
        list.sort_by_key(|v| v["id"].as_i64().unwrap_or_default());
        list
    }

    /// remove every session matching `pred` from cache and database
    async fn revoke_where(&self, pred: impl Fn(&str, &Session) -> bool) -> usize {
        let mut sessions = self.0.sessions.write().await;
        let doomed: Vec<(String, i64)> = sessions
            .iter()
            .filter(|(h, s)| pred(h, s))
            .map(|(h, s)| (h.clone(), s.id))
            .collect();
        if doomed.is_empty() {
            return 0;
        }
        let conn = self.conn().await;
        for (hash, id) in &doomed {
            sessions.remove(hash);
            if let Err(e) = conn.execute("DELETE FROM sessions WHERE id = ?1", params![id]) {
                eprintln!("failed to delete session {id}: {e}");
            }
        }
        doomed.len()
    }

    pub async fn revoke_session(&self, user_id: i64, id: i64) -> bool {
        self.revoke_where(|_, s| s.id == id && s.user_id == user_id)
            .await
            > 0
    }

    /// drop every session of this user except the one that made the request
    pub async fn revoke_other_sessions(&self, user_id: i64, keep_token: &str) -> usize {
        let keep = hash_token(keep_token);
        self.revoke_where(|h, s| s.user_id == user_id && h != keep)
            .await
    }

    /// sign a user out everywhere (password reset by an admin, account deleted)
    pub async fn revoke_user_sessions(&self, user_id: i64) -> usize {
        self.revoke_where(|_, s| s.user_id == user_id).await
    }

    pub async fn get_session(&self, token: &str) -> Option<i64> {
        let hash = hash_token(token);
        {
            let sessions = self.0.sessions.read().await;
            let s = sessions.get(&hash)?;
            if s.expires > Utc::now() {
                return Some(s.user_id);
            }
        }
        // expired tokens are evicted lazily instead of by a sweep thread
        self.revoke_where(|h, _| h == hash).await;
        None
    }

    pub async fn get_session_id(&self, token: &str) -> Option<i64> {
        let sessions = self.0.sessions.read().await;
        sessions
            .get(&hash_token(token))
            .filter(|s| s.expires > Utc::now())
            .map(|s| s.id)
    }

    pub async fn drop_session(&self, token: &str) {
        let hash = hash_token(token);
        self.revoke_where(|h, _| h == hash).await;
    }

    /// true while `key` is under `max` failures within the sliding window
    pub async fn attempt_allowed(&self, key: &str, max: usize) -> bool {
        let mut fails = self.0.failures.lock().await;
        let now = Utc::now();
        if let Some(times) = fails.get_mut(key) {
            times.retain(|t| now.signed_duration_since(*t) < FAILURE_WINDOW);
            if times.len() >= max {
                return false;
            }
        }
        true
    }

    pub async fn record_failure(&self, key: &str) {
        let mut fails = self.0.failures.lock().await;
        let now = Utc::now();
        if fails.len() >= FAILURE_MAP_SWEEP_AT {
            fails.retain(|_, times| {
                times
                    .back()
                    .is_some_and(|t| now.signed_duration_since(*t) < FAILURE_WINDOW)
            });
        }
        fails.entry(key.to_string()).or_default().push_back(now);
    }

    pub async fn clear_failures(&self, key: &str) {
        self.0.failures.lock().await.remove(key);
    }

    pub async fn get_user(&self, user_id: i64) -> Result<Option<User>> {
        let conn = self.conn().await;
        crate::users::find_by_id(&conn, user_id)
    }

    pub async fn conn(&self) -> tokio::sync::MutexGuard<'_, rusqlite::Connection> {
        self.0.db.lock().await
    }
}
