use sqlx::postgres::{PgPool, PgPoolOptions};
use std::env;
use std::process;
use std::sync::Arc;
use tracing::info;

pub fn validate_env() {
    let required = [
        ("DATABASE_URL", "PostgreSQL connection string"),
        ("REDIS_URL", "Redis connection string"),
    ];

    let mut missing: Vec<&str> = Vec::new();

    for (key, hint) in &required {
        if env::var(key).is_err() {
            eprintln!("  {} — {}", key, hint);
            missing.push(key);
        }
    }

    if !missing.is_empty() {
        eprintln!();
        eprintln!("[AfroPay] FATAL: Required environment variables are missing.");
        eprintln!("Set them in your environment or .env file before starting the worker.");
        process::exit(1);
    }
}

pub async fn create_pool() -> Result<Arc<PgPool>, Box<dyn std::error::Error>> {
    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let max_connections: u32 = env::var("DB_MAX_CONNECTIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(&database_url)
        .await?;

    info!("Connected to PostgreSQL (max_connections={})", max_connections);

    // Run migrations if needed
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS transactions (
            id VARCHAR(255) PRIMARY KEY,
            stellar_tx_hash VARCHAR(255),
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_transactions_stellar_tx_hash
        ON transactions(stellar_tx_hash)
        WHERE stellar_tx_hash IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_transactions_status
        ON transactions(status);
        "#,
    )
    .execute(&pool)
    .await?;

    info!("Database schema verified");

    Ok(Arc::new(pool))
}

pub async fn update_transaction_status(
    pool: &PgPool,
    transaction_id: &str,
    status: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO transactions (id, status, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (id) DO UPDATE
        SET status = $2, updated_at = NOW()
        "#,
    )
    .bind(transaction_id)
    .bind(status)
    .execute(pool)
    .await?;

    info!(
        transaction_id = %transaction_id,
        new_status = %status,
        "Transaction status updated"
    );

    Ok(())
}

pub async fn store_stellar_tx_hash(
    pool: &PgPool,
    transaction_id: &str,
    stellar_tx_hash: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE transactions
        SET stellar_tx_hash = $2, updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(transaction_id)
    .bind(stellar_tx_hash)
    .execute(pool)
    .await?;

    info!(
        transaction_id = %transaction_id,
        stellar_tx_hash = %stellar_tx_hash,
        "Stellar transaction hash stored"
    );

    Ok(())
}

#[allow(dead_code)]
pub async fn find_transaction_by_stellar_hash(
    pool: &PgPool,
    stellar_tx_hash: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM transactions WHERE stellar_tx_hash = $1 AND status = 'submitting'"
    )
    .bind(stellar_tx_hash)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| r.0))
}

pub async fn update_transaction_status_by_hash(
    pool: &PgPool,
    stellar_tx_hash: &str,
    status: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as(
        r#"
        UPDATE transactions
        SET status = $2, updated_at = NOW()
        WHERE stellar_tx_hash = $1 AND status = 'submitting'
        RETURNING id
        "#,
    )
    .bind(stellar_tx_hash)
    .bind(status)
    .fetch_optional(pool)
    .await?;

    if let Some(ref id) = row {
        info!(
            transaction_id = %id,
            stellar_tx_hash = %stellar_tx_hash,
            new_status = %status,
            "Transaction status updated via SSE"
        );
    }

    Ok(row.map(|r| r.0))
}
