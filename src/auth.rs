use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::users::{self, User};
use axum::extract::{FromRequestParts, Path, State};
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

/// best-effort client key for the rate limiter; behind the cloudflare tunnel
/// the real ip arrives in x-forwarded-for
fn client_key(headers: &HeaderMap, username: &str) -> String {
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .unwrap_or("local")
        .trim();
    format!("{ip}|{}", username.to_lowercase())
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

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginReq>,
) -> Result<Response> {
    let key = client_key(&headers, &req.username);
    if !state.login_allowed(&key).await {
        return Err(AppError::TooManyRequests);
    }

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
        state.record_login_failure(&key).await;
        return Err(AppError::Unauthorized);
    }
    state.clear_login_failures(&key).await;

    let conn = state.conn().await;
    let user = users::find_by_username(&conn, &req.username)?.ok_or(AppError::Unauthorized)?;
    drop(conn);

    let agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let token = state.create_session(user.id, &agent).await;
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

#[derive(Deserialize)]
pub struct PasswordChangeReq {
    current_password: String,
    new_password: String,
}

/// changing your own password revokes every other session so a stolen cookie
/// dies with the old secret
pub async fn change_password(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(req): Json<PasswordChangeReq>,
) -> Result<Json<serde_json::Value>> {
    if req.new_password.len() < 8 {
        return Err(crate::error::bad("password must be at least 8 characters"));
    }
    let conn = state.conn().await;
    let hash: String = conn.query_row(
        "SELECT password_hash FROM users WHERE id = ?1",
        rusqlite::params![auth.user.id],
        |r| r.get(0),
    )?;
    if !users::verify_password(&req.current_password, &hash) {
        return Err(crate::error::bad("current password is wrong"));
    }
    users::set_password(&conn, auth.user.id, &req.new_password)?;
    drop(conn);

    let token = token_from_headers(&headers).unwrap_or_default();
    let revoked = state.revoke_other_sessions(auth.user.id, &token).await;
    Ok(Json(
        serde_json::json!({ "ok": true, "revoked_sessions": revoked }),
    ))
}

pub async fn sessions(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>> {
    let mut current: Option<u64> = None;
    if let Some(t) = token_from_headers(&headers) {
        current = state.get_session_id(&t).await;
    }
    let list = state.session_info(auth.user.id).await;
    let list: Vec<_> = list
        .into_iter()
        .map(|mut s| {
            s["current"] = (Some(s["id"].as_u64().unwrap_or_default()) == current).into();
            s
        })
        .collect();
    Ok(Json(serde_json::json!({ "sessions": list })))
}

pub async fn revoke_session(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<u64>,
) -> Result<Json<serde_json::Value>> {
    if state.revoke_session(auth.user.id, id).await {
        Ok(Json(serde_json::json!({ "ok": true })))
    } else {
        Err(AppError::NotFound("session not found".into()))
    }
}
