use anyhow::Result;
use redis::AsyncCommands;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use tracing::{error, info};
use crate::models::TransactionJob;
use crate::stellar::submit_transaction;
use crate::metrics::{QUEUE_DEPTH, TX_LATENCY_MS, TX_SUCCESS_TOTAL, TX_FAILURE_TOTAL};

pub async fn listen() -> Result<()> {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into());
    let client = redis::Client::open(redis_url)?;

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
                    let client_clone = client.clone();
                    let permit = semaphore.clone().acquire_owned().await.unwrap();
                    info!("Dispatching job: {}", job.tx_id);

                    tokio::spawn(async move {
                        let start = Instant::now();
                        // Each task creates its own connection for safety
                        match client_clone.get_async_connection().await {
                            Ok(mut _task_conn) => {
                                match submit_transaction(&job).await {
                                    Ok(hash) => {
                                        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                                        TX_LATENCY_MS.observe(elapsed_ms);
                                        TX_SUCCESS_TOTAL.inc();
                                        info!("Job {} succeeded: {}", job.tx_id, hash);
                                    }
                                    Err(e) => {
                                        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                                        TX_LATENCY_MS.observe(elapsed_ms);
                                        TX_FAILURE_TOTAL.inc();
                                        error!("Job {} failed: {}", job.tx_id, e);
                                    }
                                }
                            }
                            Err(e) => {
                                TX_FAILURE_TOTAL.inc();
                                error!("Job {} - failed to get task connection: {}", job.tx_id, e);
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
