use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::users::{self, User};
use axum::extract::{FromRequestParts, State};
use axum::http::header;
use axum::http::request::Parts;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

pub const COOKIE_NAME: &str = "rbox_session";

pub struct AuthUser {
    pub user: User,
}

fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie.split(';').find_map(|p| {
        p.trim()
            .strip_prefix(&format!("{COOKIE_NAME}="))
            .map(str::to_string)
    })
}

fn user_json(u: &User) -> serde_json::Value {
    serde_json::json!({
        "username": u.username,
        "is_admin": u.is_admin,
        "used_bytes": u.used_bytes,
        "quota_bytes": u.quota_bytes,
    })
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self> {
        let Some(token) = token_from_headers(&parts.headers) else {
            return Err(AppError::Unauthorized);
        };
        // expired tokens are evicted lazily here instead of a sweep thread
        let Some(user_id) = state.get_session(&token).await else {
            return Err(AppError::Unauthorized);
        };
        let Some(user) = state.get_user(user_id).await? else {
            return Err(AppError::Unauthorized);
        };
        Ok(AuthUser { user })
    }
}

#[derive(Deserialize)]
pub struct LoginReq {
    username: String,
    password: String,
}

pub async fn login(State(state): State<AppState>, Json(req): Json<LoginReq>) -> Result<Response> {
    let hash = {
        let conn = state.conn().await;
        users::find_by_username(&conn, &req.username)?
            .map(|_| {
                conn.query_row(
                    "SELECT password_hash FROM users WHERE username = ?1 COLLATE NOCASE",
                    rusqlite::params![req.username],
                    |r| r.get::<_, String>(0),
                )
            })
            .transpose()?
    };

    let ok = hash
        .as_deref()
        .is_some_and(|h| users::verify_password(&req.password, h));
    if !ok {
        return Err(AppError::Unauthorized);
    }

    let conn = state.conn().await;
    let user = users::find_by_username(&conn, &req.username)?.ok_or(AppError::Unauthorized)?;
    drop(conn);

    let token = state.create_session(user.id).await;
    let cookie = format!("{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800");
    Ok(([(header::SET_COOKIE, cookie)], Json(user_json(&user))).into_response())
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = token_from_headers(&headers) {
        state.drop_session(&token).await;
    }
    let cookie = format!("{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    (
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({ "ok": true })),
    )
        .into_response()
}

pub async fn me(auth: AuthUser) -> Json<serde_json::Value> {
    Json(user_json(&auth.user))
}
