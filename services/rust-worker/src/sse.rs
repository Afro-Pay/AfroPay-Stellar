use futures::StreamExt;
use reqwest::Client;
use sqlx::PgPool;
use std::env;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use crate::metrics::{SSE_EVENTS_TOTAL, SSE_STATUS_UPDATES_TOTAL, SSE_ERRORS_TOTAL};

const MAX_RECONNECT_ATTEMPTS: u32 = 5;
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub struct TransactionEvent {
    pub hash: String,
    pub status: String,
    pub ledger: Option<i64>,
    pub success: bool,
}

pub async fn start_transaction_listener(pool: Arc<PgPool>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let horizon_url = env::var("HORIZON_URL")
        .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string());

    let (tx, mut rx) = mpsc::channel::<TransactionEvent>(100);

    // Spawn the SSE connection manager
    let horizon_url_clone = horizon_url.clone();
    tokio::spawn(async move {
        if let Err(e) = connect_and_listen(&horizon_url_clone, tx).await {
            error!("SSE connection manager failed: {}", e);
        }
    });

    // Process events from the channel
    while let Some(event) = rx.recv().await {
        if let Err(e) = process_transaction_event(&pool, &event).await {
            SSE_ERRORS_TOTAL.inc();
            error!(
                stellar_tx_hash = %event.hash,
                "Failed to process transaction event: {}", e
            );
        }
    }

    Ok(())
}

async fn connect_and_listen(
    horizon_url: &str,
    tx: mpsc::Sender<TransactionEvent>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut attempt = 0;
    let mut current_backoff = INITIAL_BACKOFF;

    loop {
        attempt += 1;
        if attempt > MAX_RECONNECT_ATTEMPTS {
            error!(
                "Failed to connect to Horizon SSE after {} attempts. Giving up.",
                MAX_RECONNECT_ATTEMPTS
            );
            return Err("Max reconnect attempts reached".into());
        }

        info!(
            attempt = attempt,
            max_attempts = MAX_RECONNECT_ATTEMPTS,
            backoff_secs = current_backoff.as_secs(),
            "Connecting to Horizon SSE stream"
        );

        match subscribe_to_transactions(horizon_url, &tx).await {
            Ok(()) => {
                info!("SSE connection closed normally. Reconnecting...");
                attempt = 0;
                current_backoff = INITIAL_BACKOFF;
            }
            Err(e) => {
                warn!(
                    attempt = attempt,
                    error = %e,
                    "SSE connection failed. Retrying in {:?}",
                    current_backoff
                );
                tokio::time::sleep(current_backoff).await;
                current_backoff = (current_backoff * 2).min(MAX_BACKOFF);
            }
        }
    }
}

async fn subscribe_to_transactions(
    horizon_url: &str,
    tx: &mpsc::Sender<TransactionEvent>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    // Horizon SSE endpoint for all transactions
    let sse_url = format!("{}/transactions", horizon_url.trim_end_matches('/'));

    info!("Subscribing to Horizon SSE: {}", sse_url);

    let response = client
        .get(&sse_url)
        .header("Accept", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(format!("Horizon returned status: {}", response.status()).into());
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut event_type = String::new();
    let mut event_data = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Process complete SSE events (separated by double newlines)
        while let Some(line_end) = buffer.find("\n\n") {
            let event_block = buffer[..line_end].to_string();
            buffer = buffer[line_end + 2..].to_string();

            event_type.clear();
            event_data.clear();

            for line in event_block.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    event_data = data.to_string();
                } else if let Some(ev_type) = line.strip_prefix("event: ") {
                    event_type = ev_type.to_string();
                }
            }

            if !event_data.is_empty() {
                match event_type.as_str() {
                    "transaction" => {
                        if let Err(e) = process_sse_transaction_data(&event_data, tx).await {
                            error!("Failed to process SSE transaction event: {}", e);
                        }
                    }
                    "heartbeat" | "" => {
                        // Ignore heartbeats and empty events
                    }
                    other => {
                        warn!("Unknown SSE event type: {}", other);
                    }
                }
            }
        }
    }

    Ok(())
}

async fn process_sse_transaction_data(
    data: &str,
    tx: &mpsc::Sender<TransactionEvent>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let json: serde_json::Value = serde_json::from_str(data)?;

    let hash = json["hash"]
        .as_str()
        .or_else(|| json["transaction"]["hash"].as_str())
        .unwrap_or_default()
        .to_string();

    if hash.is_empty() {
        return Ok(());
    }

    let success = json["successful"]
        .as_bool()
        .or_else(|| json["transaction"]["successful"].as_bool())
        .unwrap_or(false);

    let status = if success { "success" } else { "failed" };

    let ledger = json["ledger"]
        .as_i64()
        .or_else(|| json["transaction"]["ledger"].as_i64());

    let event = TransactionEvent {
        hash,
        status: status.to_string(),
        ledger,
        success,
    };

    info!(
        stellar_tx_hash = %event.hash,
        status = %event.status,
        ledger = ?event.ledger,
        "Received transaction event from Horizon SSE"
    );

    SSE_EVENTS_TOTAL.inc();
    tx.send(event).await?;

    Ok(())
}

async fn process_transaction_event(
    pool: &PgPool,
    event: &TransactionEvent,
) -> Result<(), sqlx::Error> {
    let previous_status = "submitting";
    let new_status = if event.success { "success" } else { "failed" };

    let transaction_id = crate::db::update_transaction_status_by_hash(
        pool,
        &event.hash,
        new_status,
    )
    .await?;

    if let Some(tx_id) = transaction_id {
        SSE_STATUS_UPDATES_TOTAL.inc();
        info!(
            transaction_id = %tx_id,
            stellar_tx_hash = %event.hash,
            previous_status = previous_status,
            new_status = new_status,
            ledger = ?event.ledger,
            "Status transition: submitting → {}", new_status
        );
    } else {
        SSE_ERRORS_TOTAL.inc();
        warn!(
            stellar_tx_hash = %event.hash,
            "No matching transaction found in database for hash"
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_max_backoff_calculation() {
        let mut backoff = INITIAL_BACKOFF;
        for _ in 0..5 {
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
        assert_eq!(backoff, MAX_BACKOFF);
    }

    #[test]
    fn test_max_reconnect_attempts() {
        assert_eq!(MAX_RECONNECT_ATTEMPTS, 5);
    }

    #[test]
    fn test_backoff_never_exceeds_max() {
        let mut backoff = INITIAL_BACKOFF;
        for _ in 0..100 {
            backoff = (backoff * 2).min(MAX_BACKOFF);
            assert!(backoff <= MAX_BACKOFF);
        }
    }

    #[test]
    fn test_transaction_event_creation() {
        let event = TransactionEvent {
            hash: "abc123".to_string(),
            status: "success".to_string(),
            ledger: Some(12345),
            success: true,
        };
        assert_eq!(event.hash, "abc123");
        assert!(event.success);
    }
}
