use anyhow::{anyhow, Context, Result};
use chrono::Duration;
use reqwest::Client;
use serde_json::Value;
use stellar_base::amount::Amount;
use stellar_base::asset::Asset;
use stellar_base::crypto::{DalekKeyPair, PublicKey};
use stellar_base::memo::Memo;
use stellar_base::network::Network;
use stellar_base::operations::Operation;
use stellar_base::time_bounds::TimeBounds;
use stellar_base::transaction::{Transaction, TransactionEnvelope, MIN_BASE_FEE};
use stellar_base::xdr::{XDRDeserialize, XDRSerialize};
use std::str::FromStr;

use crate::models::TransactionJob;

const TX_TIMEOUT_SECS: i64 = 30;

pub async fn submit_transaction(job: &TransactionJob) -> Result<String> {
    validate_job(job)?;

    let horizon_url = std::env::var("STELLAR_HORIZON_URL")
        .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".into());
    let network = stellar_network();

    let keypair = parse_source_keypair(&job.source_secret)?;
    let source_public_key = keypair.public_key().account_id();

    let client = Client::new();
    let account_url = format!("{}/accounts/{}", horizon_url, source_public_key);
    let account: Value = client
        .get(&account_url)
        .send()
        .await
        .context("Failed to fetch source account from Horizon")?
        .json()
        .await
        .context("Failed to parse Horizon account response")?;

    let sequence: i64 = account["sequence"]
        .as_str()
        .ok_or_else(|| anyhow!("Missing sequence in Horizon account response"))?
        .parse()
        .context("Invalid sequence number in Horizon account response")?;

    let envelope_xdr = build_and_sign_payment(job, sequence + 1, &keypair, &network)?;

    let params = [("tx", envelope_xdr.as_str())];
    let resp = client
        .post(format!("{}/transactions", horizon_url))
        .form(&params)
        .send()
        .await
        .context("Failed to submit transaction to Horizon")?;

    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .context("Failed to parse Horizon transaction response")?;

    if let Some(hash) = body["hash"].as_str() {
        Ok(hash.to_string())
    } else {
        Err(anyhow!(
            "Horizon submission failed ({}): {}",
            status,
            body
        ))
    }
}

/// Validates transaction job fields before building or submitting.
pub fn validate_job(job: &TransactionJob) -> Result<()> {
    if job.tx_id.trim().is_empty() {
        return Err(anyhow!("Invalid payload: tx_id must not be empty"));
    }
    if job.user_id.trim().is_empty() {
        return Err(anyhow!("Invalid payload: user_id must not be empty"));
    }
    if job.source_secret.trim().is_empty() {
        return Err(anyhow!("Invalid payload: source_secret must not be empty"));
    }
    if job.destination_public_key.trim().is_empty() {
        return Err(anyhow!("Invalid payload: destination_public_key must not be empty"));
    }
    if job.amount.trim().is_empty() {
        return Err(anyhow!("Invalid payload: amount must not be empty"));
    }
    if job.asset_code.trim().is_empty() {
        return Err(anyhow!("Invalid payload: asset_code must not be empty"));
    }

    parse_source_keypair(&job.source_secret)
        .context("Invalid payload: source_secret is not a valid Stellar secret key")?;

    PublicKey::from_account_id(&job.destination_public_key).context(
        "Invalid payload: destination_public_key is not a valid Stellar account ID",
    )?;

    let amount = Amount::from_str(&job.amount)
        .context("Invalid payload: amount is not a valid Stellar amount")?;
    if amount.to_stroops().context("Invalid payload: amount must be positive")? <= stellar_base::amount::Stroops::new(0) {
        return Err(anyhow!("Invalid payload: amount must be greater than zero"));
    }

    resolve_asset(job)?;

    if let Some(memo) = &job.memo {
        Memo::new_text(memo).context("Invalid payload: memo text exceeds 28 bytes")?;
    }

    Ok(())
}

/// Builds, signs, and validates a payment transaction envelope.
pub fn build_and_sign_payment(
    job: &TransactionJob,
    sequence: i64,
    keypair: &DalekKeyPair,
    network: &Network,
) -> Result<String> {
    validate_job(job)?;

    let destination =
        PublicKey::from_account_id(&job.destination_public_key).context(
            "Invalid destination_public_key",
        )?;
    let amount = Amount::from_str(&job.amount).context("Invalid amount")?;
    let asset = resolve_asset(job)?;

    let payment = Operation::new_payment()
        .with_destination(destination)
        .with_amount(amount)
        .context("Invalid payment amount")?
        .with_asset(asset)
        .build()
        .context("Failed to build payment operation")?;

    let mut builder = Transaction::builder(keypair.public_key(), sequence, MIN_BASE_FEE)
        .add_operation(payment)
        .with_time_bounds(TimeBounds::valid_for(Duration::seconds(TX_TIMEOUT_SECS)));

    if let Some(memo) = &job.memo {
        builder = builder.with_memo(Memo::new_text(memo).context("Invalid memo text")?);
    }

    let mut tx = builder
        .into_transaction()
        .context("Failed to assemble transaction")?;

    tx.sign(keypair.as_ref(), network)
        .context("Failed to sign transaction")?;

    validate_signed_transaction(&tx)?;

    let envelope = tx.into_envelope();
    let xdr = envelope
        .xdr_base64()
        .context("Failed to encode signed transaction envelope to XDR")?;

    validate_envelope_xdr(&xdr)?;

    Ok(xdr)
}

fn parse_source_keypair(secret: &str) -> Result<DalekKeyPair> {
    DalekKeyPair::from_secret_seed(secret).context("Invalid Stellar secret seed")
}

fn resolve_asset(job: &TransactionJob) -> Result<Asset> {
    if job.asset_code.eq_ignore_ascii_case("XLM") {
        Ok(Asset::new_native())
    } else {
        let issuer = job.asset_issuer.as_deref().ok_or_else(|| {
            anyhow!(
                "Invalid payload: asset_issuer is required for non-native asset '{}'",
                job.asset_code
            )
        })?;
        let issuer_key =
            PublicKey::from_account_id(issuer).context("Invalid payload: asset_issuer is not a valid Stellar account ID")?;
        Asset::new_credit(&job.asset_code, issuer_key)
            .context("Invalid payload: asset_code or asset_issuer is invalid")
    }
}

fn stellar_network() -> Network {
    match std::env::var("STELLAR_NETWORK").as_deref() {
        Ok("mainnet") => Network::new_public(),
        _ => Network::new_test(),
    }
}

fn validate_signed_transaction(tx: &Transaction) -> Result<()> {
    if tx.operations().is_empty() {
        return Err(anyhow!("Transaction validation failed: no operations"));
    }
    if tx.signatures().is_empty() {
        return Err(anyhow!("Transaction validation failed: missing signature"));
    }
    tx.to_xdr()
        .context("Transaction validation failed: invalid XDR structure")?;
    Ok(())
}

fn validate_envelope_xdr(xdr: &str) -> Result<()> {
    if xdr.trim().is_empty() {
        return Err(anyhow!("Transaction validation failed: empty XDR envelope"));
    }

    let envelope = TransactionEnvelope::from_xdr_base64(xdr)
        .context("Transaction validation failed: envelope is not valid base64 XDR")?;

    match &envelope {
        TransactionEnvelope::Transaction(tx) => {
            if tx.signatures().is_empty() {
                return Err(anyhow!(
                    "Transaction validation failed: decoded envelope has no signatures"
                ));
            }
            if tx.operations().is_empty() {
                return Err(anyhow!(
                    "Transaction validation failed: decoded envelope has no operations"
                ));
            }
        }
        TransactionEnvelope::FeeBumpTransaction(_) => {
            return Err(anyhow!(
                "Transaction validation failed: unexpected fee-bump envelope"
            ));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_job() -> TransactionJob {
        let keypair = DalekKeyPair::random().unwrap();
        TransactionJob {
            tx_id: "tx-123".into(),
            user_id: "user-1".into(),
            source_secret: keypair.secret_key().secret_seed(),
            destination_public_key: "GATTMQEODSDX45WZK2JFIYETXWYCU5GRJ5I3Z7P2UDYD6YFVONDM4CX4".into(),
            amount: "10.5".into(),
            asset_code: "XLM".into(),
            asset_issuer: None,
            memo: Some("test".into()),
        }
    }

    #[test]
    fn builds_signed_xlm_payment_envelope() {
        let job = sample_job();
        let keypair = parse_source_keypair(&job.source_secret).unwrap();
        let network = Network::new_test();

        let xdr = build_and_sign_payment(&job, 42, &keypair, &network).unwrap();

        assert!(!xdr.starts_with("STUB_XDR"));
        assert!(validate_envelope_xdr(&xdr).is_ok());

        let envelope = TransactionEnvelope::from_xdr_base64(&xdr).unwrap();
        match envelope {
            TransactionEnvelope::Transaction(tx) => {
                assert_eq!(*tx.sequence(), 42);
                assert_eq!(tx.signatures().len(), 1);
                assert_eq!(tx.operations().len(), 1);
            }
            _ => panic!("expected v1 transaction envelope"),
        }
    }

    #[test]
    fn rejects_invalid_source_secret() {
        let mut job = sample_job();
        job.source_secret = "not-a-valid-secret".into();

        let err = validate_job(&job).unwrap_err();
        assert!(err.to_string().contains("source_secret"));
    }

    #[test]
    fn rejects_invalid_destination() {
        let mut job = sample_job();
        job.destination_public_key = "bad-destination".into();

        let err = validate_job(&job).unwrap_err();
        assert!(err.to_string().contains("destination_public_key"));
    }

    #[test]
    fn rejects_zero_amount() {
        let mut job = sample_job();
        job.amount = "0".into();

        let err = validate_job(&job).unwrap_err();
        assert!(err.to_string().contains("amount"));
    }

    #[test]
    fn rejects_credit_asset_without_issuer() {
        let mut job = sample_job();
        job.asset_code = "USDC".into();
        job.asset_issuer = None;

        let err = validate_job(&job).unwrap_err();
        assert!(err.to_string().contains("asset_issuer"));
    }

    #[test]
    fn rejects_memo_that_is_too_long() {
        let mut job = sample_job();
        job.memo = Some("this memo is definitely longer than twenty eight bytes".into());

        let err = validate_job(&job).unwrap_err();
        assert!(err.to_string().contains("memo"));
    }

    #[test]
    fn rejects_unsigned_stub_xdr() {
        let err = validate_envelope_xdr("STUB_XDR_tx_10_XLM").unwrap_err();
        assert!(err.to_string().contains("valid base64 XDR"));
    }
}
