mod stellar;
mod queue;
mod models;
mod metrics;

use anyhow::Result;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    tracing_subscriber::fmt::init();

    info!("RemitX Rust Worker starting...");
    // Start metrics server in background
    tokio::spawn(async move { metrics::serve().await });

    queue::listen().await
}
