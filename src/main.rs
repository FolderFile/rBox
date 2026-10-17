mod cli;
mod commands;
mod db;
mod error;
mod size;
mod storage;
mod users;

use clap::Parser;

fn main() {
    let cli = cli::Cli::parse();
    if let Err(err) = commands::dispatch(cli) {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}
