use crate::{auth, files, state::AppState, transfer};
use axum::routing::{get, post};
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
        .with_state(state)
}
