mod metrics;
mod models;
mod queue;
mod stellar;

use dotenv::dotenv;
use std::env;
use stellar_sdk::Keypair;
use stellar::StellarService;
use queue::QueueService;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    // Initialise all Lazy statics so they appear in the first scrape even
    // before any traffic arrives.
    let _ = &*metrics::QUEUE_DEPTH;
    let _ = &*metrics::TX_LATENCY_SECONDS;
    let _ = &*metrics::TX_SUCCESS_TOTAL;
    let _ = &*metrics::TX_FAILURE_TOTAL;
    let _ = &*metrics::HORIZON_ERRORS_TOTAL;
    let _ = &*metrics::JOBS_PROCESSED_TOTAL;
    let _ = &*metrics::ACTIVE_WORKERS;

    println!("🚀 Starting Rust Worker with Multi-Signature Support");

    // Spawn the Prometheus /metrics HTTP server as a background task.
    // It runs indefinitely on METRICS_PORT (default 9898).
    tokio::spawn(metrics::serve());

    let stellar_service = StellarService::new();
    let queue_service = QueueService::new().await?;

    // Load cosigner keypair (if configured)
    let cosigner_keypair = if let Ok(cosigner_secret) = env::var("COSIGNER_SECRET") {
        println!("✅ Cosigner keypair loaded from environment");
        Some(Keypair::from_secret(&cosigner_secret)?)
    } else {
        println!("ℹ️  No cosigner key configured — multi-sig disabled");
        None
    };

    let threshold_usd = env::var("MULTISIG_THRESHOLD_USD")
        .unwrap_or_else(|_| "10000".to_string())
        .parse::<f64>()
        .unwrap_or(10000.0);

    println!("📊 Multi-sig threshold: ${} USD", threshold_usd);

    // Spawn the queue listener as a long-running concurrent task alongside the
    // legacy QueueService loop.  Both operate on the same Redis key; the
    // queue::listen() path also updates the metrics gauges.
    // NOTE: when fully migrated, remove the QueueService loop below and keep
    // only queue::listen().
    tokio::spawn(async {
        if let Err(e) = queue::listen().await {
            eprintln!("❌ Queue listener exited with error: {}", e);
        }
    });

    // Legacy processing loop (kept for backward-compat with QueueService).
    loop {
        match queue_service.receive_job().await {
            Ok(Some(job)) => {
                println!("📋 Processing job: {}", job.id);
                metrics::ACTIVE_WORKERS.inc();
                if let Err(e) =
                    process_job(&stellar_service, job, &cosigner_keypair, threshold_usd).await
                {
                    eprintln!("❌ Job failed: {}", e);
                }
                metrics::ACTIVE_WORKERS.dec();
            }
            Ok(None) => {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
            Err(e) => {
                eprintln!("❌ Queue error: {}", e);
                metrics::TX_FAILURE_TOTAL
                    .with_label_values(&["connection_error"])
                    .inc();
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        }
    }
}

async fn process_job(
    stellar_service: &StellarService,
    job: models::TransactionJob,
    cosigner_keypair: &Option<Keypair>,
    _threshold_usd: f64,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::time::Instant;

    let user_secret = env::var("USER_SECRET_KEY").expect("USER_SECRET_KEY must be set");
    let user_keypair = Keypair::from_secret(&user_secret)?;

    let requires_cosign = job.requires_cosign;

    let config = stellar::SigningConfig {
        requires_cosign,
        user_keypair,
        cosigner_keypair: cosigner_keypair.clone(),
    };

    let start = Instant::now();

    let transaction = match stellar_service
        .build_transaction(
            &job.source_wallet,
            &job.destination_wallet,
            &job.amount,
            &job.asset_code,
            &job.asset_issuer,
            job.memo.as_deref(),
            &config,
        )
        .await
    {
        Ok(tx) => tx,
        Err(e) => {
            metrics::TX_FAILURE_TOTAL
                .with_label_values(&["signing_error"])
                .inc();
            metrics::JOBS_PROCESSED_TOTAL
                .with_label_values(&["stellar_jobs"])
                .inc();
            return Err(e);
        }
    };

    match stellar_service.submit_transaction(&transaction).await {
        Ok(hash) => {
            let elapsed = start.elapsed().as_secs_f64();
            metrics::TX_LATENCY_SECONDS.observe(elapsed);
            metrics::TX_SUCCESS_TOTAL
                .with_label_values(&[&job.asset_code])
                .inc();
            metrics::JOBS_PROCESSED_TOTAL
                .with_label_values(&["stellar_jobs"])
                .inc();

            println!("✅ Transaction submitted successfully!");
            println!("   Hash: {}", hash);
            println!(
                "   Signatures: {}",
                if requires_cosign { 2 } else { 1 }
            );
            Ok(())
        }
        Err(e) => {
            let elapsed = start.elapsed().as_secs_f64();
            metrics::TX_LATENCY_SECONDS.observe(elapsed);

            // Classify the error for the horizon_errors_total label.
            let error_str = e.to_string();
            let (error_type, status_code) = classify_error(&error_str);
            metrics::TX_FAILURE_TOTAL
                .with_label_values(&[error_type])
                .inc();
            if let Some(code) = status_code {
                metrics::HORIZON_ERRORS_TOTAL
                    .with_label_values(&[code])
                    .inc();
            }
            metrics::JOBS_PROCESSED_TOTAL
                .with_label_values(&["stellar_jobs"])
                .inc();

            Err(e)
        }
    }
}

/// Classify a stringified error into an `error_type` label and an optional
/// Horizon HTTP `status_code` label.
fn classify_error(msg: &str) -> (&'static str, Option<&'static str>) {
    if msg.contains("400") {
        ("horizon_error", Some("400"))
    } else if msg.contains("401") || msg.contains("403") {
        ("horizon_error", Some("401"))
    } else if msg.contains("404") {
        ("horizon_error", Some("404"))
    } else if msg.contains("429") {
        ("horizon_error", Some("429"))
    } else if msg.contains("500") {
        ("horizon_error", Some("500"))
    } else if msg.contains("502") || msg.contains("503") || msg.contains("504") {
        ("horizon_error", Some("502"))
    } else if msg.contains("timeout") || msg.contains("timed out") {
        ("timeout", None)
    } else if msg.contains("connection") || msg.contains("connect") {
        ("connection_error", None)
    } else if msg.contains("sign") || msg.contains("keypair") {
        ("signing_error", None)
    } else {
        ("unknown", None)
    }
}
