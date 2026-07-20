-- Migration: add_transaction_idempotency_key
-- Adds an optional client-supplied idempotency key to Transaction and a unique
-- constraint on (userId, idempotencyKey) so a retried POST /transactions/send
-- cannot create a duplicate transfer (DB-level second line of defence behind
-- the Redis idempotency cache).

-- AddColumn
ALTER TABLE "Transaction" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex: unique per (user, key). Postgres treats NULLs as distinct, so
-- existing rows and requests without an Idempotency-Key header are unaffected.
CREATE UNIQUE INDEX "Transaction_userId_idempotencyKey_key"
    ON "Transaction"("userId", "idempotencyKey");
