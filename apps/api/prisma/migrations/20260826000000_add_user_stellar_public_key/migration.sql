-- Migration: add_user_stellar_public_key
-- Adds the optional stellarPublicKey field to the User table to support
-- SEP-10 cryptographic authentication alongside the existing email/password flow.
-- The column is nullable (users who have not completed SEP-10 auth have NULL here)
-- and carries a unique index because each Stellar public key maps to at most one user.

ALTER TABLE "User"
  ADD COLUMN "stellarPublicKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_stellarPublicKey_key"
  ON "User" ("stellarPublicKey");
