//! Stellar XDR construction and key-derivation helpers.
//!
//! Transaction envelopes are built directly against `stellar-xdr` and signed
//! with `ed25519-dalek`, so the worker only depends on crates that actually
//! exist on crates.io (the previously referenced `stellar_sdk 0.4` was never
//! published, so the old high-level `StellarService` could not compile).

/// Stroops charged per operation for a simple payment transaction.
pub(crate) const BASE_FEE_STROOPS: u32 = 100;
pub const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";
pub const PUBLIC_PASSPHRASE: &str = "Public Global Stellar Network ; September 2015";

/// Derive a Stellar account ID (G...) from a Stellar secret seed (S...).
pub fn derive_public_key(secret: &str) -> Result<String, Box<dyn std::error::Error>> {
    use ed25519_dalek::SigningKey;
    use stellar_strkey::ed25519::{PrivateKey, PublicKey};

    let seed = PrivateKey::from_string(secret)?;
    let signing_key = SigningKey::from_bytes(&seed.0);
    let verifying_key = signing_key.verifying_key();
    Ok(format!("{}", PublicKey(verifying_key.to_bytes())))
}

/// Helper function to determine if a transaction requires cosigning.
pub fn requires_cosign(amount_usd: f64, threshold_usd: f64) -> bool {
    amount_usd > threshold_usd
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
    use stellar_xdr::curr::{
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

pub(crate) fn build_xdr_asset(
    code: &str,
    issuer: &str,
) -> Result<stellar_xdr::curr::Asset, Box<dyn std::error::Error>> {
    use stellar_strkey::ed25519::PublicKey;
    use stellar_xdr::curr::{
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

fn build_xdr_memo(memo: &str) -> Result<stellar_xdr::curr::Memo, Box<dyn std::error::Error>> {
    use stellar_xdr::curr::{Memo, StringM};
    if memo.as_bytes().len() > 28 {
        return Err("Stellar text memo must be 28 bytes or fewer".into());
    }
    Ok(Memo::Text(StringM::try_from(memo.to_string())?))
}

pub(crate) fn parse_stellar_amount(amount: &str) -> Result<i64, Box<dyn std::error::Error>> {
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
        let secret = "SA2YNBQZ6FJ6OKMOQHZ2BUZBS5ERLSOXFPUCXJ66ASOLFSLG57YPOOHH";
        let public = derive_public_key(secret).expect("secret seed should derive public key");
        assert_eq!(
            public,
            "GBZDVZMN65YLWARGZ5Y4DBWECYJBWHKEBSNZUMPKKTKOP3OWSYVD23BQ"
        );
    }

    #[test]
    fn test_build_payment_xdr_round_trip() {
        use stellar_xdr::curr::{Limits, ReadXdr, TransactionEnvelope};

        let job = crate::models::TransactionJob {
            id: "test-job".to_string(),
            user_id: "test-user".to_string(),
            source_wallet: "GBZDVZMN65YLWARGZ5Y4DBWECYJBWHKEBSNZUMPKKTKOP3OWSYVD23BQ".to_string(),
            destination_wallet: "GB3IZ2LJNZ7GFE6TQHDEZAGK5QLQJ2UPLY5TMNU5BZIWJYCA3C7INQRO"
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
            "SA2YNBQZ6FJ6OKMOQHZ2BUZBS5ERLSOXFPUCXJ66ASOLFSLG57YPOOHH",
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
