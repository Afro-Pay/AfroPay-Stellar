use stellar_sdk::{
    types::{AccountId, Asset, Memo, MemoText, Operation, Transaction},
    HorizonClient, Keypair, Network, Server,
};
use std::env;
use sha2::{Sha256, Digest};

pub struct StellarService {
    horizon_client: HorizonClient,
    network: Network,
}

#[derive(Debug)]
pub struct SigningConfig {
    pub requires_cosign: bool,
    pub user_keypair: Keypair,
    pub cosigner_keypair: Option<Keypair>,
}

impl StellarService {
    pub fn new() -> Self {
        let horizon_url = env::var("HORIZON_URL")
            .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string());
        let network = if env::var("STELLAR_NETWORK").unwrap_or_default() == "mainnet" {
            Network::Public
        } else {
            Network::Testnet
        };
        
        StellarService {
            horizon_client: HorizonClient::new(horizon_url),
            network,
        }
    }

    /// Build a transaction with optional multi-signature
    pub async fn build_transaction(
        &self,
        source_account: &str,
        destination: &str,
        amount: &str,
        asset_code: &str,
        asset_issuer: &str,
        memo: Option<&str>,
        config: &SigningConfig,
    ) -> Result<Transaction, Box<dyn std::error::Error>> {
        let source_account = self.horizon_client.load_account(source_account).await?;
        
        let asset = if asset_code == "XLM" {
            Asset::native()
        } else {
            Asset::new(asset_code, asset_issuer)?
        };

        let mut transaction = Transaction::builder(&source_account)
            .operation(Operation::Payment {
                destination: AccountId::from_string(destination)?,
                asset,
                amount: amount.parse()?,
            })
            .network(self.network);

        if let Some(memo_text) = memo {
            transaction = transaction.memo(Memo::Text(MemoText::new(memo_text)?));
        }

        let transaction = transaction.build()?;

        // Sign based on configuration
        let signed_transaction = if config.requires_cosign {
            self.sign_with_multisig(transaction, config)?
        } else {
            self.sign_with_single(transaction, config)?
        };

        Ok(signed_transaction)
    }

    /// Sign with single keypair (standard flow)
    fn sign_with_multisig(
        &self,
        mut transaction: Transaction,
        config: &SigningConfig,
    ) -> Result<Transaction, Box<dyn std::error::Error>> {
        // Sign with user's key
        transaction = transaction.sign(&[&config.user_keypair]);
        
        // Sign with cosigner key
        if let Some(cosigner) = &config.cosigner_keypair {
            transaction = transaction.sign(&[cosigner]);
            println!("✅ Transaction signed with both user and cosigner keys");
        } else {
            return Err("Cosigner keypair required for multisig transaction".into());
        }

        Ok(transaction)
    }

    /// Sign with single keypair (standard flow)
    fn sign_with_single(
        &self,
        mut transaction: Transaction,
        config: &SigningConfig,
    ) -> Result<Transaction, Box<dyn std::error::Error>> {
        transaction = transaction.sign(&[&config.user_keypair]);
        println!("✅ Transaction signed with user key only");
        Ok(transaction)
    }

    /// Submit a signed transaction to the network
    pub async fn submit_transaction(
        &self,
        transaction: &Transaction,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let response = self.horizon_client.submit_transaction(transaction).await?;
        Ok(response.hash)
    }

    /// Enable multi-signature on an account
    pub async fn enable_multisig(
        &self,
        account_id: &str,
        cosigner_public_key: &str,
        user_keypair: &Keypair,
        master_weight: u8,
        threshold_weight: u8,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let source_account = self.horizon_client.load_account(account_id).await?;
        
        let transaction = Transaction::builder(&source_account)
            .operation(Operation::SetOptions {
                master_weight: Some(master_weight),
                low_threshold: Some(0),
                medium_threshold: Some(threshold_weight),
                high_threshold: Some(threshold_weight),
                signer: Some((
                    cosigner_public_key.parse()?,
                    threshold_weight, // Weight for cosigner
                )),
                ..Default::default()
            })
            .network(self.network)
            .build()?
            .sign(&[user_keypair]);

        let response = self.horizon_client.submit_transaction(&transaction).await?;
        Ok(response.hash)
    }

    /// Check if an account has multi-signature enabled
    pub async fn check_multisig_status(
        &self,
        account_id: &str,
        cosigner_public_key: &str,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let account = self.horizon_client.load_account(account_id).await?;
        
        // Check if cosigner is in the signers list
        for signer in account.signers() {
            if signer.key == cosigner_public_key {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// Helper function to determine if transaction requires cosign
pub fn requires_cosign(amount_usd: f64, threshold_usd: f64) -> bool {
    amount_usd > threshold_usd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_requires_cosign() {
        // Test below threshold
        assert!(!requires_cosign(5000.0, 10000.0));
        assert!(!requires_cosign(9999.99, 10000.0));
        
        // Test at threshold
        assert!(!requires_cosign(10000.0, 10000.0));
        
        // Test above threshold
        assert!(requires_cosign(10000.01, 10000.0));
        assert!(requires_cosign(15000.0, 10000.0));
    }
}
