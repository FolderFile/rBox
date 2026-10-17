use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "rbox",
    version,
    about = "rbox - self-hosted, multi-user file manager and web server"
)]
pub struct Cli {
    /// Root data directory holding the database and user storage.
    #[arg(long, global = true, default_value = "/var/lib/rbox")]
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
        /// Address and port to listen on.
        #[arg(long, default_value = "0.0.0.0")]
        bind: String,
        #[arg(long, default_value_t = 8000)]
        port: u16,
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
