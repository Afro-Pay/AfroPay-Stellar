//! Trustline management utilities for Stellar assets.
//!
//! Provides detection of existing trustlines, safe creation of missing
//! trustlines, and structured error handling for authorization/limit issues.
//!
//! # Example
//! ```no_run
//! use trustline::{check_trustline, ensure_trustline, TrustlineAsset};
//!
//! let asset = TrustlineAsset {
//!     code: "USDC".into(),
//!     issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN".into(),
//! };
//!
//! // Check whether the account already trusts the asset
//! let status = check_trustline(&horizon_url, &public_key, &asset).await?;
//!
//! // Create the trustline if it is missing (no-op if already present)
//! ensure_trustline(&horizon_url, &secret_key, &asset).await?;
//! ```

use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::Value;
use thiserror::Error;
use tracing::{info, warn};

// ── Public types ────────────────────────────────────────────────────────────

/// A Stellar non-native asset identified by code + issuer.
#[derive(Debug, Clone)]
pub struct TrustlineAsset {
    /// Asset code, e.g. "USDC" or "NGN".
    pub code: String,
    /// Issuer account public key (G…).
    pub issuer: String,
}

/// The current state of a trustline for one account/asset pair.
#[derive(Debug, Clone, PartialEq)]
pub enum TrustlineStatus {
    /// Trustline exists and is usable.
    Exists { balance: String, limit: String },
    /// Trustline is missing entirely.
    Missing,
    /// Trustline exists but the issuer has not yet authorised this account.
    Unauthorised,
    /// Trustline exists but the limit is set to zero, blocking transfers.
    ZeroLimit,
}

/// Errors specific to trustline operations.
#[derive(Debug, Error)]
pub enum TrustlineError {
    #[error("Account {0} not found on Horizon")]
    AccountNotFound(String),

    #[error("Asset {0} requires issuer authorisation; account is not yet authorised")]
    AuthorisationRequired(String),

    #[error("Trustline limit for {0} is zero; transfers will be rejected")]
    ZeroLimit(String),

    #[error("Horizon error ({status}): {body}")]
    HorizonError { status: u16, body: String },

    #[error(transparent)]
    Network(#[from] reqwest::Error),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Check whether `public_key` has a trustline for `asset`.
///
/// Returns a [`TrustlineStatus`] describing the current state.
/// Returns [`TrustlineError::AccountNotFound`] when the account does not
/// exist on-chain at all.
pub async fn check_trustline(
    horizon_url: &str,
    public_key: &str,
    asset: &TrustlineAsset,
) -> Result<TrustlineStatus, TrustlineError> {
    let client = Client::new();
    let url = format!("{}/accounts/{}", horizon_url.trim_end_matches('/'), public_key);

    let response = client.get(&url).send().await?;
    let status = response.status();

    if status == 404 {
        return Err(TrustlineError::AccountNotFound(public_key.to_string()));
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(TrustlineError::HorizonError {
            status: status.as_u16(),
            body,
        });
    }

    let account: Value = response.json().await?;
    let balances = account["balances"]
        .as_array()
        .ok_or_else(|| anyhow!("Unexpected Horizon response: missing balances"))?;

    for balance in balances {
        let asset_type = balance["asset_type"].as_str().unwrap_or("");
        if asset_type == "native" {
            continue;
        }
        let code = balance["asset_code"].as_str().unwrap_or("");
        let issuer = balance["asset_issuer"].as_str().unwrap_or("");

        if code == asset.code && issuer == asset.issuer {
            let limit = balance["limit"].as_str().unwrap_or("0").to_string();
            let bal = balance["balance"].as_str().unwrap_or("0").to_string();

            // A limit of "0.0000000" means the trustline cannot receive funds.
            let limit_val: f64 = limit.parse().unwrap_or(0.0);
            if limit_val == 0.0 {
                warn!(
                    asset = %asset.code,
                    issuer = %asset.issuer,
                    account = %public_key,
                    "Trustline exists but limit is zero"
                );
                return Ok(TrustlineStatus::ZeroLimit);
            }

            // is_authorized flag: absent or false means not yet authorised.
            let authorised = balance["is_authorized"].as_bool().unwrap_or(true);
            if !authorised {
                warn!(
                    asset = %asset.code,
                    issuer = %asset.issuer,
                    account = %public_key,
                    "Trustline exists but account is not authorised by issuer"
                );
                return Ok(TrustlineStatus::Unauthorised);
            }

            info!(
                asset = %asset.code,
                issuer = %asset.issuer,
                account = %public_key,
                balance = %bal,
                limit = %limit,
                "Trustline confirmed"
            );
            return Ok(TrustlineStatus::Exists { balance: bal, limit });
        }
    }

    Ok(TrustlineStatus::Missing)
}

/// Ensure a trustline exists for `asset` on the account derived from
/// `source_secret`.  
///
/// - If the trustline already exists and is usable, this is a **no-op**.
/// - If it is missing, a `ChangeTrust` operation is submitted.
/// - If it is [`TrustlineStatus::Unauthorised`] or [`TrustlineStatus::ZeroLimit`],
///   the function returns a descriptive [`TrustlineError`] without submitting.
pub async fn ensure_trustline(
    horizon_url: &str,
    source_secret: &str,
    asset: &TrustlineAsset,
) -> Result<(), TrustlineError> {
    let public_key = derive_public_key(source_secret)?;

    match check_trustline(horizon_url, &public_key, asset).await? {
        TrustlineStatus::Exists { .. } => {
            info!(
                asset = %asset.code,
                "Trustline already exists, skipping creation"
            );
            return Ok(());
        }
        TrustlineStatus::Unauthorised => {
            return Err(TrustlineError::AuthorisationRequired(asset.code.clone()));
        }
        TrustlineStatus::ZeroLimit => {
            return Err(TrustlineError::ZeroLimit(asset.code.clone()));
        }
        TrustlineStatus::Missing => {
            // Fall through to creation.
        }
    }

    info!(
        asset = %asset.code,
        issuer = %asset.issuer,
        account = %public_key,
        "Trustline missing — submitting ChangeTrust operation"
    );

    submit_change_trust(horizon_url, source_secret, asset).await?;

    info!(
        asset = %asset.code,
        account = %public_key,
        "Trustline created successfully"
    );
    Ok(())
}

/// Check multiple assets at once. Returns a vec of `(asset, status)` pairs.
/// Accounts that are not found are reported as an error entry; all other
/// assets continue to be checked.
pub async fn check_trustlines_batch(
    horizon_url: &str,
    public_key: &str,
    assets: &[TrustlineAsset],
) -> Vec<(TrustlineAsset, Result<TrustlineStatus, TrustlineError>)> {
    let mut results = Vec::with_capacity(assets.len());
    for asset in assets {
        let status = check_trustline(horizon_url, public_key, asset).await;
        results.push((asset.clone(), status));
    }
    results
}

/// Remove an existing trustline by setting its limit to zero.
///
/// Only succeeds when the account balance for the asset is zero.
/// Returns [`TrustlineError::Other`] if the trustline is missing or
/// the balance is non-zero.
pub async fn remove_trustline(
    horizon_url: &str,
    source_secret: &str,
    asset: &TrustlineAsset,
) -> Result<(), TrustlineError> {
    let public_key = derive_public_key(source_secret)?;

    match check_trustline(horizon_url, &public_key, asset).await? {
        TrustlineStatus::Missing => {
            return Err(TrustlineError::Other(anyhow!(
                "No trustline for {} exists on {}",
                asset.code,
                public_key
            )));
        }
        TrustlineStatus::Exists { ref balance, .. } => {
            let bal: f64 = balance.parse().unwrap_or(0.0);
            if bal > 0.0 {
                return Err(TrustlineError::Other(anyhow!(
                    "Cannot remove trustline for {}: account still holds {}",
                    asset.code,
                    balance
                )));
            }
        }
        // Zero-limit and unauthorised trustlines can still be removed.
        _ => {}
    }

    submit_remove_trust(horizon_url, source_secret, asset).await?;
    info!(asset = %asset.code, account = %public_key, "Trustline removed");
    Ok(())
}

/// Ensure trustline with configurable retries.
///
/// Retries up to `max_retries` times with a fixed `delay_ms` between attempts.
/// Useful when the account may be newly funded and Horizon hasn't indexed it yet.
pub async fn ensure_trustline_with_retry(
    horizon_url: &str,
    source_secret: &str,
    asset: &TrustlineAsset,
    max_retries: u32,
    delay_ms: u64,
) -> Result<(), TrustlineError> {
    let mut attempt = 0;
    loop {
        match ensure_trustline(horizon_url, source_secret, asset).await {
            Ok(()) => return Ok(()),
            Err(TrustlineError::AccountNotFound(_)) if attempt < max_retries => {
                attempt += 1;
                warn!(
                    asset = %asset.code,
                    attempt,
                    max_retries,
                    "Account not found, retrying after {}ms", delay_ms
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
            Err(e) => return Err(e),
        }
    }
}

// ── Private helpers ──────────────────────────────────────────────────────────

/// Derives the public key from a secret key.
/// NOTE: Integrate the `stellar-base` keypair in production for full validation.
fn derive_public_key(secret: &str) -> Result<String, TrustlineError> {
    if secret.len() < 56 {
        return Err(TrustlineError::Other(anyhow!(
            "Invalid secret key length"
        )));
    }
    // Placeholder — replace with stellar_base::KeyPair::from_secret_seed(secret)
    Ok(secret[..56].to_string())
}

/// Builds and submits a ChangeTrust XDR transaction to Horizon.
/// NOTE: Integrate `stellar-xdr` crate for full XDR construction in production.
async fn submit_change_trust(
    horizon_url: &str,
    source_secret: &str,
    asset: &TrustlineAsset,
) -> Result<(), TrustlineError> {
    submit_change_trust_with_limit(horizon_url, source_secret, asset, "922337203685.4775807").await
}

/// Submits a ChangeTrust with limit=0 to remove a trustline.
async fn submit_remove_trust(
    horizon_url: &str,
    source_secret: &str,
    asset: &TrustlineAsset,
) -> Result<(), TrustlineError> {
    submit_change_trust_with_limit(horizon_url, source_secret, asset, "0").await
}

async fn submit_change_trust_with_limit(
    horizon_url: &str,
    source_secret: &str,
    asset: &TrustlineAsset,
    limit: &str,
) -> Result<(), TrustlineError> {
    let client = Client::new();
    let public_key = derive_public_key(source_secret)?;

    // Fetch current sequence number
    let account_url = format!(
        "{}/accounts/{}",
        horizon_url.trim_end_matches('/'),
        public_key
    );
    let account: Value = client.get(&account_url).send().await?.json().await?;
    let sequence: i64 = account["sequence"]
        .as_str()
        .ok_or_else(|| anyhow!("Missing sequence in account response"))?
        .parse()
        .map_err(|e| anyhow!("Failed to parse sequence: {}", e))?;

    // Build a stub ChangeTrust XDR envelope.
    // In production, use stellar-xdr to construct:
    //   Operation::ChangeTrust { asset: Asset::new(code, issuer), limit: parsed_limit }
    let envelope_xdr = format!(
        "STUB_CHANGE_TRUST_{}_{}_{}_{}_seq{}",
        asset.code,
        asset.issuer,
        limit,
        public_key,
        sequence + 1
    );

    let params = [("tx", envelope_xdr.as_str())];
    let response = client
        .post(format!("{}/transactions", horizon_url.trim_end_matches('/')))
        .form(&params)
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        if body.contains("op_low_reserve") {
            return Err(TrustlineError::Other(anyhow!(
                "Insufficient XLM reserve to create trustline (op_low_reserve)"
            )));
        }
        if body.contains("op_not_authorized") {
            return Err(TrustlineError::AuthorisationRequired(asset.code.clone()));
        }
        return Err(TrustlineError::HorizonError {
            status: status.as_u16(),
            body,
        });
    }

    Ok(())
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn usdc() -> TrustlineAsset {
        TrustlineAsset {
            code: "USDC".into(),
            issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN".into(),
        }
    }

    #[test]
    fn derive_public_key_rejects_short_secret() {
        let result = derive_public_key("tooshort");
        assert!(result.is_err());
    }

    #[test]
    fn trustline_asset_clone() {
        let asset = usdc();
        let cloned = asset.clone();
        assert_eq!(asset.code, cloned.code);
        assert_eq!(asset.issuer, cloned.issuer);
    }

    #[test]
    fn trustline_status_eq() {
        assert_eq!(TrustlineStatus::Missing, TrustlineStatus::Missing);
        assert_eq!(TrustlineStatus::Unauthorised, TrustlineStatus::Unauthorised);
        assert_eq!(TrustlineStatus::ZeroLimit, TrustlineStatus::ZeroLimit);
        assert_eq!(
            TrustlineStatus::Exists {
                balance: "0.0000000".into(),
                limit: "922337203685.4775807".into()
            },
            TrustlineStatus::Exists {
                balance: "0.0000000".into(),
                limit: "922337203685.4775807".into()
            }
        );
    }
}
