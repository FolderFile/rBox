//! Every write that changes how many bytes a user owns goes through `commit`.
//! Data is staged first (streamed, copied, extracted, encoded) without holding
//! any lock; then `commit` takes the database lock, re-reads the user's real
//! usage and quota, lets the caller check its delta and move the staged data
//! into place with a cheap rename, and books the delta before releasing the
//! lock. Concurrent requests therefore can't spend the same headroom twice,
//! and nothing ever lands on disk without being counted.

use crate::error::{AppError, Result};
use crate::size::format_size;
use crate::state::AppState;
use crate::users;
use rusqlite::params;

#[derive(Debug, Clone, Copy)]
pub struct Budget {
    pub used: i64,
    pub quota: i64,
}

impl Budget {
    /// bytes still available; never negative even if an admin shrank the quota
    pub fn headroom(&self) -> i64 {
        (self.quota - self.used).max(0)
    }

    /// growth is checked against the quota; shrinking is always allowed
    pub fn check(&self, delta: i64) -> Result<()> {
        if delta > 0 && self.used + delta > self.quota {
            return Err(self.exceeded());
        }
        Ok(())
    }

    pub fn exceeded(&self) -> AppError {
        AppError::QuotaExceeded(format_size(self.quota.max(0) as u64))
    }
}

fn read(conn: &rusqlite::Connection, user_id: i64) -> Result<Budget> {
    Ok(conn.query_row(
        "SELECT used_bytes, quota_bytes FROM users WHERE id = ?1",
        params![user_id],
        |r| {
            Ok(Budget {
                used: r.get(0)?,
                quota: r.get(1)?,
            })
        },
    )?)
}

/// fresh snapshot for early aborts while streaming; `commit` re-checks anyway
pub async fn budget(state: &AppState, user_id: i64) -> Result<Budget> {
    let conn = state.conn().await;
    read(&conn, user_id)
}

/// run `place` under the database lock with the user's current budget; it
/// returns its result plus the byte delta it caused, which is recorded before
/// the lock is released. `place` must stay cheap (stat + rename), since every
/// other request waits on the same lock.
pub async fn commit<T>(
    state: &AppState,
    user_id: i64,
    place: impl FnOnce(&Budget) -> Result<(T, i64)>,
) -> Result<T> {
    let mut conn = state.conn().await;
    let budget = read(&conn, user_id)?;
    let (out, delta) = place(&budget)?;
    if delta != 0 {
        users::adjust_used_bytes(&mut conn, user_id, delta)?;
    }
    Ok(out)
}
