mod stellar;
mod queue;
mod models;
mod metrics;
mod env;

use anyhow::Result;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt::init();

    // Fail fast if required environment variables are missing
    env::validate_env();

    info!("Rust Worker starting...");
    // Start metrics server in background
    tokio::spawn(async move { metrics::serve().await });

    queue::listen().await
}
