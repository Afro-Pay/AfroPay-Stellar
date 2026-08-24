use anyhow::Result;
use redis::AsyncCommands;
use tracing::{error, info};
use crate::models::TransactionJob;
use crate::stellar::submit_transaction;
use crate::metrics::{QUEUE_DEPTH, TX_LATENCY_MS, TX_SUCCESS_TOTAL, TX_FAILURE_TOTAL};
use crate::lock_manager::LockManager;

pub async fn listen() -> Result<()> {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into());
    let client = redis::Client::open(redis_url)?;
    let lock_manager = LockManager::new(client.clone());

        info!("Connected to Redis queue: stellar_jobs");

        Ok(Self { client })
    }

    pub async fn receive_job(&self) -> Result<Option<TransactionJob>> {
        let mut conn = self.client.get_async_connection().await?;

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
                    info!("Dispatching job: {}", job.id);

                    let lock_manager = lock_manager.clone();
                    tokio::spawn(async move {
                        let start = Instant::now();
                        let lock = match lock_manager.acquire(format!("lock:escrow:{}", job.id)).await {
                            Ok(lock) => lock,
                            Err(e) => {
                                error!("Job {} - lock collision: {}", job.id, e);
                                drop(permit);
                                return;
                            }
                        };
                        // Each task creates its own connection for safety
                        match client_clone.get_async_connection().await {
                            Ok(mut _task_conn) => {
                                match submit_transaction(&job).await {
                                    Ok(hash) => {
                                        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                                        TX_LATENCY_MS.observe(elapsed_ms);
                                        TX_SUCCESS_TOTAL.inc();
                                        info!("Job {} succeeded: {}", job.id, hash);
                                    }
                                    Err(e) => {
                                        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                                        TX_LATENCY_MS.observe(elapsed_ms);
                                        TX_FAILURE_TOTAL.inc();
                                        error!("Job {} failed: {}", job.id, e);
                                    }
                                }
                            }
                            Err(e) => {
                                TX_FAILURE_TOTAL.inc();
                                error!("Job {} - failed to get task connection: {}", job.id, e);
                            }
                        }
                        if let Err(e) = lock.release().await {
                            error!("Job {} - lock release failed: {}", job.id, e);
                        }
                        drop(permit);
                    });
                }
            }
        } else {
            Ok(None)
        }
    }
}
