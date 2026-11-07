use crate::error::{AppError, Result};
use crate::state::{AppState, LOGIN_MAX_FAILURES};
use crate::users::{self, User};
use axum::extract::{ConnectInfo, FromRequestParts, Path, State};
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

/// the client address used to key rate limits. proxy headers are client
/// controlled, so they only count with `serve --trust-proxy` (e.g. behind a
/// cloudflare tunnel or nginx); otherwise the socket peer address is used.
pub struct ClientIp(pub String);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> std::result::Result<Self, Self::Rejection> {
        let header = |name: &str| {
            parts
                .headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::trim)
                .filter(|v| !v.is_empty())
        };
        if state.trust_proxy() {
            // the right-most forwarded hop is the one our proxy appended
            let forwarded = header("x-forwarded-for")
                .and_then(|v| v.rsplit(',').next())
                .map(str::trim);
            if let Some(ip) = header("cf-connecting-ip")
                .or_else(|| header("x-real-ip"))
                .or(forwarded)
            {
                return Ok(ClientIp(ip.to_string()));
            }
        }
        let peer = parts
            .extensions
            .get::<ConnectInfo<std::net::SocketAddr>>()
            .map(|c| c.0.ip().to_string())
            .unwrap_or_else(|| "unknown".into());
        Ok(ClientIp(peer))
    }
}

/// verifying against a fixed hash when the username doesn't exist keeps the
/// response time flat, so login timing can't be used to enumerate accounts
fn dummy_hash() -> &'static str {
    static HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    HASH.get_or_init(|| users::hash_password("rbox-timing-equalizer").unwrap_or_default())
}

/// `Secure` is added when the request reached us over https via a proxy;
/// setting it on plain-http LAN installs would make the cookie vanish
fn session_cookie(headers: &HeaderMap, value: &str, max_age: i64) -> String {
    let https = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("https"));
    format!(
        "{COOKIE_NAME}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{}",
        if https { "; Secure" } else { "" }
    )
}

fn user_json(u: &User) -> serde_json::Value {
    serde_json::json!({
        "username": u.username,
        "is_admin": u.is_admin,
        "used_bytes": u.used_bytes,
        "quota_bytes": u.quota_bytes,
        "version": env!("CARGO_PKG_VERSION"),
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
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Json(req): Json<LoginReq>,
) -> Result<Response> {
    let key = format!("login|{ip}|{}", req.username.to_lowercase());
    if !state.attempt_allowed(&key, LOGIN_MAX_FAILURES).await {
        return Err(AppError::TooManyRequests);
    }

    let found = {
        let conn = state.conn().await;
        match users::find_by_username(&conn, &req.username)? {
            Some(user) => {
                let hash: String = conn.query_row(
                    "SELECT password_hash FROM users WHERE id = ?1",
                    rusqlite::params![user.id],
                    |r| r.get(0),
                )?;
                Some((user, hash))
            }
            None => None,
        }
    };
    // argon2 is deliberately slow: run it off the async workers
    let password = req.password;
    let user = tokio::task::spawn_blocking(move || match found {
        Some((user, hash)) => users::verify_password(&password, &hash).then_some(user),
        None => {
            users::verify_password(&password, dummy_hash());
            None
        }
    })
    .await
    .map_err(|e| crate::error::other(format!("join error: {e}")))?;
    let Some(user) = user else {
        state.record_failure(&key).await;
        return Err(AppError::Unauthorized);
    };
    state.clear_failures(&key).await;

    let agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = state.create_session(user.id, agent).await?;
    let cookie = session_cookie(&headers, &token, crate::state::SESSION_TTL.num_seconds());
    Ok(([(header::SET_COOKIE, cookie)], Json(user_json(&user))).into_response())
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = token_from_headers(&headers) {
        state.drop_session(&token).await;
    }
    (
        [(header::SET_COOKIE, session_cookie(&headers, "", 0))],
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
    let mut current: Option<i64> = None;
    if let Some(t) = token_from_headers(&headers) {
        current = state.get_session_id(&t).await;
    }
    let list = state.session_info(auth.user.id).await;
    let list: Vec<_> = list
        .into_iter()
        .map(|mut s| {
            s["current"] = (s["id"].as_i64() == current).into();
            s
        })
        .collect();
    Ok(Json(serde_json::json!({ "sessions": list })))
}

pub async fn revoke_session(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>> {
    if state.revoke_session(auth.user.id, id).await {
        Ok(Json(serde_json::json!({ "ok": true })))
    } else {
        Err(AppError::NotFound("session not found".into()))
    }
}
