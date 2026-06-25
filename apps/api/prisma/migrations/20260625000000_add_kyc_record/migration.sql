-- Migration: add_kyc_record
-- Adds KYC enums and KycRecord model for identity verification

-- CreateEnum: KycStatus
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum: KycTier
CREATE TYPE "KycTier" AS ENUM ('NONE', 'BASIC', 'FULL');

-- CreateTable: KycRecord
CREATE TABLE "KycRecord" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "status"          "KycStatus" NOT NULL DEFAULT 'PENDING',
    "tier"            "KycTier" NOT NULL DEFAULT 'NONE',
    "documentType"    TEXT,
    "documentRef"     TEXT,
    "submittedAt"     TIMESTAMP(3),
    "reviewedAt"      TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraint on userId
CREATE UNIQUE INDEX "KycRecord_userId_key" ON "KycRecord"("userId");

-- CreateIndex: performance indexes
CREATE INDEX "KycRecord_userId_idx" ON "KycRecord"("userId");
CREATE INDEX "KycRecord_status_idx" ON "KycRecord"("status");

-- AddForeignKey: KycRecord -> User (cascade delete user's KYC record)
ALTER TABLE "KycRecord" ADD CONSTRAINT "KycRecord_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddColumn: kyc relationship to User (implicit via FK)
