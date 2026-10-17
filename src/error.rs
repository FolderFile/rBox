use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("user '{0}' already exists")]
    UserExists(String),

    #[error("user '{0}' not found")]
    UserNotFound(String),

    #[error("invalid username: {0}")]
    InvalidUsername(String),

    #[error("invalid size '{0}'")]
    InvalidSize(String),

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
