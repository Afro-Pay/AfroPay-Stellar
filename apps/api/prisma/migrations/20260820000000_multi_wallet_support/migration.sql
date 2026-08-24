-- Remove the unique constraint on userId to allow multiple wallets per user
ALTER TABLE "Wallet" DROP CONSTRAINT "Wallet_userId_key";

-- Add alias column (optional, max 32 chars)
ALTER TABLE "Wallet" ADD COLUMN "alias" TEXT;

-- Add isDefault column to track the active/default wallet
ALTER TABLE "Wallet" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Create a composite unique constraint on (userId, alias)
-- This ensures that within a user's wallets, aliases are unique (nulls are allowed)
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_alias_key" UNIQUE ("userId", "alias");

-- Create an index for efficient queries on (userId, isDefault)
CREATE INDEX "Wallet_userId_isDefault_idx" ON "Wallet"("userId", "isDefault");
