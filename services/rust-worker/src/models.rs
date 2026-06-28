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
