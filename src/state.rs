use crate::db;
use crate::error::Result;
use crate::users::User;
use chrono::{DateTime, Duration, Utc};
use rand::distributions::{Alphanumeric, DistString};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

const SESSION_TTL: Duration = Duration::days(7);
const LOGIN_WINDOW: Duration = Duration::minutes(1);
const LOGIN_MAX_FAILURES: usize = 5;

pub struct Session {
    pub id: u64,
    pub user_id: i64,
    pub created_at: DateTime<Utc>,
    pub user_agent: String,
    pub expires: DateTime<Utc>,
}

pub struct Inner {
    pub db: Mutex<rusqlite::Connection>,
    pub data_dir: PathBuf,
    sessions: RwLock<HashMap<String, Session>>,
    next_session_id: std::sync::atomic::AtomicU64,
    // ip|username -> recent failed logins; pruned on each check
    login_failures: Mutex<HashMap<String, VecDeque<DateTime<Utc>>>>,
}

#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

impl AppState {
    pub fn new(data_dir: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let conn = rusqlite::Connection::open(db::db_path(data_dir.as_ref()))?;
        // startup ensure: users created before folder shortcuts existed still
        // need their default folders before the first request resolves one
        if let Ok(list) = crate::users::list(&conn) {
            for u in &list {
                crate::storage::ensure_default_folders(&db::user_dir(data_dir.as_ref(), u.id));
            }
        }
        Ok(Self(Arc::new(Inner {
            db: Mutex::new(conn),
            data_dir: data_dir.as_ref().to_path_buf(),
            sessions: RwLock::new(HashMap::new()),
            next_session_id: std::sync::atomic::AtomicU64::new(1),
            login_failures: Mutex::new(HashMap::new()),
        })))
    }

    pub fn data_dir(&self) -> &Path {
        &self.0.data_dir
    }

    pub fn user_dir(&self, user_id: i64) -> PathBuf {
        db::user_dir(&self.0.data_dir, user_id)
    }

    pub async fn create_session(&self, user_id: i64, user_agent: &str) -> String {
        let token = Alphanumeric.sample_string(&mut rand::thread_rng(), 48);
        self.0.sessions.write().await.insert(
            token.clone(),
            Session {
                id: self
                    .0
                    .next_session_id
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                user_id,
                created_at: Utc::now(),
                user_agent: user_agent.to_string(),
                expires: Utc::now() + SESSION_TTL,
            },
        );
        token
    }

    pub async fn session_info(&self, user_id: i64) -> Vec<serde_json::Value> {
        let sessions = self.0.sessions.read().await;
        let mut list: Vec<_> = sessions
            .values()
            .filter(|s| s.user_id == user_id && s.expires >= Utc::now())
            .map(|s| {
                serde_json::json!({
                    "id": s.id,
                    "created_at": s.created_at.to_rfc3339(),
                    "user_agent": s.user_agent,
                })
            })
            .collect();
        list.sort_by_key(|v| v["id"].as_u64().unwrap_or_default());
        list
    }

    pub async fn revoke_session(&self, user_id: i64, id: u64) -> bool {
        let mut sessions = self.0.sessions.write().await;
        let Some(token) = sessions
            .iter()
            .find(|(_, s)| s.id == id && s.user_id == user_id)
            .map(|(t, _)| t.clone())
        else {
            return false;
        };
        sessions.remove(&token).is_some()
    }

    /// drop every session of this user except the one that made the request
    pub async fn revoke_other_sessions(&self, user_id: i64, keep: &str) -> usize {
        let mut sessions = self.0.sessions.write().await;
        let before = sessions.len();
        sessions.retain(|t, s| !(s.user_id == user_id && t != keep));
        before - sessions.len()
    }

    /// true when the key is under the failure cap within the sliding window
    pub async fn login_allowed(&self, key: &str) -> bool {
        let mut fails = self.0.login_failures.lock().await;
        let now = Utc::now();
        if let Some(times) = fails.get_mut(key) {
            times.retain(|t| now.signed_duration_since(*t) < LOGIN_WINDOW);
            if times.len() >= LOGIN_MAX_FAILURES {
                return false;
            }
        }
        true
    }

    pub async fn record_login_failure(&self, key: &str) {
        let mut fails = self.0.login_failures.lock().await;
        fails
            .entry(key.to_string())
            .or_default()
            .push_back(Utc::now());
    }

    pub async fn clear_login_failures(&self, key: &str) {
        self.0.login_failures.lock().await.remove(key);
    }

    pub async fn get_session(&self, token: &str) -> Option<i64> {
        {
            let sessions = self.0.sessions.read().await;
            let s = sessions.get(token)?;
            if s.expires >= Utc::now() {
                return Some(s.user_id);
            }
        }
        self.0.sessions.write().await.remove(token);
        None
    }

    pub async fn get_session_id(&self, token: &str) -> Option<u64> {
        let sessions = self.0.sessions.read().await;
        sessions
            .get(token)
            .filter(|s| s.expires >= Utc::now())
            .map(|s| s.id)
    }

    pub async fn drop_session(&self, token: &str) {
        self.0.sessions.write().await.remove(token);
    }

    pub async fn get_user(&self, user_id: i64) -> Result<Option<User>> {
        let conn = self.conn().await;
        crate::users::find_by_id(&conn, user_id)
    }

    pub async fn conn(&self) -> tokio::sync::MutexGuard<'_, rusqlite::Connection> {
        self.0.db.lock().await
    }
}
