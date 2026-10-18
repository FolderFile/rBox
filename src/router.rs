use crate::{admin, archive, auth, files, shares, state::AppState, transfer};
use axum::extract::Request;
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::{delete, get, patch, post};
use axum::Router;

pub fn build(state: AppState) -> Router {
    Router::new()
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/password", post(auth::change_password))
        .route("/api/auth/sessions", get(auth::sessions))
        .route("/api/auth/sessions/{id}", delete(auth::revoke_session))
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
        .route("/api/files/stat", get(archive::stat))
        .route("/api/files/search", get(archive::search))
        .route("/api/files/archive", post(archive::create))
        .route("/api/files/archive/list", get(archive::list))
        .route("/api/files/extract", post(archive::extract))
        .route("/api/shares", get(shares::list).post(shares::create))
        .route("/api/shares/{token}", delete(shares::revoke))
        .route("/s/{token}", get(shares::landing))
        .route("/s/{token}/info", get(shares::info))
        .route("/s/{token}/download", get(shares::download))
        .route("/s/{token}/raw", get(shares::raw))
        .route("/s/{token}/raw/{filename}", get(shares::raw_named))
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
        .layer(axum::middleware::from_fn(security_headers))
        .with_state(state)
}

async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static("SAMEORIGIN"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_assets_never_serve_html_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open(dir.path()).unwrap();
        crate::db::init_schema(&conn).unwrap();
        let app = build(crate::state::AppState::new(dir.path()).unwrap());
        use tower::ServiceExt;
        for uri in ["/assets/retired-chunk-abc123.js", "/old.css", "/logo.svg"] {
            let res = app
                .clone()
                .oneshot(
                    axum::http::Request::builder()
                        .uri(uri)
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let ct = res.headers()["content-type"].to_str().unwrap();
            assert_eq!(res.status(), axum::http::StatusCode::NOT_FOUND, "{uri}");
            assert!(
                !ct.starts_with("text/html"),
                "{uri} must not fall back to HTML"
            );
        }
    }

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
        assert!(String::from_utf8_lossy(&body).contains("id=\"root\""));
    }
}
