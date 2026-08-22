use anyhow::Result;
use redis::AsyncCommands;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use tracing::{error, info};
use crate::metrics::{QUEUE_DEPTH, TX_LATENCY_MS, TX_SUCCESS_TOTAL, TX_FAILURE_TOTAL};
use crate::models::TransactionJob;
use crate::stellar::{self, TESTNET_PASSPHRASE, PUBLIC_PASSPHRASE};

pub async fn listen() -> Result<()> {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into());
    let client = redis::Client::open(redis_url)?;

    let horizon_url = Arc::new(
        std::env::var("HORIZON_URL")
            .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string()),
    );
    let network_passphrase =
        if std::env::var("STELLAR_NETWORK").unwrap_or_default() == "mainnet" {
            PUBLIC_PASSPHRASE
        } else {
            TESTNET_PASSPHRASE
        };
    let source_secret = Arc::new(
        std::env::var("USER_SECRET_KEY").expect("USER_SECRET_KEY must be set"),
    );
    let http_client = reqwest::Client::new();

    info!("Listening on Redis queue: stellar_jobs");

    let concurrency: usize = std::env::var("WORKER_CONCURRENCY")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);

    let semaphore = Arc::new(Semaphore::new(concurrency));

    loop {
        // Use a short timeout so we can periodically update queue depth
        let mut conn = client.get_async_connection().await?;
        // Update queue depth gauge
        match conn.llen::<_, i64>("stellar_jobs").await {
            Ok(len) => QUEUE_DEPTH.set(len),
            Err(e) => error!("Failed to fetch queue length: {}", e),
        }

        let result: Option<(String, String)> = conn
            .blpop("stellar_jobs", 1.0)
            .await
            .unwrap_or(None);

        if let Some((_, payload)) = result {
            match serde_json::from_str::<TransactionJob>(&payload) {
                Ok(job) => {
                    let permit = semaphore.clone().acquire_owned().await.unwrap();
                    let http_client = http_client.clone();
                    let horizon_url = horizon_url.clone();
                    let source_secret = source_secret.clone();
                    info!("Dispatching job: {}", job.id);

                    tokio::spawn(async move {
                        let start = Instant::now();
                        let job_id = job.id.clone();
                        match stellar::submit_transaction(
                            &http_client,
                            &horizon_url,
                            &job,
                            &source_secret,
                            network_passphrase,
                        )
                        .await
                        {
                            Ok(hash) => {
                                let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                                TX_LATENCY_MS.observe(elapsed_ms);
                                TX_SUCCESS_TOTAL.inc();
                                info!("Job {} succeeded: {}", job_id, hash);
                            }
                            Err(e) => {
                                let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                                TX_LATENCY_MS.observe(elapsed_ms);
                                TX_FAILURE_TOTAL.inc();
                                error!("Job {} failed: {}", job_id, e);
                            }
                        }
                        drop(permit);
                    });
                }
                Err(e) => error!("Failed to parse job: {}", e),
            }
        }
    }
}
