use crate::{admin, auth, files, shares, state::AppState, transfer};
use axum::routing::{delete, get, patch, post};
use axum::Router;

pub fn build(state: AppState) -> Router {
    Router::new()
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/files", get(files::list).delete(files::delete))
        .route("/api/files/mkdir", post(files::mkdir))
        .route("/api/files/rename", post(files::rename))
        .route("/api/files/move", post(files::move_path))
        .route("/api/files/copy", post(files::copy))
        .route(
            "/api/files/content",
            get(files::read_content).put(files::write_content),
        )
        .route("/api/files/upload", post(transfer::upload))
        .route("/api/files/download", get(transfer::download))
        .route("/api/files/zip", get(transfer::zip))
        .route("/api/shares", get(shares::list).post(shares::create))
        .route("/api/shares/{token}", delete(shares::revoke))
        .route("/s/{token}/info", get(shares::info))
        .route("/s/{token}/download", get(shares::download))
        .route(
            "/api/admin/users",
            get(admin::list_users).post(admin::create_user),
        )
        .route(
            "/api/admin/users/{username}",
            patch(admin::update_user).delete(admin::delete_user),
        )
        .route(
            "/api/admin/users/{username}/recalc",
            post(admin::recalc_user),
        )
        .fallback(crate::static_files::serve)
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn spa_fallback_serves_index() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open(dir.path()).unwrap();
        crate::db::init_schema(&conn).unwrap();
        let app = build(crate::state::AppState::new(dir.path()).unwrap());
        use tower::ServiceExt;
        let res = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/some/client/route")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), axum::http::StatusCode::OK);
        let body = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(String::from_utf8_lossy(&body).contains("rbox web frontend"));
    }
}
