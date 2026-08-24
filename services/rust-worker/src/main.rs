mod models;
mod queue;
mod settlement;
mod stellar;

use dotenv::dotenv;
use std::env;
use models::TransactionJob;
use queue::QueueService;
use settlement::{fetch_account_sequence, process_compliance_job, submit_xdr};
use stellar::{build_payment_xdr, derive_public_key, PUBLIC_PASSPHRASE, TESTNET_PASSPHRASE};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    println!("🚀 Starting Rust Worker with Compliance (Clawback/Freeze) Support");

    let queue_service = QueueService::new()?;

    // Compliance listener — processes freeze/clawback jobs concurrently with
    // the payment loop. Jobs only arrive after the API's multi-sig threshold
    // (2+ compliance officers) has been met.
    let compliance_queue = queue_service.clone();
    tokio::spawn(async move {
        loop {
            match compliance_queue.receive_compliance_job().await {
                Ok(Some(job)) => {
                    println!(
                        "🛡️ Processing compliance job: {} ({})",
                        job.action_id, job.action_type
                    );
                    if let Err(e) = process_compliance_job(&job).await {
                        eprintln!("❌ Compliance job failed: {}", e);
                    }
                }
                Ok(None) => {
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                }
                Err(e) => {
                    eprintln!("❌ Compliance queue error: {}", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                }
            }
        }
    });

    // Payment processing loop
    loop {
        match queue_service.receive_job().await {
            Ok(Some(job)) => {
                println!("📋 Processing job: {}", job.id);
                if let Err(e) = process_job(job).await {
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

async fn process_job(job: TransactionJob) -> Result<(), Box<dyn std::error::Error>> {
    // Load user's keypair (in production, securely retrieve from vault)
    let user_secret = env::var("USER_SECRET_KEY").expect("USER_SECRET_KEY must be set");
    let network = env::var("STELLAR_NETWORK").unwrap_or_default();
    let network_passphrase = if network == "mainnet" {
        PUBLIC_PASSPHRASE
    } else {
        TESTNET_PASSPHRASE
    };
    let horizon_url = env::var("STELLAR_HORIZON_URL")
        .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string());

    let source_public = derive_public_key(&user_secret)?;
    let sequence = fetch_account_sequence(&horizon_url, &source_public).await?;

    // Build and sign the payment envelope.
    let xdr = build_payment_xdr(&job, &user_secret, sequence, network_passphrase)?;

    // Submit to the network.
    let hash = submit_xdr(&horizon_url, &xdr).await?;

    println!("✅ Transaction submitted successfully!");
    println!("   Hash: {}", hash);
    println!("   Signatures: {}", if job.requires_cosign { 2 } else { 1 });

    Ok(())
}
