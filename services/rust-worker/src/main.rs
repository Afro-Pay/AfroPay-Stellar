mod models;
mod stellar;
mod queue;

use dotenv::dotenv;
use std::env;
use stellar_sdk::Keypair;
use stellar::StellarService;
use models::TransactionJob;
use queue::QueueService;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    
    println!("🚀 Starting Rust Worker with Multi-Signature Support");
    
    let stellar_service = StellarService::new();
    let queue_service = QueueService::new().await?;
    
    // Load cosigner keypair (if configured)
    let cosigner_keypair = if let Ok(cosigner_secret) = env::var("COSIGNER_SECRET") {
        println!("✅ Cosigner keypair loaded from environment");
        Some(Keypair::from_secret(&cosigner_secret)?)
    } else {
        println!("ℹ️ No cosigner key configured - multi-sig disabled");
        None
    };
    
    let threshold_usd = env::var("MULTISIG_THRESHOLD_USD")
        .unwrap_or_else(|_| "10000".to_string())
        .parse::<f64>()
        .unwrap_or(10000.0);
    
    println!("📊 Multi-sig threshold: ${} USD", threshold_usd);
    
    // Process transactions from queue
    loop {
        match queue_service.receive_job().await {
            Ok(Some(job)) => {
                println!("📋 Processing job: {}", job.id);
                if let Err(e) = process_job(&stellar_service, job, &cosigner_keypair, threshold_usd).await {
                    eprintln!("❌ Job failed: {}", e);
                }
            }
            Ok(None) => {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
            Err(e) => {
                eprintln!("❌ Queue error: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn process_job(
    stellar_service: &StellarService,
    job: TransactionJob,
    cosigner_keypair: &Option<Keypair>,
    threshold_usd: f64,
) -> Result<(), Box<dyn std::error::Error>> {
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
    
    Ok(())
}
