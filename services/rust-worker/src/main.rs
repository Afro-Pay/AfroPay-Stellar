mod env;
#[cfg(test)]
mod integration_tests;
mod metrics;
mod models;
mod queue;
mod stellar;

use dotenv::dotenv;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    tracing_subscriber::fmt::init();

    env::validate_env();

    tracing::info!("🚀 Starting Rust Worker");

    tokio::spawn(metrics::serve());

    queue::listen().await?;

    Ok(())
}
