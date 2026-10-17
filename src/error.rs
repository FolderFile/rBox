use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(std::io::Error),

    #[error("{0}")]
    BadRequest(String),

    #[error("unauthorized")]
    Unauthorized,

    // reserved for share-link and admin endpoints in a later step
    #[allow(dead_code)]
    #[error("forbidden")]
    Forbidden,

    #[error("not found: {0}")]
    NotFound(String),

    #[error("user '{0}' already exists")]
    UserExists(String),

    #[error("user '{0}' not found")]
    UserNotFound(String),

    #[error("invalid username: {0}")]
    InvalidUsername(String),

    #[error("invalid size '{0}'")]
    InvalidSize(String),

    #[error("quota exceeded (limit: {0})")]
    QuotaExceeded(String),

    #[error("too many failed logins, wait a minute and try again")]
    TooManyRequests,

    // code is "password_required" or "invalid_archive_password"; the body
    // carries {"error": code, "encrypted": true} so the frontend can prompt
    #[error("{0}")]
    ArchivePassword(&'static str),

    #[error("archive error: {0}")]
    Archive(#[from] zip::result::ZipError),

    #[error("range not satisfiable")]
    UnsatisfiableRange,

    #[error("rbox is not initialized in '{0}'; run `rbox init` first")]
    NotInitialized(std::path::PathBuf),

    #[error("already initialized in '{0}'")]
    AlreadyInitialized(std::path::PathBuf),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, AppError>;

pub fn other(msg: impl Into<String>) -> AppError {
    AppError::Other(msg.into())
}

pub fn bad(msg: impl Into<String>) -> AppError {
    AppError::BadRequest(msg.into())
}

// a missing file/directory is a plain 404, never a 500 io error; this also
// covers the window between share creation and the file being deleted
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound("file or directory not found".into())
        } else {
            AppError::Io(e)
        }
    }
}

impl AppError {
    fn status(&self) -> StatusCode {
        match self {
            AppError::BadRequest(_) | AppError::InvalidUsername(_) | AppError::InvalidSize(_) => {
                StatusCode::BAD_REQUEST
            }
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::NotFound(_) | AppError::UserNotFound(_) => StatusCode::NOT_FOUND,
            AppError::UserExists(_) | AppError::AlreadyInitialized(_) => StatusCode::CONFLICT,
            AppError::QuotaExceeded(_) => StatusCode::PAYLOAD_TOO_LARGE,
            AppError::TooManyRequests => StatusCode::TOO_MANY_REQUESTS,
            AppError::ArchivePassword(_) => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::UnsatisfiableRange => StatusCode::RANGE_NOT_SATISFIABLE,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if let AppError::ArchivePassword(code) = self {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({ "error": code, "encrypted": true })),
            )
                .into_response();
        }
        let status = self.status();
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            eprintln!("internal error: {self:?}");
        }
        (
            status,
            Json(serde_json::json!({ "error": self.to_string() })),
        )
            .into_response()
    }
}
