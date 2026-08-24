//! Compliance settlement executors for regulated corridors.
//!
//! Builds and submits the two on-chain compliance operations the NestJS API
//! dispatches after the mandatory multi-sig approval threshold is met:
//!
//! - **Clawback** ([`build_clawback_xdr`]) — moves assets from a flagged
//!   target account back to the operation source (the issuer treasury),
//!   requiring the asset to have the clawback flag enabled.
//! - **Freeze** ([`build_freeze_xdr`]) — issues a `SetTrustLineFlags`
//!   operation that clears the `AUTHORIZED_FLAG` on the target's trustline,
//!   blocking the account from sending or receiving the asset.
//!
//! Both operations are sourced from the issuer / compliance treasury account;
//! the signing secret is loaded from the worker environment
//! (`COMPLIANCE_SECRET_KEY` / `ISSUER_SECRET_KEY`) and never travels through
//! the Redis queue.

use std::env;

use crate::models::ComplianceJob;
use crate::stellar::{
    build_xdr_asset, derive_public_key, parse_stellar_amount, BASE_FEE_STROOPS,
    PUBLIC_PASSPHRASE, TESTNET_PASSPHRASE,
};

/// `TrustLineFlags.AUTHORIZED_FLAG` — clearing it freezes a trustline.
pub const TRUSTLINE_AUTHORIZED_FLAG: u32 = 1;

/// Process a compliance job end-to-end: fetch the source sequence, build the
/// XDR for the requested action type, sign with the compliance treasury key
/// and submit to Horizon.
pub async fn process_compliance_job(
    job: &ComplianceJob,
) -> Result<(), Box<dyn std::error::Error>> {
    let horizon_url = env::var("STELLAR_HORIZON_URL")
        .unwrap_or_else(|_| "https://horizon-testnet.stellar.org".to_string());
    let network = env::var("STELLAR_NETWORK").unwrap_or_default();
    let network_passphrase = if network == "mainnet" {
        PUBLIC_PASSPHRASE
    } else {
        TESTNET_PASSPHRASE
    };

    let source_secret = env::var("COMPLIANCE_SECRET_KEY")
        .or_else(|_| env::var("ISSUER_SECRET_KEY"))
        .map_err(|_| {
            "COMPLIANCE_SECRET_KEY (or ISSUER_SECRET_KEY) must be set to process compliance jobs"
                .to_string()
        })?;

    let source_public = derive_public_key(&source_secret)?;
    let sequence = fetch_account_sequence(&horizon_url, &source_public).await?;
    let issuer = job.asset_issuer.as_deref().unwrap_or("");

    let xdr = match job.action_type.as_str() {
        "CLAWBACK" => {
            let amount = job
                .amount
                .as_deref()
                .ok_or("CLAWBACK compliance job requires an amount")?;
            build_clawback_xdr(
                &job.target_account,
                amount,
                &job.asset_code,
                issuer,
                &source_secret,
                sequence,
                network_passphrase,
            )?
        }
        "FREEZE" => build_freeze_xdr(
            &job.target_account,
            &job.asset_code,
            issuer,
            &source_secret,
            sequence,
            network_passphrase,
        )?,
        other => return Err(format!("Unknown compliance action type: {}", other).into()),
    };

    let hash = submit_xdr(&horizon_url, &xdr).await?;
    println!(
        "✅ Compliance {} executed — action {}: {}",
        job.action_type, job.action_id, hash
    );
    Ok(())
}

/// Build and sign a Stellar **Clawback** transaction envelope.
///
/// The clawed-back assets are returned to the operation source — the issuer /
/// compliance treasury account derived from `source_secret`.
pub fn build_clawback_xdr(
    target_account: &str,
    amount: &str,
    asset_code: &str,
    asset_issuer: &str,
    source_secret: &str,
    sequence: i64,
    network_passphrase: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    use ed25519_dalek::{Signer, SigningKey};
    use sha2::{Digest, Sha256};
    use stellar_strkey::ed25519::{PrivateKey, PublicKey};
    use stellar_xdr::curr::{
        ClawbackOp, DecoratedSignature, Limits, Memo as XdrMemo, MuxedAccount,
        Operation as XdrOperation, OperationBody, Preconditions, SequenceNumber, Signature,
        SignatureHint, TimeBounds, TimePoint, Transaction as XdrTransaction,
        TransactionEnvelope, TransactionExt, TransactionV1Envelope, Uint256, WriteXdr,
    };

    let seed = PrivateKey::from_string(source_secret)?;
    let signing_key = SigningKey::from_bytes(&seed.0);
    let source_public = signing_key.verifying_key().to_bytes();
    let source_account = MuxedAccount::Ed25519(Uint256(source_public));
    let from = MuxedAccount::Ed25519(Uint256(PublicKey::from_string(target_account)?.0));

    let asset = build_xdr_asset(asset_code, asset_issuer)?;
    let amount_stroops = parse_stellar_amount(amount)?;
    let max_time = chrono::Utc::now().timestamp() as u64 + 300;

    let tx = XdrTransaction {
        source_account,
        fee: BASE_FEE_STROOPS,
        seq_num: SequenceNumber(sequence + 1),
        cond: Preconditions::Time(TimeBounds {
            min_time: TimePoint(0),
            max_time: TimePoint(max_time),
        }),
        memo: XdrMemo::None,
        operations: vec![XdrOperation {
            source_account: None,
            body: OperationBody::Clawback(ClawbackOp {
                asset,
                from,
                amount: amount_stroops,
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

/// Build and sign a Stellar **SetTrustLineFlags** transaction envelope that
/// freezes the target's trustline by clearing `AUTHORIZED_FLAG`.
///
/// Once frozen, the account can neither send nor receive the asset.
pub fn build_freeze_xdr(
    target_account: &str,
    asset_code: &str,
    asset_issuer: &str,
    source_secret: &str,
    sequence: i64,
    network_passphrase: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    use ed25519_dalek::{Signer, SigningKey};
    use sha2::{Digest, Sha256};
    use stellar_strkey::ed25519::{PrivateKey, PublicKey};
    use stellar_xdr::curr::{
        AccountId, DecoratedSignature, Limits, Memo as XdrMemo, MuxedAccount,
        Operation as XdrOperation, OperationBody, Preconditions, PublicKey as XdrPublicKey,
        SequenceNumber, SetTrustLineFlagsOp, Signature, SignatureHint, TimeBounds, TimePoint,
        Transaction as XdrTransaction, TransactionEnvelope, TransactionExt,
        TransactionV1Envelope, Uint256, WriteXdr,
    };

    let seed = PrivateKey::from_string(source_secret)?;
    let signing_key = SigningKey::from_bytes(&seed.0);
    let source_public = signing_key.verifying_key().to_bytes();
    let source_account = MuxedAccount::Ed25519(Uint256(source_public));
    let trustor = AccountId(XdrPublicKey::PublicKeyTypeEd25519(Uint256(
        PublicKey::from_string(target_account)?.0,
    )));

    let asset = build_xdr_asset(asset_code, asset_issuer)?;
    let max_time = chrono::Utc::now().timestamp() as u64 + 300;

    let tx = XdrTransaction {
        source_account,
        fee: BASE_FEE_STROOPS,
        seq_num: SequenceNumber(sequence + 1),
        cond: Preconditions::Time(TimeBounds {
            min_time: TimePoint(0),
            max_time: TimePoint(max_time),
        }),
        memo: XdrMemo::None,
        operations: vec![XdrOperation {
            source_account: None,
            body: OperationBody::SetTrustLineFlags(SetTrustLineFlagsOp {
                trustor,
                asset,
                clear_flags: TRUSTLINE_AUTHORIZED_FLAG,
                set_flags: 0,
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

// ── Private helpers ───────────────────────────────────────────────────────────

/// Fetch the current account sequence number from Horizon.
pub(crate) async fn fetch_account_sequence(
    horizon_url: &str,
    public_key: &str,
) -> Result<i64, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let url = format!(
        "{}/accounts/{}",
        horizon_url.trim_end_matches('/'),
        public_key
    );
    let response = client.get(&url).send().await?;
    if !response.status().is_success() {
        return Err(format!("Horizon account fetch failed: {}", response.status()).into());
    }
    let account: serde_json::Value = response.json().await?;
    let sequence: i64 = account["sequence"]
        .as_str()
        .ok_or("Missing sequence in Horizon account response")?
        .parse()?;
    Ok(sequence)
}

/// Submit a signed XDR envelope to Horizon and return the transaction hash.
pub(crate) async fn submit_xdr(
    horizon_url: &str,
    xdr: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/transactions", horizon_url.trim_end_matches('/')))
        .form(&[("tx", xdr)])
        .send()
        .await?;
    let status = response.status();
    let body: serde_json::Value = response.json().await?;
    if !status.is_success() {
        return Err(format!("Horizon submission failed ({}): {}", status, body).into());
    }
    body["hash"]
        .as_str()
        .ok_or_else(|| "Missing tx hash in Horizon response".into())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_strkey::ed25519::PublicKey;
    use stellar_xdr::curr::{
        Limits, MuxedAccount, OperationBody, ReadXdr, TransactionEnvelope, Uint256,
    };

    const SOURCE_SECRET: &str = "SA2YNBQZ6FJ6OKMOQHZ2BUZBS5ERLSOXFPUCXJ66ASOLFSLG57YPOOHH";
    const SOURCE_PUBLIC: &str = "GBZDVZMN65YLWARGZ5Y4DBWECYJBWHKEBSNZUMPKKTKOP3OWSYVD23BQ";
    const TARGET_PUBLIC: &str = "GB3IZ2LJNZ7GFE6TQHDEZAGK5QLQJ2UPLY5TMNU5BZIWJYCA3C7INQRO";
    // Issuer doubles as the operation source in the round-trip fixtures — the
    // realistic treasury-owns-the-asset shape.
    const ISSUER_PUBLIC: &str = "GBZDVZMN65YLWARGZ5Y4DBWECYJBWHKEBSNZUMPKKTKOP3OWSYVD23BQ";
    const ASSET_CODE: &str = "USDC";

    fn target_bytes() -> [u8; 32] {
        PublicKey::from_string(TARGET_PUBLIC).unwrap().0
    }

    #[test]
    fn test_build_clawback_xdr_round_trip() {
        let xdr = build_clawback_xdr(
            TARGET_PUBLIC,
            "12.5",
            ASSET_CODE,
            ISSUER_PUBLIC,
            SOURCE_SECRET,
            12345,
            TESTNET_PASSPHRASE,
        )
        .expect("clawback XDR should be built");

        let envelope = TransactionEnvelope::from_xdr_base64(&xdr, Limits::none())
            .expect("clawback XDR should decode");
        match envelope {
            TransactionEnvelope::Tx(envelope) => {
                assert_eq!(envelope.tx.seq_num.0, 12346);
                assert_eq!(envelope.signatures.len(), 1);

                let ops: &[stellar_xdr::curr::Operation] = &envelope.tx.operations;
                assert_eq!(ops.len(), 1);
                match &ops[0].body {
                    OperationBody::Clawback(op) => {
                        // 12.5 USDC → 125000000 stroops
                        assert_eq!(op.amount, 125_000_000);
                        match &op.from {
                            MuxedAccount::Ed25519(Uint256(bytes)) => {
                                assert_eq!(bytes, &target_bytes())
                            }
                            _ => panic!("expected ed25519 muxed account"),
                        }
                    }
                    _ => panic!("expected clawback operation"),
                }
            }
            _ => panic!("expected v1 transaction envelope"),
        }
    }

    #[test]
    fn test_build_freeze_xdr_round_trip() {
        let xdr = build_freeze_xdr(
            TARGET_PUBLIC,
            ASSET_CODE,
            ISSUER_PUBLIC,
            SOURCE_SECRET,
            12345,
            TESTNET_PASSPHRASE,
        )
        .expect("freeze XDR should be built");

        let envelope = TransactionEnvelope::from_xdr_base64(&xdr, Limits::none())
            .expect("freeze XDR should decode");
        match envelope {
            TransactionEnvelope::Tx(envelope) => {
                assert_eq!(envelope.tx.seq_num.0, 12346);
                assert_eq!(envelope.signatures.len(), 1);

                let ops: &[stellar_xdr::curr::Operation] = &envelope.tx.operations;
                assert_eq!(ops.len(), 1);
                match &ops[0].body {
                    OperationBody::SetTrustLineFlags(op) => {
                        // Freezing clears AUTHORIZED_FLAG and sets nothing.
                        assert_eq!(op.clear_flags, TRUSTLINE_AUTHORIZED_FLAG);
                        assert_eq!(op.set_flags, 0);
                        let stellar_xdr::curr::AccountId(
                            stellar_xdr::curr::PublicKey::PublicKeyTypeEd25519(Uint256(bytes)),
                        ) = &op.trustor;
                        assert_eq!(bytes, &target_bytes());
                    }
                    _ => panic!("expected SetTrustLineFlags operation"),
                }
            }
            _ => panic!("expected v1 transaction envelope"),
        }
    }

    #[test]
    fn test_freeze_clears_authorized_flag() {
        assert_eq!(TRUSTLINE_AUTHORIZED_FLAG, 1);
        // A frozen trustline must not set any flags.
        let xdr = build_freeze_xdr(
            TARGET_PUBLIC,
            ASSET_CODE,
            ISSUER_PUBLIC,
            SOURCE_SECRET,
            1,
            TESTNET_PASSPHRASE,
        )
        .unwrap();
        let envelope = TransactionEnvelope::from_xdr_base64(&xdr, Limits::none()).unwrap();
        match envelope {
            TransactionEnvelope::Tx(envelope) => {
                let ops: &[stellar_xdr::curr::Operation] = &envelope.tx.operations;
                match &ops[0].body {
                    OperationBody::SetTrustLineFlags(op) => {
                        assert_eq!(op.set_flags, 0);
                        assert_eq!(op.clear_flags, 1);
                    }
                    _ => panic!("expected SetTrustLineFlags operation"),
                }
            }
            _ => panic!("expected v1 transaction envelope"),
        }
    }

    #[test]
    fn test_derive_public_key_from_secret_seed() {
        let public = derive_public_key(SOURCE_SECRET).expect("secret should derive public key");
        assert_eq!(public, SOURCE_PUBLIC);
    }
}
