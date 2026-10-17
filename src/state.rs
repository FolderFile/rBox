use crate::db;
use crate::error::Result;
use crate::users::User;
use chrono::{DateTime, Duration, Utc};
use rand::distributions::{Alphanumeric, DistString};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

const SESSION_TTL: Duration = Duration::days(7);

pub struct Session {
    pub user_id: i64,
    pub expires: DateTime<Utc>,
}

pub struct Inner {
    pub db: Mutex<rusqlite::Connection>,
    pub data_dir: PathBuf,
    sessions: RwLock<HashMap<String, Session>>,
}

#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

impl AppState {
    pub fn new(data_dir: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let conn = rusqlite::Connection::open(db::db_path(data_dir.as_ref()))?;
        Ok(Self(Arc::new(Inner {
            db: Mutex::new(conn),
            data_dir: data_dir.as_ref().to_path_buf(),
            sessions: RwLock::new(HashMap::new()),
        })))
    }

    pub fn user_dir(&self, user_id: i64) -> PathBuf {
        db::user_dir(&self.0.data_dir, user_id)
    }

    pub async fn create_session(&self, user_id: i64) -> String {
        let token = Alphanumeric.sample_string(&mut rand::thread_rng(), 48);
        self.0.sessions.write().await.insert(
            token.clone(),
            Session {
                user_id,
                expires: Utc::now() + SESSION_TTL,
            },
        );
        token
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
