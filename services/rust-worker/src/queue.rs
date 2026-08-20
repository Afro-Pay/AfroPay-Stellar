use anyhow::Result;
use redis::AsyncCommands;
use tracing::{error, info};
use crate::models::TransactionJob;
use crate::metrics::QUEUE_DEPTH;

pub struct QueueService {
    client: redis::Client,
}

impl QueueService {
    pub async fn new() -> Result<Self> {
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into());
        let client = redis::Client::open(redis_url)?;

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
                    info!("Dispatching job: {}", job.id);
                    Ok(Some(job))
                }
                Err(e) => {
                    error!("Failed to parse job: {}", e);
                    Ok(None)
                }
            }
        } else {
            Ok(None)
        }
    }
}
