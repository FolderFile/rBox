use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "rbox",
    version,
    about = "rbox - self-hosted, multi-user file manager and web server"
)]
pub struct Cli {
    /// Root data directory holding the database and user storage.
    #[arg(
        long,
        global = true,
        default_value = "/var/lib/rbox",
        env = "RBOX_DATA_DIR"
    )]
    pub data_dir: std::path::PathBuf,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Initialize the data directory, database, and initial admin account.
    Init {
        /// Name of the initial admin account.
        #[arg(long)]
        admin_user: Option<String>,
        /// Password for the admin account (prompted interactively if omitted).
        #[arg(long)]
        admin_password: Option<String>,
        /// Storage quota for the admin account.
        #[arg(long, default_value = "10GB")]
        admin_quota: String,
    },
    /// Start the HTTP server.
    Serve {
        /// Address to listen on.
        #[arg(long, default_value = "0.0.0.0", env = "RBOX_BIND")]
        bind: String,
        /// Port to listen on.
        #[arg(long, default_value_t = 8000, env = "RBOX_PORT")]
        port: u16,
        /// Trust X-Forwarded-For / CF-Connecting-IP / X-Forwarded-Proto for
        /// client addresses. Enable only behind a reverse proxy or tunnel
        /// that sets them; otherwise clients could spoof them.
        #[arg(long, env = "RBOX_TRUST_PROXY")]
        trust_proxy: bool,
    },
    /// Manage user accounts.
    #[command(subcommand)]
    User(UserCommand),
}

#[derive(Subcommand)]
pub enum UserCommand {
    /// Add a new user.
    Add {
        username: String,
        #[arg(long)]
        password: Option<String>,
        /// Storage quota, e.g. 500MB, 10GB, 1073741824.
        #[arg(long)]
        quota: String,
    },
    /// List all users.
    List,
    /// Set a new password for a user and sign them out everywhere.
    Passwd {
        username: String,
        /// New password (prompted interactively if omitted).
        #[arg(long)]
        password: Option<String>,
    },
    /// Change a user's storage quota.
    Quota {
        username: String,
        /// New quota, e.g. 500MB, 10GB.
        new_size: String,
    },
    /// Delete a user and their stored files.
    Delete {
        username: String,
        /// Delete the user's files on disk as well.
        #[arg(long)]
        purge: bool,
    },
    /// Recalculate used storage from disk.
    Recalc {
        /// Username to recalculate (omitting it recalculates every user).
        username: Option<String>,
    },
}
