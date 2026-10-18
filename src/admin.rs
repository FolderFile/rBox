use crate::auth::AuthUser;
use crate::error::{bad, other, AppError, Result};
use crate::state::AppState;
use crate::storage;
use crate::users::{self, User};
use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::Json;
use serde::Deserialize;

/// wraps AuthUser with the is_admin check so every /api/admin route gets 403
/// for free instead of repeating it per handler
pub struct AdminUser(pub User);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self> {
        let AuthUser { user } = AuthUser::from_request_parts(parts, state).await?;
        if !user.is_admin {
            return Err(AppError::Forbidden);
        }
        Ok(AdminUser(user))
    }
}

fn user_json(u: &User) -> serde_json::Value {
    serde_json::json!({
        "id": u.id,
        "username": u.username,
        "is_admin": u.is_admin,
        "used_bytes": u.used_bytes,
        "quota_bytes": u.quota_bytes,
        "created_at": u.created_at,
    })
}

pub async fn list_users(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<serde_json::Value>> {
    let conn = state.conn().await;
    let list = users::list(&conn)?
        .iter()
        .map(user_json)
        .collect::<Vec<_>>();
    Ok(Json(serde_json::json!({ "users": list })))
}

#[derive(Deserialize)]
pub struct CreateUserReq {
    username: String,
    password: String,
    quota_bytes: u64,
    #[serde(default)]
    is_admin: bool,
}

pub async fn create_user(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(req): Json<CreateUserReq>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>)> {
    let conn = state.conn().await;
    let id = users::create(
        &conn,
        &req.username,
        &req.password,
        req.quota_bytes,
        req.is_admin,
    )?;
    tokio::fs::create_dir_all(state.user_dir(id)).await?;
    crate::storage::ensure_default_folders(&state.user_dir(id));
    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({ "ok": true, "id": id })),
    ))
}

#[derive(Deserialize)]
pub struct UpdateUserReq {
    quota_bytes: Option<u64>,
    password: Option<String>,
    is_admin: Option<bool>,
}

pub async fn update_user(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(username): Path<String>,
    Json(req): Json<UpdateUserReq>,
) -> Result<Json<serde_json::Value>> {
    let conn = state.conn().await;
    let Some(user) = users::find_by_username(&conn, &username)? else {
        return Err(AppError::UserNotFound(username));
    };

    if let Some(q) = req.quota_bytes {
        users::set_quota(&conn, &user.username, q)?;
    }
    if let Some(ref p) = req.password {
        users::set_password(&conn, user.id, p)?;
    }
    if let Some(want_admin) = req.is_admin {
        // the last remaining admin cannot be demoted, or the box locks itself
        if user.is_admin && !want_admin && users::admin_count(&conn)? <= 1 {
            return Err(bad("cannot demote the last remaining admin account"));
        }
        if want_admin != user.is_admin {
            users::set_admin(&conn, user.id, want_admin)?;
        }
    }
    let user =
        users::find_by_id(&conn, user.id)?.ok_or_else(|| AppError::UserNotFound(username))?;
    Ok(Json(user_json(&user)))
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    #[serde(default)]
    purge: bool,
}

pub async fn delete_user(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(username): Path<String>,
    Query(q): Query<DeleteQuery>,
) -> Result<Json<serde_json::Value>> {
    if username.eq_ignore_ascii_case(&admin.0.username) {
        return Err(bad("cannot delete your own account"));
    }
    let conn = state.conn().await;
    let Some(user) = users::find_by_username(&conn, &username)? else {
        return Err(AppError::UserNotFound(username));
    };
    if user.is_admin && users::admin_count(&conn)? <= 1 {
        return Err(bad("cannot delete the last remaining admin account"));
    }
    let id = users::delete(&conn, &username)?;
    if q.purge {
        let dir = state.user_dir(id);
        if tokio::fs::try_exists(&dir).await? {
            tokio::task::spawn_blocking(move || storage::delete_path(&dir))
                .await
                .map_err(|e| other(format!("join error: {e}")))??;
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn recalc_user(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(username): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let conn = state.conn().await;
    let Some(user) = users::find_by_username(&conn, &username)? else {
        return Err(AppError::UserNotFound(username));
    };
    let actual = users::recalc(&conn, state.data_dir(), &user)?;
    Ok(Json(
        serde_json::json!({ "ok": true, "used_bytes": actual }),
    ))
}
