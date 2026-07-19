-- Migration: add_wallet_fk_enum_indexes
-- Adds TransactionStatus enum, walletId FK on Transaction,
-- unique constraint on stellarTxHash, cascade/restrict delete rules,
-- and composite indexes for history queries.

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'RETRYING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id"        TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "password"  TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "publicKey"       TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "walletId"      TEXT NOT NULL,
    "destination"   TEXT NOT NULL,
    "amount"        TEXT NOT NULL,
    "assetCode"     TEXT NOT NULL,
    "assetIssuer"   TEXT,
    "memo"          TEXT,
    "status"        "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "stellarTxHash" TEXT,
    "riskScore"     DOUBLE PRECISION,
    "flagged"       BOOLEAN NOT NULL DEFAULT false,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraints
CREATE UNIQUE INDEX "User_email_key"        ON "User"("email");
CREATE UNIQUE INDEX "Wallet_userId_key"     ON "Wallet"("userId");
CREATE UNIQUE INDEX "Wallet_publicKey_key"  ON "Wallet"("publicKey");
CREATE UNIQUE INDEX "Transaction_stellarTxHash_key" ON "Transaction"("stellarTxHash");

-- CreateIndex: performance indexes for history queries
CREATE INDEX "Transaction_userId_createdAt_idx"   ON "Transaction"("userId", "createdAt" DESC);
CREATE INDEX "Transaction_walletId_createdAt_idx" ON "Transaction"("walletId", "createdAt" DESC);

-- AddForeignKey: Wallet -> User (cascade delete orphaned wallets)
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Transaction -> User (cascade delete user's transactions)
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Transaction -> Wallet (restrict deletion of wallets with transactions)
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
