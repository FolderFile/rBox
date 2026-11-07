use crate::cli;
use crate::db;
use crate::error::{other, AppError, Result};
use crate::size::{format_size, parse_size};
use crate::storage;
use crate::users;
use crate::{router, state::AppState};
use std::io::Write;
use std::path::Path;

pub fn run_init(
    data_dir: &Path,
    admin_user: Option<String>,
    admin_password: Option<String>,
    admin_quota: &str,
) -> Result<()> {
    if db::is_initialized(data_dir) {
        return Err(AppError::AlreadyInitialized(data_dir.to_path_buf()));
    }
    let quota = parse_size(admin_quota)?;

    let username = match admin_user {
        Some(u) => u,
        None => prompt("Admin username: ")?,
    };
    users::validate_username(&username)?;

    let password = match admin_password {
        Some(p) => p,
        None => {
            let first = rpassword::prompt_password("Admin password: ")?;
            let second = rpassword::prompt_password("Confirm password: ")?;
            if first != second {
                return Err(other("passwords do not match"));
            }
            first
        }
    };
    let conn = db::open(data_dir)?;
    db::init_schema(&conn)?;
    let admin_id = users::create(&conn, &username, &password, quota, true)?;

    let root = db::user_dir(data_dir, admin_id);
    std::fs::create_dir_all(&root)?;
    storage::ensure_default_folders(&root);

    println!("Initialized rbox in {}", data_dir.display());
    println!(
        "Admin '{}' created with {} quota",
        username,
        format_size(quota)
    );
    println!("User storage root: {}", db::users_root(data_dir).display());
    Ok(())
}

pub fn run_user_add(
    data_dir: &Path,
    username: &str,
    password: Option<String>,
    quota: &str,
) -> Result<()> {
    db::require_initialized(data_dir)?;
    let quota = parse_size(quota)?;
    let password = match password {
        Some(p) => p,
        None => rpassword::prompt_password(format!("Password for '{username}': "))?,
    };
    let conn = db::open(data_dir)?;
    let id = users::create(&conn, username, &password, quota, false)?;
    let root = db::user_dir(data_dir, id);
    std::fs::create_dir_all(&root)?;
    storage::ensure_default_folders(&root);
    println!("Added user '{username}' (quota {})", format_size(quota));
    Ok(())
}

pub fn run_user_list(data_dir: &Path) -> Result<()> {
    db::require_initialized(data_dir)?;
    let conn = db::open(data_dir)?;

    println!(
        "{:<5} {:<24} {:>12} {:>12} {:<8}",
        "ID", "USERNAME", "USED", "QUOTA", "ADMIN"
    );
    for u in users::list(&conn)? {
        let created = &u.created_at;
        println!(
            "{:<5} {:<24} {:>12} {:>12} {:<8} {}",
            u.id,
            u.username,
            format_size(u.used_bytes.max(0) as u64),
            format_size(u.quota_bytes.max(0) as u64),
            if u.is_admin { "yes" } else { "no" },
            created
        );
    }
    Ok(())
}

pub fn run_user_quota(data_dir: &Path, username: &str, new_size: &str) -> Result<()> {
    db::require_initialized(data_dir)?;
    let quota = parse_size(new_size)?;
    let conn = db::open(data_dir)?;
    let user = users::set_quota(&conn, username, quota)?;
    println!(
        "Quota for '{}' is now {} (used: {})",
        user.username,
        format_size(quota),
        format_size(user.used_bytes.max(0) as u64)
    );
    Ok(())
}

pub fn run_user_delete(data_dir: &Path, username: &str, purge: bool) -> Result<()> {
    db::require_initialized(data_dir)?;
    let conn = db::open(data_dir)?;
    let Some(user) = users::find_by_username(&conn, username)? else {
        return Err(AppError::UserNotFound(username.to_string()));
    };
    // keep at least one admin around
    if user.is_admin && users::list(&conn)?.iter().filter(|u| u.is_admin).count() == 1 {
        return Err(other("cannot delete the last remaining admin account"));
    }

    users::delete(&conn, username)?;
    if purge {
        let dir = db::user_dir(data_dir, user.id);
        if dir.exists() {
            storage::delete_path(&dir)?;
        }
    }
    println!(
        "Deleted user '{username}'{}",
        if purge { " and purged their files" } else { "" }
    );
    Ok(())
}

pub fn run_user_recalc(data_dir: &Path, username: Option<&str>) -> Result<()> {
    db::require_initialized(data_dir)?;
    let conn = db::open(data_dir)?;
    let targets = match username {
        Some(name) => {
            let u = users::find_by_username(&conn, name)?
                .ok_or_else(|| AppError::UserNotFound(name.to_string()))?;
            vec![u]
        }
        None => users::list(&conn)?,
    };

    for u in &targets {
        let actual = users::recalc(&conn, data_dir, u)?;
        users::set_used_bytes(&conn, u.id, actual)?;
        println!(
            "{:<24} {:>12} (db: {:>12}, delta: {:+})",
            u.username,
            format_size(actual),
            format_size(u.used_bytes.max(0) as u64),
            actual as i64 - u.used_bytes
        );
    }
    Ok(())
}

pub async fn run_serve(data_dir: &Path, bind: &str, port: u16, trust_proxy: bool) -> Result<()> {
    db::require_initialized(data_dir)?;
    {
        let conn = db::open(data_dir)?;
        let version = db::schema_version(&conn)?;
        if version != db::SCHEMA_VERSION {
            return Err(other(format!(
                "database schema version {version} is newer than supported version {}",
                db::SCHEMA_VERSION
            )));
        }
    }

    let state = AppState::new(data_dir)?.with_trust_proxy(trust_proxy);
    let app = router::build(state);

    // bare ipv6 addresses need brackets to combine with a port
    let addr = if bind.contains(':') && !bind.starts_with('[') {
        format!("[{bind}]:{port}")
    } else {
        format!("{bind}:{port}")
    };
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| other(format!("cannot bind {addr}: {e}")))?;
    println!(
        "rbox {} listening on http://{addr}{}",
        env!("CARGO_PKG_VERSION"),
        if trust_proxy {
            " (trusting proxy headers)"
        } else {
            ""
        }
    );
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .map_err(|e| other(format!("server error: {e}")))?;
    println!("rbox stopped");
    Ok(())
}

/// ctrl-c or SIGTERM (systemd, docker stop): stop accepting, let in-flight
/// requests finish, then exit cleanly
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = term => {},
    }
    println!("shutting down…");
}

pub fn run_user_passwd(data_dir: &Path, username: &str, password: Option<String>) -> Result<()> {
    db::require_initialized(data_dir)?;
    let conn = db::open(data_dir)?;
    let user = users::find_by_username(&conn, username)?
        .ok_or_else(|| AppError::UserNotFound(username.to_string()))?;
    let password = match password {
        Some(p) => p,
        None => {
            let first =
                rpassword::prompt_password(format!("New password for '{}': ", user.username))?;
            let second = rpassword::prompt_password("Confirm password: ")?;
            if first != second {
                return Err(other("passwords do not match"));
            }
            first
        }
    };
    users::set_password(&conn, user.id, &password)?;
    let revoked = conn.execute(
        "DELETE FROM sessions WHERE user_id = ?1",
        rusqlite::params![user.id],
    )?;
    println!(
        "Password for '{}' updated; {revoked} session(s) revoked{}",
        user.username,
        if revoked > 0 {
            " (restart a running server for it to drop them from memory)"
        } else {
            ""
        }
    );
    Ok(())
}

fn prompt(msg: &str) -> Result<String> {
    print!("{msg}");
    std::io::stdout().flush()?;
    let mut input = String::new();
    std::io::stdin().read_line(&mut input)?;
    let s = input.trim().to_string();
    if s.is_empty() {
        return Err(other("input must not be empty"));
    }
    Ok(s)
}

pub async fn dispatch(cli: cli::Cli) -> Result<()> {
    match cli.command {
        cli::Command::Init {
            admin_user,
            admin_password,
            admin_quota,
        } => run_init(&cli.data_dir, admin_user, admin_password, &admin_quota),
        cli::Command::Serve {
            bind,
            port,
            trust_proxy,
        } => run_serve(&cli.data_dir, &bind, port, trust_proxy).await,
        cli::Command::User(cmd) => match cmd {
            cli::UserCommand::Add {
                username,
                password,
                quota,
            } => run_user_add(&cli.data_dir, &username, password, &quota),
            cli::UserCommand::List => run_user_list(&cli.data_dir),
            cli::UserCommand::Passwd { username, password } => {
                run_user_passwd(&cli.data_dir, &username, password)
            }
            cli::UserCommand::Quota { username, new_size } => {
                run_user_quota(&cli.data_dir, &username, &new_size)
            }
            cli::UserCommand::Delete { username, purge } => {
                run_user_delete(&cli.data_dir, &username, purge)
            }
            cli::UserCommand::Recalc { username } => {
                run_user_recalc(&cli.data_dir, username.as_deref())
            }
        },
    }
}
