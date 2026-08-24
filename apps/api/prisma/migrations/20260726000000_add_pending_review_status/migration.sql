-- Migration: add_pending_review_status
-- Adds the PENDING_REVIEW value to the TransactionStatus enum.
-- Transactions in this state have passed the fraud check but scored in the
-- medium-risk band (0.5 ≤ riskScore < 0.8) and are held for manual review
-- before any Stellar submission occurs.
--
-- NOTE: The REVIEW value that was present in schema.prisma was never applied
-- to the database via a migration, so this migration goes straight to
-- PENDING_REVIEW without a rename step.

ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
