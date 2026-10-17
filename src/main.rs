use clap::Parser;
use rbox::{cli, commands};

#[tokio::main]
async fn main() {
    let cli = cli::Cli::parse();
    if let Err(err) = commands::dispatch(cli).await {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}
