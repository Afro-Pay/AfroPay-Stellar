//! Redis queue client for the Rust worker.
//!
//! The worker BLPOPs two lists:
//! - `stellar_jobs` — payment jobs pushed by (or for) the NestJS API
//! - `compliance_jobs` — freeze/clawback jobs pushed by the compliance API
//!   once the mandatory multi-sig approval threshold is met.

use anyhow::Result;
use redis::AsyncCommands;
use tracing::info;

use crate::models::{ComplianceJob, LiquidityRebalanceJob, TransactionJob};

/// Redis list consumed by the worker for payment jobs.
const TRANSACTIONS_QUEUE: &str = "stellar_jobs";
/// Redis list consumed by the worker for compliance (freeze/clawback) jobs.
const COMPLIANCE_QUEUE: &str = "compliance_jobs";
/// Redis list consumed by the worker for treasury liquidity rebalances.
const LIQUIDITY_QUEUE: &str = "liquidity_rebalance_jobs";

/// Minimal blocking-pop queue client shared by the payment and compliance
/// processing loops. Clone is cheap (the underlying `redis::Client` is
/// reference-counted), so each loop can own its own handle.
#[derive(Clone)]
pub struct QueueService {
    client: redis::Client,
}

impl QueueService {
    pub fn new() -> Result<Self> {
        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".into());
        let client = redis::Client::open(redis_url)?;
        Ok(QueueService { client })
    }

    /// Blocking-pop a payment job, or return `None` after a short timeout.
    pub async fn receive_job(&self) -> Result<Option<TransactionJob>> {
        let mut conn = self.client.get_async_connection().await?;
        let entry: Option<(String, String)> =
            conn.blpop(TRANSACTIONS_QUEUE, 1.0).await.unwrap_or(None);
        match entry {
            Some((_, payload)) => {
                let job: TransactionJob = serde_json::from_str(&payload)?;
                info!("Received payment job: {}", job.id);
                Ok(Some(job))
            }
            None => Ok(None),
        }
    }

    /// Blocking-pop a liquidity rebalance job, or `None` on timeout.
    pub async fn receive_liquidity_job(&self) -> Result<Option<LiquidityRebalanceJob>> {
        let mut conn = self.client.get_async_connection().await?;
        let entry: Option<(String, String)> =
            conn.blpop(LIQUIDITY_QUEUE, 1.0).await.unwrap_or(None);
        match entry {
            Some((_, payload)) => {
                let job: LiquidityRebalanceJob = serde_json::from_str(&payload)?;
                info!("Received liquidity rebalance job: {}", job.rebalance_id);
                Ok(Some(job))
            }
            None => Ok(None),
        }
    }

    /// Blocking-pop a compliance (freeze/clawback) job, or `None` on timeout.
    pub async fn receive_compliance_job(&self) -> Result<Option<ComplianceJob>> {
        let mut conn = self.client.get_async_connection().await?;
        let entry: Option<(String, String)> =
            conn.blpop(COMPLIANCE_QUEUE, 1.0).await.unwrap_or(None);
        match entry {
            Some((_, payload)) => {
                let job: ComplianceJob = serde_json::from_str(&payload)?;
                info!("Received compliance job: {}", job.action_id);
                Ok(Some(job))
            }
            None => Ok(None),
        }
    }
}
