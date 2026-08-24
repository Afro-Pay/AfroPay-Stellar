mod env;
#[cfg(test)]
mod integration_tests;
mod metrics;
mod models;
mod queue;
mod lock_manager;

use dotenv::dotenv;
use std::env;
use redis::Client;
use stellar_sdk::Keypair;
use stellar::StellarService;
use models::TransactionJob;
use queue::QueueService;
use lock_manager::LockManager;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    tracing_subscriber::fmt::init();

    env::validate_env();

    tracing::info!("🚀 Starting Rust Worker");

    tokio::spawn(metrics::serve());

    queue::listen().await?;

async fn process_job(
    stellar_service: &StellarService,
    job: TransactionJob,
    cosigner_keypair: &Option<Keypair>,
    threshold_usd: f64,
) -> Result<(), Box<dyn std::error::Error>> {
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());
    let lock_manager = LockManager::new(Client::open(redis_url)?);
    let lock = lock_manager
        .acquire(format!("lock:escrow:{}", job.id))
        .await?;

    // Load user's keypair (in production, securely retrieve from vault)
    let user_secret = env::var("USER_SECRET_KEY")
        .expect("USER_SECRET_KEY must be set");
    let user_keypair = Keypair::from_secret(&user_secret)?;
    
    // Determine if cosign is required
    let requires_cosign = job.requires_cosign;
    
    let config = stellar::SigningConfig {
        requires_cosign,
        user_keypair,
        cosigner_keypair: cosigner_keypair.clone(),
    };
    
    // Build and sign transaction
    let transaction = stellar_service.build_transaction(
        &job.source_wallet,
        &job.destination_wallet,
        &job.amount,
        &job.asset_code,
        &job.asset_issuer,
        job.memo.as_deref(),
        &config,
    ).await?;
    
    // Submit to network
    let hash = stellar_service.submit_transaction(&transaction).await?;
    
    println!("✅ Transaction submitted successfully!");
    println!("   Hash: {}", hash);
    println!("   Signatures: {}", if requires_cosign { 2 } else { 1 });

    lock.release().await?;
    
    Ok(())
}
