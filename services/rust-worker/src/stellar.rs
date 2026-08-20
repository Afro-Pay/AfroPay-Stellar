use std::env;
use stellar_sdk::{
    types::{AccountId, Asset, Memo, MemoText, Operation, Transaction},
    HorizonClient, Keypair, Network,
};

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

    #[test]
    fn test_derive_public_key_from_secret_seed() {
        let secret = "SBVDMZXHTZJ6F5NJZRFCZLWMSCYJ4XNXZPX5RVEVHMVZRQ3Q7BY3TJVU";
        let public = derive_public_key(secret).expect("secret seed should derive public key");
        assert_eq!(
            public,
            "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        );
    }

    #[test]
    fn test_build_payment_xdr_round_trip() {
        use stellar_xdr::{Limits, ReadXdr, TransactionEnvelope};

        let job = crate::models::TransactionJob {
            id: "test-job".to_string(),
            user_id: "test-user".to_string(),
            source_wallet: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN".to_string(),
            destination_wallet: "GBL3Q6QXPWQWUPDZC4ASXA65Y2NHLQYZKSGEKJE7LNZN6XMMVKF5RWYS"
                .to_string(),
            amount: "12.3456789".to_string(),
            asset_code: "XLM".to_string(),
            asset_issuer: "".to_string(),
            memo: Some("round-trip".to_string()),
            requires_cosign: false,
            threshold_usd: None,
        };

        let xdr = build_payment_xdr(
            &job,
            "SBVDMZXHTZJ6F5NJZRFCZLWMSCYJ4XNXZPX5RVEVHMVZRQ3Q7BY3TJVU",
            12345,
            TESTNET_PASSPHRASE,
        )
        .expect("payment XDR should be built");

        let envelope = TransactionEnvelope::from_xdr_base64(&xdr, Limits::none())
            .expect("payment XDR should decode");
        match envelope {
            TransactionEnvelope::Tx(envelope) => {
                assert_eq!(envelope.tx.seq_num.0, 12346);
                assert_eq!(envelope.signatures.len(), 1);
            }
            _ => panic!("expected v1 transaction envelope"),
        }
    }
}

/// Stroops charged per operation for a simple payment transaction.
const BASE_FEE_STROOPS: u32 = 100;
pub const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";
pub const PUBLIC_PASSPHRASE: &str = "Public Global Stellar Network ; September 2015";

/// Derive a Stellar account ID (G...) from a Stellar secret seed (S...).
pub fn derive_public_key(secret: &str) -> Result<String, Box<dyn std::error::Error>> {
    use ed25519_dalek::SigningKey;
    use stellar_strkey::ed25519::{PrivateKey, PublicKey};

    let seed = PrivateKey::from_string(secret)?;
    let signing_key = SigningKey::from_bytes(&seed.0);
    let verifying_key = signing_key.verifying_key();
    Ok(PublicKey(verifying_key.to_bytes()).to_string())
}

/// Build and sign a Stellar payment transaction envelope as Horizon-ready base64 XDR.
pub fn build_payment_xdr(
    job: &crate::models::TransactionJob,
    source_secret: &str,
    sequence: i64,
    network_passphrase: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    use ed25519_dalek::{Signer, SigningKey};
    use sha2::{Digest, Sha256};
    use stellar_strkey::ed25519::{PrivateKey, PublicKey};
    use stellar_xdr::{
        DecoratedSignature, Limits, Memo as XdrMemo, MuxedAccount, Operation as XdrOperation,
        OperationBody, PaymentOp, Preconditions, SequenceNumber, Signature, SignatureHint,
        TimeBounds, TimePoint, Transaction as XdrTransaction, TransactionEnvelope, TransactionExt,
        TransactionV1Envelope, Uint256, WriteXdr,
    };

    let seed = PrivateKey::from_string(source_secret)?;
    let signing_key = SigningKey::from_bytes(&seed.0);
    let source_public = signing_key.verifying_key().to_bytes();
    let source_account = MuxedAccount::Ed25519(Uint256(source_public));
    let destination = PublicKey::from_string(&job.destination_wallet)?;

    let amount = parse_stellar_amount(&job.amount)?;
    let asset = build_xdr_asset(&job.asset_code, &job.asset_issuer)?;
    let max_time = chrono::Utc::now().timestamp() as u64 + 300;

    let tx = XdrTransaction {
        source_account,
        fee: BASE_FEE_STROOPS,
        seq_num: SequenceNumber(sequence + 1),
        cond: Preconditions::Time(TimeBounds {
            min_time: TimePoint(0),
            max_time: TimePoint(max_time),
        }),
        memo: job
            .memo
            .as_deref()
            .map(build_xdr_memo)
            .transpose()?
            .unwrap_or(XdrMemo::None),
        operations: vec![XdrOperation {
            source_account: None,
            body: OperationBody::Payment(PaymentOp {
                destination: MuxedAccount::Ed25519(Uint256(destination.0)),
                asset,
                amount,
            }),
        }]
        .try_into()?,
        ext: TransactionExt::V0,
    };

    let network_id: [u8; 32] = Sha256::digest(network_passphrase.as_bytes()).into();
    let tx_hash = tx.hash(network_id)?;
    let signature = signing_key.sign(&tx_hash).to_bytes().to_vec().try_into()?;
    let hint = SignatureHint(source_public[28..32].try_into()?);

    TransactionEnvelope::Tx(TransactionV1Envelope {
        tx,
        signatures: vec![DecoratedSignature {
            hint,
            signature: Signature(signature),
        }]
        .try_into()?,
    })
    .to_xdr_base64(Limits::none())
    .map_err(Into::into)
}

fn build_xdr_asset(
    code: &str,
    issuer: &str,
) -> Result<stellar_xdr::Asset, Box<dyn std::error::Error>> {
    use stellar_strkey::ed25519::PublicKey;
    use stellar_xdr::{
        AccountId, AlphaNum12, AlphaNum4, Asset, AssetCode12, AssetCode4,
        PublicKey as XdrPublicKey, Uint256,
    };

    if code == "XLM" {
        return Ok(Asset::Native);
    }
    let issuer = AccountId(XdrPublicKey::PublicKeyTypeEd25519(Uint256(
        PublicKey::from_string(issuer)?.0,
    )));
    let bytes = code.as_bytes();
    if bytes.is_empty() || bytes.len() > 12 {
        return Err("asset code must be 1-12 ASCII bytes".into());
    }
    if !bytes.is_ascii() {
        return Err("asset code must be ASCII".into());
    }
    if bytes.len() <= 4 {
        let mut asset_code = [0u8; 4];
        asset_code[..bytes.len()].copy_from_slice(bytes);
        Ok(Asset::CreditAlphanum4(AlphaNum4 {
            asset_code: AssetCode4(asset_code),
            issuer,
        }))
    } else {
        let mut asset_code = [0u8; 12];
        asset_code[..bytes.len()].copy_from_slice(bytes);
        Ok(Asset::CreditAlphanum12(AlphaNum12 {
            asset_code: AssetCode12(asset_code),
            issuer,
        }))
    }
}

fn build_xdr_memo(memo: &str) -> Result<stellar_xdr::Memo, Box<dyn std::error::Error>> {
    use stellar_xdr::{Memo, StringM};
    if memo.as_bytes().len() > 28 {
        return Err("Stellar text memo must be 28 bytes or fewer".into());
    }
    Ok(Memo::Text(StringM::try_from(memo.to_string())?))
}

fn parse_stellar_amount(amount: &str) -> Result<i64, Box<dyn std::error::Error>> {
    let (whole, frac) = amount.split_once('.').unwrap_or((amount, ""));
    if frac.len() > 7 {
        return Err("Stellar amounts support at most 7 decimal places".into());
    }
    let whole_stroops = whole
        .parse::<i64>()?
        .checked_mul(10_000_000)
        .ok_or("amount overflow")?;
    let mut frac_padded = frac.to_string();
    while frac_padded.len() < 7 {
        frac_padded.push('0');
    }
    Ok(whole_stroops + frac_padded.parse::<i64>()?)
}
