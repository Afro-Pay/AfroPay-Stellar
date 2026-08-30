use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionJob {
    pub id: String,
    pub user_id: String,
    pub source_wallet: String,
    pub destination_wallet: String,
    pub amount: String,
    pub asset_code: String,
    pub asset_issuer: String,
    pub memo: Option<String>,
    pub requires_cosign: bool,  // New field
    pub threshold_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningResult {
    pub transaction_hash: String,
    pub signatures_applied: usize,
    pub required_signatures: usize,
}

/// A liquidity rebalance job published by the NestJS API onto the
/// `liquidity_rebalance_jobs` Redis list. It contains no secret material.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiquidityRebalanceJob {
    pub rebalance_id: String,
    pub corridor: String,
    pub from_asset: String,
    pub to_asset: String,
    pub source_amount: String,
    pub destination_min_amount: String,
    pub treasury_account: String,
    pub destination_account: String,
    pub from_asset_issuer: String,
    pub to_asset_issuer: String,
    pub network: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceJob {
    pub action_id: String,
    /// "FREEZE" (SetTrustLineFlags) or "CLAWBACK".
    pub action_type: String,
    /// Stellar public key of the account being frozen or clawed back.
    pub target_account: String,
    pub asset_code: String,
    /// Asset issuer public key; empty for native XLM.
    pub asset_issuer: Option<String>,
    /// Amount to claw back (decimal string). None for freeze actions.
    pub amount: Option<String>,
    /// "testnet" or "mainnet".
    pub network: Option<String>,
}
