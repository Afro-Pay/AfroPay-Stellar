# ADR 0002: AES-256-GCM Envelope Encryption

## Status

Accepted

## Context

AfroPay-Stellar must securely store user wallet secrets (Stellar keypairs, recovery seeds) in PostgreSQL. The team considered two broad approaches:

1. **Pure KMS (AWS KMS, Google Cloud KMS, etc.)**: All encryption and decryption handled by an external service.
2. **Hybrid / Envelope Encryption**: Application derives encryption keys locally and uses AES-256-GCM, with keys themselves optionally protected by a KMS.

Current production uses AES-256-GCM envelope encryption with application-derived keys, balancing security, performance, and operational complexity.

## Decision Drivers

1. **Performance**: Decryption happens on every wallet operation; sub-millisecond latency is required.
2. **Availability**: Wallet operations must work if external KMS is unavailable (graceful degradation).
3. **Compliance**: Must support auditable encryption with authenticated encryption (AEAD).
4. **Cost**: Minimize per-request charges from managed KMS services.
5. **Key Isolation**: Each user's wallet data should use a unique encryption key.
6. **Developer Experience**: Encryption/decryption logic should be straightforward to reason about and test.

## Considered Options

### Option 1: Pure External KMS (Rejected)

All encryption and decryption delegated to AWS KMS, Azure Key Vault, or Google Cloud KMS.

**Pros**:

- Key material never stored in application memory
- Centralized audit trail at KMS provider
- Hardware security modules (HSM) available for high-assurance deployments
- No key rotation logic in application

**Cons**:

- Network round-trip for every encryption/decryption operation (~100ms per call)
- Throughput bottleneck if API handles thousands of concurrent wallet reads
- Cost per encryption/decryption call (AWS KMS ~$0.03 per 10,000 calls)
- Regional latency issues in cross-border setup
- Hard dependency: if KMS is unavailable, wallet operations fail immediately
- Complexity managing KMS credentials and IAM roles

### Option 2: AES-256-GCM Envelope Encryption (Chosen)

Application maintains a master encryption key (from environment or secure storage) and derives per-wallet keys using HKDF. Wallet data is encrypted with AES-256-GCM (AEAD cipher providing confidentiality and authenticity).

**Pros**:

- Encryption/decryption happens entirely in-process; <1ms latency per operation
- No external dependency or network calls
- No per-operation cost
- AEAD ensures both confidentiality and authenticity (detects tampering)
- Master key can optionally be protected by a KMS or HSM
- Deterministic key derivation allows key rotation without re-encrypting stored data
- Suitable for distributed, horizontally scaled deployments (each instance uses same master key)

**Cons**:

- Master key must be protected in application environment or key store
- No built-in HSM protection unless master key is wrapped with an external KMS
- Key rotation logic must be implemented in application
- Less visibility into which user accessed which data (audit trail in app logs, not KMS)

### Option 3: Hybrid Approach (Partial KMS)

Master key stored in AWS KMS; application fetches it at startup and caches it. Wallet data encrypted with AES-256-GCM using derived keys.

**Pros**:

- Combines KMS centralization (key provenance) with application-side performance
- Master key protected by HSM if KMS is HSM-backed
- Startup verification that application is authorized to access encryption master
- Can optionally validate key access on each operation

**Cons**:

- Still adds startup dependency; if KMS unreachable at boot, app fails to start
- Master key must be cached in memory; introduces a small window of vulnerability
- Adds operational complexity of KMS credential management
- Ongoing costs for KMS even if keys aren't actively used

## Decision Outcome

**Chosen: AES-256-GCM Envelope Encryption with Application-Derived Keys**

Implementation in `apps/api/src/crypto/encryption.service.ts`:

```typescript
// Load master key from secure environment
const MASTER_KEY = process.env.ENCRYPTION_KEY; // 64-char hex = 32 bytes

// For each wallet, derive a unique key from master + wallet ID
function deriveWalletKey(walletId: string, masterKey: Buffer): Buffer {
  return hkdf(
    "sha256",
    masterKey,
    Buffer.from(walletId), // salt: unique per wallet
    Buffer.from("wallet-encryption"), // info
    32, // output: 32 bytes for AES-256
  );
}

// Encrypt wallet secret
function encryptWalletSecret(
  secret: string,
  walletId: string,
): { ciphertext: string; iv: string; tag: string } {
  const key = deriveWalletKey(walletId, masterKey);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(secret, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

// Decrypt wallet secret (verify tag for authenticity)
function decryptWalletSecret(
  encrypted: { ciphertext: string; iv: string; tag: string },
  walletId: string,
): string {
  const key = deriveWalletKey(walletId, masterKey);
  const iv = Buffer.from(encrypted.iv, "hex");
  const tag = Buffer.from(encrypted.tag, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);

  decipher.setAuthTag(tag); // Verify authenticity

  let decrypted = decipher.update(encrypted.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8"); // Throws if tag is invalid

  return decrypted;
}
```

**Master key storage**:

- Environment variable: `ENCRYPTION_KEY` (recommended for local dev, container deployments)
- Kubernetes Secret: mounted as `/etc/secrets/encryption_key.txt` in production
- Optional: Protect `ENCRYPTION_KEY` itself with AWS Secrets Manager or HashiCorp Vault

## Consequences

### Positive

1. **Performance**: <1ms per encrypt/decrypt call; no external network dependency.
2. **Availability**: Wallet operations proceed even if external KMS is unavailable.
3. **Scalability**: Encryption is CPU-local; horizontal scaling doesn't require KMS coordination.
4. **Authenticity**: AES-256-GCM provides both confidentiality and integrity verification.
5. **Simplicity**: No complex IAM, credential rotation, or service-to-service auth overhead.
6. **Cost**: No per-operation KMS charges.

### Negative

1. **Key Protection**: Master key security depends on environment/infrastructure controls (no HSM by default).
2. **Key Rotation**: If master key is compromised, all derived keys are compromised; rotation is non-trivial.
3. **Audit Trail**: No built-in KMS audit log; team must rely on application logs for compliance audits.
4. **Key Backup**: Master key must be backed up securely; loss means permanent data loss.
5. **Multi-Region**: Each region must use the same master key if wallets are shared; complicates key distribution.

## Links

- Related: [ADR 0005: Deterministic Keypair Derivation](./0005-deterministic-keypair-derivation.md) — similar deterministic derivation pattern
- Reference: [Secrets Management](../secrets-management.md)
- Reference: [NIST AEAD Recommendations](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- Reference: [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
