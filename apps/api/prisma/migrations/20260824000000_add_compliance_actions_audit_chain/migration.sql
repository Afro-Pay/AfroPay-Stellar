-- Migration: add_compliance_actions_audit_chain
-- Adds:
--   1. ComplianceAction + ComplianceApproval tables (multi-sig freeze/clawback actions)
--   2. SHA-256 hash-chain columns on AuditLog for tamper-evident audit logging

-- ── Compliance action lifecycle ─────────────────────────────────────────────
CREATE TYPE "ComplianceActionType" AS ENUM ('FREEZE', 'CLAWBACK');
CREATE TYPE "ComplianceActionStatus" AS ENUM (
  'PENDING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
  'REJECTED'
);

CREATE TABLE "ComplianceAction" (
  "id" TEXT NOT NULL,
  "type" "ComplianceActionType" NOT NULL,
  "status" "ComplianceActionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "targetAccount" TEXT NOT NULL,
  "assetCode" TEXT NOT NULL,
  "assetIssuer" TEXT,
  "amount" TEXT,
  "reason" TEXT,
  "requestedBy" TEXT NOT NULL,
  "txHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplianceAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComplianceAction_status_idx" ON "ComplianceAction"("status");
CREATE INDEX "ComplianceAction_targetAccount_idx" ON "ComplianceAction"("targetAccount");
CREATE INDEX "ComplianceAction_requestedBy_idx" ON "ComplianceAction"("requestedBy");
CREATE INDEX "ComplianceAction_createdAt_idx" ON "ComplianceAction"("createdAt");

CREATE TABLE "ComplianceApproval" (
  "id" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "officerId" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComplianceApproval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComplianceApproval_actionId_officerId_key"
  ON "ComplianceApproval"("actionId", "officerId");
CREATE INDEX "ComplianceApproval_actionId_idx" ON "ComplianceApproval"("actionId");

ALTER TABLE "ComplianceApproval"
  ADD CONSTRAINT "ComplianceApproval_actionId_fkey"
  FOREIGN KEY ("actionId") REFERENCES "ComplianceAction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Tamper-evident audit hash chain ─────────────────────────────────────────
-- Every audit row stores the SHA-256 of the previous row (`previousHash`) and
-- its own `hash` computed over the canonical entry payload + previousHash.
-- Retrofitting any row therefore invalidates every subsequent hash.
ALTER TABLE "AuditLog"
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "hash" TEXT;

CREATE INDEX "AuditLog_previousHash_idx" ON "AuditLog"("previousHash");
