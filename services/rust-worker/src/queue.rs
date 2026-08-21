use anyhow::Result;
use redis::AsyncCommands;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use tracing::{error, info};
use crate::models::TransactionJob;
use crate::stellar::submit_transaction;
use crate::metrics::{
    set_queue_depth, ACTIVE_WORKERS, HORIZON_ERRORS_TOTAL, JOBS_PROCESSED_TOTAL,
    TX_FAILURE_TOTAL, TX_LATENCY_SECONDS, TX_SUCCESS_TOTAL,
};

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
            Ok(len) => set_queue_depth(len),
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
                    info!("Dispatching job: {}", job.id);

                    tokio::spawn(async move {
                        let start = Instant::now();
                        ACTIVE_WORKERS.inc();
                        // Each task creates its own connection for safety
                        match client_clone.get_async_connection().await {
                            Ok(mut _task_conn) => {
                                match submit_transaction(&job).await {
                                    Ok(hash) => {
                                        let elapsed = start.elapsed().as_secs_f64();
                                        TX_LATENCY_SECONDS.observe(elapsed);
                                        TX_SUCCESS_TOTAL
                                            .with_label_values(&[&job.asset_code])
                                            .inc();
                                        JOBS_PROCESSED_TOTAL
                                            .with_label_values(&["stellar_jobs"])
                                            .inc();
                                        info!("Job {} succeeded: {}", job.id, hash);
                                    }
                                    Err(e) => {
                                        let elapsed = start.elapsed().as_secs_f64();
                                        TX_LATENCY_SECONDS.observe(elapsed);
                                        let err_str = e.to_string();
                                        let error_type = classify_queue_error(&err_str);
                                        TX_FAILURE_TOTAL
                                            .with_label_values(&[error_type])
                                            .inc();
                                        JOBS_PROCESSED_TOTAL
                                            .with_label_values(&["stellar_jobs"])
                                            .inc();
                                        error!("Job {} failed: {}", job.id, e);
                                    }
                                }
                            }
                            Err(e) => {
                                TX_FAILURE_TOTAL
                                    .with_label_values(&["connection_error"])
                                    .inc();
                                JOBS_PROCESSED_TOTAL
                                    .with_label_values(&["stellar_jobs"])
                                    .inc();
                                error!("Job {} - failed to get task connection: {}", job.id, e);
                            }
                        }
                        ACTIVE_WORKERS.dec();
                        drop(permit);
                    });
                }
                Err(e) => error!("Failed to parse job: {}", e),
            }
        }
    }
}

/// Classify a stringified submission error into a stable `error_type` label.
fn classify_queue_error(msg: &str) -> &'static str {
    if msg.contains("400") || msg.contains("Bad Request") {
        "horizon_error"
    } else if msg.contains("502") || msg.contains("503") || msg.contains("504") {
        "horizon_error"
    } else if msg.contains("timeout") || msg.contains("timed out") {
        "timeout"
    } else if msg.contains("connection") || msg.contains("connect") {
        "connection_error"
    } else if msg.contains("sign") || msg.contains("keypair") {
        "signing_error"
    } else {
        "unknown"
    }
}
