# Security Design for Wallet Key Encryption

## Goal
Private wallet secret keys must be protected at rest using per-wallet envelope encryption to avoid a single master key compromise exposing all wallets.

## Approach
- Each wallet stores the Stellar secret key encrypted with a unique data encryption key (DEK).
- Each DEK is encrypted with AWS KMS and stored as `encryptedDek` in the database.
- The wallet row also stores `kmsKeyId` so the KMS key context is preserved.
- When KMS is configured (`KMS_KEY_ID` + `AWS_REGION`), new wallet secrets use envelope encryption.
- Legacy secrets encrypted with `ENCRYPTION_KEY` remain decryptable and are transparently re-encrypted to KMS on first read.

## Data stored per wallet
- `encryptedSecret` — AES-256-GCM ciphertext of the wallet seed.
- `encryptedDek` — base64-encoded KMS ciphertext blob protecting the per-wallet DEK.
- `kmsKeyId` — KMS key identifier used for DEK encryption.

## Key rotation
- KMS key rotation is handled transparently by AWS when the same `KMS_KEY_ID` is used.
- Existing legacy secrets are migrated on first access without downtime.
- To rotate the KMS key ID, update `KMS_KEY_ID` and reprocess wallets by reading/decrypting and re-encrypting each row.

## Secrets and runtime configuration
- `KMS_KEY_ID` and `AWS_REGION` are required together when using KMS.
- `ENCRYPTION_KEY` remains optional for environments that do not yet use KMS.
- No raw private keys are logged by the wallet service.

## Validation
- The API validates that either `KMS_KEY_ID` or `ENCRYPTION_KEY` is present.
- If only KMS is configured, `ENCRYPTION_KEY` is not required.
- Legacy AES-encrypted wallets still work and are migrated when decrypted.
