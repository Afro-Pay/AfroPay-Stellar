-- Migration: add_wallet_envelope_encryption
-- Adds encryptedDek and kmsKeyId to Wallet for KMS-backed envelope encryption.

ALTER TABLE "Wallet"
ADD COLUMN "encryptedDek" TEXT;

ALTER TABLE "Wallet"
ADD COLUMN "kmsKeyId" TEXT;
