-- Additive liquidity rebalancing tables.
CREATE TYPE "LiquidityRebalanceStatus" AS ENUM (
  'PLANNED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
  'SKIPPED'
);

CREATE TABLE "LiquidityObservation" (
  "id" TEXT NOT NULL,
  "corridor" TEXT NOT NULL,
  "reserveAsset" TEXT NOT NULL,
  "reserveAmount" DECIMAL(30,7) NOT NULL,
  "forecastedWeeklyDemand" DECIMAL(30,7) NOT NULL,
  "thresholdAmount" DECIMAL(30,7) NOT NULL,
  "source" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "LiquidityObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiquidityObservation_corridor_observedAt_idx"
  ON "LiquidityObservation"("corridor", "observedAt" DESC);
CREATE INDEX "LiquidityObservation_reserveAsset_observedAt_idx"
  ON "LiquidityObservation"("reserveAsset", "observedAt" DESC);

ALTER TABLE "LiquidityObservation"
  ADD CONSTRAINT "LiquidityObservation_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LiquidityRebalance" (
  "id" TEXT NOT NULL,
  "corridor" TEXT NOT NULL,
  "fromAsset" TEXT NOT NULL,
  "toAsset" TEXT NOT NULL,
  "sourceAmount" DECIMAL(30,7) NOT NULL,
  "amount" DECIMAL(30,7) NOT NULL,
  "status" "LiquidityRebalanceStatus" NOT NULL DEFAULT 'PLANNED',
  "reason" TEXT NOT NULL,
  "txHash" TEXT,
  "failureReason" TEXT,
  "requestedBy" TEXT,
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiquidityRebalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiquidityRebalance_txHash_key" ON "LiquidityRebalance"("txHash");
CREATE INDEX "LiquidityRebalance_corridor_createdAt_idx"
  ON "LiquidityRebalance"("corridor", "createdAt" DESC);
CREATE INDEX "LiquidityRebalance_status_idx" ON "LiquidityRebalance"("status");

ALTER TABLE "LiquidityRebalance"
  ADD CONSTRAINT "LiquidityRebalance_requestedBy_fkey"
  FOREIGN KEY ("requestedBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
