mod models;
mod stellar;
mod queue;
mod db;
mod sse;
mod metrics;

use dotenv::dotenv;
use std::env;
use std::sync::Arc;
use tracing::info;
use stellar::StellarService;
use models::TransactionJob;
use queue::QueueService;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("Starting Rust Worker with Horizon SSE Streaming");

    db::validate_env();

    let stellar_service = StellarService::new();
    let queue_service = QueueService::new().await?;
    let db_pool = db::create_pool().await?;

    // Start Horizon SSE listener in background
    let sse_db_pool = db_pool.clone();
    tokio::spawn(async move {
        if let Err(e) = sse::start_transaction_listener(sse_db_pool).await {
            tracing::error!("SSE listener terminated with error: {}", e);
        }
    });

    info!("Worker started. Processing transactions from queue...");

    loop {
        match queue_service.receive_job().await {
            Ok(Some(job)) => {
                info!("Processing job: {}", job.id);
                if let Err(e) = process_job(&stellar_service, job, &db_pool).await {
                    tracing::error!("Job failed: {}", e);
                }
            }
            Ok(None) => {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
            Err(e) => {
                tracing::error!("Queue error: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn process_job(
    stellar_service: &StellarService,
    job: TransactionJob,
    db_pool: &Arc<sqlx::PgPool>,
) -> Result<(), Box<dyn std::error::Error>> {
    let user_secret = env::var("USER_SECRET_KEY")
        .expect("USER_SECRET_KEY must be set");
    let user_keypair = stellar_sdk::Keypair::from_secret(&user_secret)?;

    let cosigner_keypair = if let Ok(cosigner_secret) = env::var("COSIGNER_SECRET") {
        Some(stellar_sdk::Keypair::from_secret(&cosigner_secret)?)
    } else {
        None
    };

    let requires_cosign = job.requires_cosign;

    let config = stellar::SigningConfig {
        requires_cosign,
        user_keypair,
        cosigner_keypair,
    };

    // Update status to submitting
    db::update_transaction_status(db_pool, &job.id, "submitting").await?;

    let transaction = stellar_service.build_transaction(
        &job.source_wallet,
        &job.destination_wallet,
        &job.amount,
        &job.asset_code,
        &job.asset_issuer,
        job.memo.as_deref(),
        &config,
    ).await?;

    let hash = stellar_service.submit_transaction(&transaction).await?;

    // Store the transaction hash for SSE matching
    db::store_stellar_tx_hash(db_pool, &job.id, &hash).await?;

    tracing::info!(
        status = "submitting",
        stellar_tx_hash = %hash,
        job_id = %job.id,
        "Transaction submitted, awaiting confirmation via SSE"
    );

    Ok(())
}
