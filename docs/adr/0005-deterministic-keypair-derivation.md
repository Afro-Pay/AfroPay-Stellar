# ADR 0005: Deterministic Keypair Derivation

## Status

Accepted

## Context

AfroPay-Stellar's Rust worker must perform Stellar transactions (payments, trustlines, escrow operations) on behalf of the platform. This requires access to private keys. The system must balance:

1. **Security**: Private keys must be protected and never exposed to insecure environments.
2. **Recovery**: If worker restarts or moves to a different server, it must derive the same keypair to sign operations.
3. **Scalability**: Multiple worker instances across regions must use consistent keys without shared state.
4. **Auditability**: Every operation must be traceable to a specific key/worker.

The system uses deterministic keypair derivation from a master seed rather than generating random keypairs or storing multiple key files.

## Decision Drivers

1. **Recovery Guarantees**: Restarting the worker with the same master seed must derive identical keypairs.
2. **No Key Storage**: Avoid storing private keys in files or vaults; derive them on-demand.
3. **Multi-Worker Coordination**: Multiple workers must sign with the same key without requiring shared key storage.
4. **Auditability**: Each derived key can be traced back to its derivation path (purpose, user, context).
5. **Simplicity**: Deterministic derivation is simpler than HSM integration or key distribution systems.
6. **Compliance**: Private key material must be isolated and protected; never logged or serialized to disk.

## Considered Options

### Option 1: Random Keypair Generation (Rejected)

Generate a random keypair for each worker instance and store in secure vault or environment.

**Pros**:

- Simplest initially; standard approach in many systems
- Explicit key rotation by changing environment variable

**Cons**:

- Multiple worker instances require synchronized key distribution
- Key storage becomes a single point of failure (vault compromise means all keys compromised)
- If vault is inaccessible, worker cannot start
- Horizontal scaling requires managing many keys
- Difficult to trace which key signed which operation without additional logging
- Lost worker cannot be replaced without vault lookup

### Option 2: HSM or Managed Key Service (Rejected)

Delegate key generation and signing to AWS KMS, AWS CloudHSM, or Azure Key Vault.

**Pros**:

- Private key material never stored in application
- Built-in key rotation and audit trails
- Compliance-friendly (FIPS 140-2 certified)
- Hardware-backed security

**Cons**:

- Network dependency; every signature requires HSM call
- Signing latency increases (100–500ms per operation)
- Cost per signature operation
- Regional isolation; difficult in cross-border setup
- Complexity managing HSM credentials and authorization

### Option 3: Deterministic Keypair Derivation (Chosen)

Derive keypairs deterministically from a master seed using HKDF (HMAC-based Key Derivation Function). Each purpose (payment, signing, contract interaction) gets a unique derived key.

**Process**:

1. Master seed is stored in environment (`MASTER_SEED`) or secure file (`/etc/seeds/master_seed.txt`).
2. At startup, worker loads the master seed.
3. For each signing operation, derive a specific keypair using:
   - Master seed + derivation path (purpose, context)
   - HKDF-SHA256 to produce deterministic 32-byte seed
   - Stellar keypair from deterministic seed

**Pros**:

- No external dependency; deterministic derivation is pure function
- Signing is fast and local; no network calls
- Same master seed always produces same keypairs (recoverability)
- Multiple workers use same master seed, produce same keys
- Horizontal scaling without key distribution complexity
- Derivation is auditable: path reveals purpose and context
- No private key storage; derived on-demand and discarded after signing
- Simple recovery: provide same `MASTER_SEED`, worker recovers all keys

**Cons**:

- Master seed is a single point of failure; compromise exposes all derived keys
- No HSM protection by default (unless master seed is wrapped by HSM)
- Key rotation requires changing master seed and re-deriving all keys
- Must carefully guard master seed in environment and during deployment
- Derivation path design must be unambiguous to prevent path collisions

## Decision Outcome

**Chosen: Deterministic Keypair Derivation**

Implementation in `services/rust-worker/src/keypair.rs`:

```rust
use sha2::{Sha256, Digest};
use hkdf::Hkdf;
use stellar_sdk::KeyPair;

pub struct DeterministicKeychain {
    master_seed: Vec<u8>,
}

impl DeterministicKeychain {
    /// Load master seed from environment or file
    pub fn new() -> Result<Self, String> {
        let master_seed = if let Ok(seed) = std::env::var("MASTER_SEED") {
            seed.into_bytes()
        } else if let Ok(seed) = std::fs::read_to_string("/etc/seeds/master_seed.txt") {
            seed.trim().into_bytes()
        } else {
            return Err("MASTER_SEED not found".to_string());
        };

        if master_seed.len() < 32 {
            return Err("MASTER_SEED must be at least 32 bytes".to_string());
        }

        Ok(DeterministicKeychain { master_seed })
    }

    /// Derive a keypair for a specific purpose
    pub fn derive_keypair_for_purpose(&self, purpose: &str) -> Result<KeyPair, String> {
        let hkdf = Hkdf::<Sha256>::new(Some(b"stellar-keypair-derivation"), &self.master_seed);
        let mut seed = [0u8; 32];
        hkdf.expand(purpose.as_bytes(), &mut seed)
            .map_err(|e| format!("HKDF expansion failed: {}", e))?;

        KeyPair::from_secret_seed(&seed)
    }

    /// Derive a keypair for a specific user
    pub fn derive_keypair_for_user(&self, user_id: &str) -> Result<KeyPair, String> {
        let purpose = format!("user-escrow-{}", user_id);
        self.derive_keypair_for_purpose(&purpose)
    }

    /// Derive a keypair for platform settlement operations
    pub fn derive_settlement_keypair(&self) -> Result<KeyPair, String> {
        self.derive_keypair_for_purpose("platform-settlement")
    }
}
```

**Usage in worker**:

```rust
// At startup
let keychain = DeterministicKeychain::new()?;

// When signing a transaction
let user_id = "user-123";
let keypair = keychain.derive_keypair_for_user(user_id)?;

// Build and sign transaction
let tx = TransactionBuilder::new(account, &network)
    .add_operation(payment_op)
    .set_timeout(30)
    .build()?;

let tx_envelope = tx.into_envelope();
let signed_envelope = tx_envelope.sign(&keypair, &network)?;

// Submit to Horizon
horizon_client.submit_transaction(&signed_envelope).await?;
```

**Master seed protection**:

In production (Kubernetes):

```yaml
# secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: rust-worker-secrets
type: Opaque
stringData:
  MASTER_SEED: "your_high_entropy_seed_here"
---
# deployment.yaml (reference secret)
spec:
  containers:
    - name: rust-worker
      env:
        - name: MASTER_SEED
          valueFrom:
            secretKeyRef:
              name: rust-worker-secrets
              key: MASTER_SEED
```

## Consequences

### Positive

1. **Recoverability**: Any worker instance can derive all keys from master seed; no single-point failure.
2. **Auditability**: Derivation path encodes purpose and context; signing operations are traceable.
3. **Simplicity**: No external key service or vault integration needed.
4. **Performance**: Signing is local and fast; no network round-trips.
5. **Scalability**: Multiple workers use same master seed without coordination.
6. **Security**: Private key material is never stored; derived on-demand and discarded.
7. **Compliance-Friendly**: Deterministic derivation is transparent and auditable.

### Negative

1. **Master Seed Risk**: Single point of failure; if master seed is compromised, all derived keys are compromised.
2. **Key Rotation Complexity**: Rotating keys requires changing master seed and updating all signed material.
3. **No HSM by Default**: Without additional infrastructure, master seed is stored in environment or file (not HSM-protected).
4. **Derivation Path Collisions**: Poorly designed paths can collide; requires careful path design.
5. **Audit Trail**: Derivation is internal; external auditors cannot verify which key signed which operation without application logs.

## Links

- Related: [ADR 0001: BullMQ for Asynchronous Settlement](./0001-bullmq-async-settlement.md) — worker uses derived keys to sign queued transactions
- Related: [ADR 0002: AES-256-GCM Envelope Encryption](./0002-aes256-gcm-envelope-encryption.md) — similar deterministic derivation pattern for wallet encryption
- Reference: [Deterministic Keypair Derivation Documentation](../deterministic-keypair.md)
- Reference: [Secrets Management](../secrets-management.md)
- Reference: [HKDF RFC 5869](https://tools.ietf.org/html/rfc5869)
- Reference: [Stellar Keypair Documentation](https://developers.stellar.org/learn/fundamentals/key-concepts/keypairs)
