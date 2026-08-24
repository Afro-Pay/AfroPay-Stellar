# Delegated Wallet Signing Design

## Decision

Wallet transaction signing must occur outside the NestJS API process. The API
may construct unsigned transaction XDR and authorize a request, but it must not
read `encryptedSecret`, `encryptedDek`, a plaintext data-encryption key, or a
Stellar secret seed during signing.

This change introduces a proof-of-concept signer contract at `POST /v1/sign`.
`VaultService.signTransaction()` selects only the wallet ID and public key,
sends unsigned XDR to that contract, and accepts a result only when the returned
signer public key matches the expected wallet public key.

## Signer contract

The API sends:

```json
{
  "requestId": "uuid",
  "walletId": "opaque-wallet-id",
  "expectedPublicKey": "G...",
  "unsignedTransactionXdr": "AAAA...",
  "network": "testnet"
}
```

The signer returns:

```json
{
  "requestId": "same-uuid",
  "signerPublicKey": "G...",
  "signedTransactionXdr": "AAAA..."
}
```

Production transport must use mTLS or service-mesh workload identity in
addition to the bearer credential represented by `SIGNER_AUTH_TOKEN` in this
proof of concept. The signer independently validates the network, transaction
hash, source, destination, amount, asset, memo, expiry, and wallet identity. It
rejects replayed request IDs and never returns key material.

## Approach A: Vault Transit sidecar

Import or generate each wallet's Ed25519 key in Vault Transit. A Vault Agent
sidecar authenticates with pod workload identity and proxies signing requests.
NestJS sends the transaction signature base; Vault returns only the signature.

- Neither NestJS nor an application worker receives a plaintext DEK or seed.
- Vault policy can restrict an identity to `transit/sign/wallet-{id}`.
- Vault supplies centralized audit records, key versioning, and revocation.
- API compromise permits policy-authorized signing until identity revocation,
  but does not permit key export.
- Vault availability, policy correctness, imported-key backup, and recovery
  become transaction-path operational concerns.

This is the preferred end state when removing plaintext DEKs from every
application process is the primary objective.

## Approach B: Rust worker delegation

NestJS publishes an unsigned, authorized job containing a wallet identifier and
transaction XDR. The Rust worker retrieves the wallet envelope, calls KMS to
unwrap its DEK, decrypts the seed, signs, zeroizes temporary buffers, and submits
or returns the signed XDR.

- NestJS memory never contains the plaintext DEK or seed.
- Existing queue isolation, Stellar code, and worker scaling can be reused.
- The plaintext DEK and seed still exist briefly in worker memory; a worker
  memory dump remains in scope.
- The worker requires narrow database/KMS permissions and becomes a higher
  value target. Queue authentication, integrity, replay protection, and strict
  transaction validation are mandatory.
- Rust `zeroize`, disabled core dumps, non-swappable memory where available,
  and one-job-per-process isolation reduce but cannot eliminate exposure.

This is a pragmatic intermediate migration. It moves, rather than eliminates,
the plaintext-key trust boundary.

## Comparison

| Property | Vault Transit sidecar | Rust worker delegation |
|---|---|---|
| Plaintext DEK in NestJS | Never | Never |
| Plaintext DEK in application code | Never | Briefly in worker |
| Key export possible | Normally prohibited by policy | Worker can decrypt seed |
| Operational dependency | Vault cluster and agent | Redis, database, KMS, worker |
| Auditability | Vault audit device plus app audit | Application and KMS audit logs |
| Migration complexity | Key import and policy provisioning | Worker envelope implementation |
| Primary blast radius | Vault policy/key scope | Worker IAM and reachable wallets |

## Proof-of-concept flow

1. The authenticated API authorizes the wallet and transaction fields.
2. `WalletService.signTransaction()` forwards unsigned XDR to `VaultService`.
3. `VaultService` queries only `Wallet.id` and `Wallet.publicKey`.
4. It sends an authenticated signer request with a unique request ID and a
   ten-second timeout.
5. It verifies request correlation and the returned signer public key.
6. It returns signed XDR; it never receives a DEK or private key.
7. Missing configuration, network errors, and invalid responses fail closed.

## Production integration plan

1. Implement the contract in Vault Agent/Transit or consolidate the Rust worker
   into one buildable queue/HTTP service.
2. Authenticate services with workload identity and mTLS; rotate the POC bearer
   token automatically.
3. Bind requests to a canonical transaction digest and store request IDs with a
   short TTL to prevent replay.
4. Revalidate source, amount, asset, destination, network, memo, and time bounds
   inside the signer; never trust API validation alone.
5. Remove secret export and legacy local decrypt helpers after wallet migration.
6. For Vault, import keys and destroy old envelope ciphertext only after tested
   signature verification and recovery checkpoints.
7. For Rust, use KMS encryption context with wallet/environment, zeroize
   buffers, disable core dumps, restrict IAM, and isolate worker nodes.
8. Audit request ID, wallet ID, public key, transaction hash, and result only.
   Never log ciphertext, wrapped keys, plaintext keys, seeds, or XDR bodies.

## Rollback

Delegated signing is fail-closed. A signer outage queues or rejects signing; it
must never fall back to decrypting in NestJS. Rollback means switching to
another external implementation of the same contract, not restoring local key
access.
