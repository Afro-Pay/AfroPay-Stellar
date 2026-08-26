//! Treasury liquidity rebalance execution.
//!
//! Rebalances are deliberately explicit: the API has already applied the
//! hourly lock, forecast threshold, opposite-direction cooldown, and daily
//! limits. The worker validates the job again before signing a strict-send
//! path payment from the treasury to the corridor reserve account.

use std::env;

use reqwest::Client;
use crate::models::LiquidityRebalanceJob;
use crate::settlement::{fetch_account_sequence, submit_xdr};
use crate::stellar::{build_path_payment_strict_send_xdr, derive_public_key, PUBLIC_PASSPHRASE, TESTNET_PASSPHRASE};

pub fn rebalance_enabled() -> bool {
    env::var("LIQUIDITY_REBALANCING_ENABLED")
        .map(|value| value != "false")
        .unwrap_or(true)
}

pub fn validate_rebalance_job(job: &LiquidityRebalanceJob) -> Result<(), Box<dyn std::error::Error>> {
    if job.source_amount.parse::<f64>().map_err(|_| "invalid source amount")? <= 0.0 {
        return Err("rebalance source amount must be positive".into());
    }
    if job.destination_min_amount.parse::<f64>().map_err(|_| "invalid destination minimum")? <= 0.0 {
        return Err("rebalance destination minimum must be positive".into());
    }
    if job.treasury_account.trim().is_empty() || job.destination_account.trim().is_empty() {
        return Err("rebalance requires treasury and destination accounts".into());
    }
    if job.from_asset == job.to_asset {
        return Err("rebalance assets must be different".into());
    }
    if job.from_asset != "XLM" && job.from_asset_issuer.trim().is_empty() {
        return Err("source issued asset requires an issuer".into());
    }
    if job.to_asset != "XLM" && job.to_asset_issuer.trim().is_empty() {
        return Err("destination issued asset requires an issuer".into());
    }
    Ok(())
}

pub async fn process_rebalance_job(
    job: &LiquidityRebalanceJob,
) -> Result<String, Box<dyn std::error::Error>> {
    let result = process_rebalance_job_inner(job).await;
    match &result {
        Ok(tx_hash) => {
            // A callback outage must not turn a confirmed on-chain submission
            // into a retryable worker failure.
            let _ = report_result(job, true, Some(tx_hash), None).await;
        }
        Err(error) => {
            let message = error.to_string();
            let _ = report_result(job, false, None, Some(&message)).await;
        }
    }
    result
}

async fn process_rebalance_job_inner(
    job: &LiquidityRebalanceJob,
) -> Result<String, Box<dyn std::error::Error>> {
    validate_rebalance_job(job)?;
    let secret = env::var("LIQUIDITY_TREASURY_SECRET_KEY")
        .map_err(|_| "LIQUIDITY_TREASURY_SECRET_KEY must be set to process liquidity jobs")?;
    let derived_public = derive_public_key(&secret)?;
    if derived_public != job.treasury_account {
        return Err("treasury secret does not match the requested treasury account".into());
    }

    let horizon_url = env::var("STELLAR_HORIZON_URL")
        .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string());
    let network_passphrase = if job.network.as_deref() == Some("mainnet") {
        PUBLIC_PASSPHRASE
    } else {
        TESTNET_PASSPHRASE
    };
    let sequence = fetch_account_sequence(&horizon_url, &job.treasury_account).await?;
    let xdr = build_path_payment_strict_send_xdr(
        &job.treasury_account,
        &job.destination_account,
        &job.source_amount,
        &job.destination_min_amount,
        &job.from_asset,
        &job.from_asset_issuer,
        &job.to_asset,
        &job.to_asset_issuer,
        sequence,
        &secret,
        network_passphrase,
    )?;

    submit_xdr(&horizon_url, &xdr).await
}

async fn report_result(
    job: &LiquidityRebalanceJob,
    success: bool,
    tx_hash: Option<&str>,
    error: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let url = match env::var("LIQUIDITY_RESULT_URL") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return Ok(()),
    };
    let token = env::var("LIQUIDITY_WORKER_TOKEN")
        .map_err(|_| "LIQUIDITY_WORKER_TOKEN must be set when LIQUIDITY_RESULT_URL is configured")?;
    Client::new()
        .post(format!("{}/{}/result", url.trim_end_matches('/'), job.rebalance_id))
        .header("x-liquidity-worker-token", token)
        .json(&serde_json::json!({ "success": success, "txHash": tx_hash, "error": error }))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job() -> LiquidityRebalanceJob {
        LiquidityRebalanceJob {
            rebalance_id: "rebalance-1".into(),
            corridor: "USDC:NGN".into(),
            from_asset: "USDC".into(),
            to_asset: "NGN".into(),
            source_amount: "100".into(),
            destination_min_amount: "150000".into(),
            treasury_account: "G".repeat(56),
            destination_account: "G".repeat(56),
            from_asset_issuer: "G".repeat(56),
            to_asset_issuer: "G".repeat(56),
            network: Some("testnet".into()),
        }
    }

    #[test]
    fn rejects_non_positive_amounts() {
        let mut invalid = job();
        invalid.source_amount = "0".into();
        assert!(validate_rebalance_job(&invalid).is_err());
    }

    #[test]
    fn rejects_missing_reserve_account() {
        let mut invalid = job();
        invalid.destination_account.clear();
        assert!(validate_rebalance_job(&invalid).is_err());
    }

    #[test]
    fn rejects_same_asset_rebalance() {
        let mut invalid = job();
        invalid.to_asset = invalid.from_asset.clone();
        assert!(validate_rebalance_job(&invalid).is_err());
    }
}
