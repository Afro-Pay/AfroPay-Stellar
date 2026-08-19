-- Roles are embedded in admin JWTs and enforced by the admin guard.
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

ALTER TABLE "User"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN "erasedAt" TIMESTAMP(3);

-- The original identifier is represented only by a one-way SHA-256 digest.
-- This permits repeat erasure requests without retaining the identifier itself.
CREATE TABLE "AnonymizationTombstone" (
  "id" TEXT NOT NULL,
  "originalUserIdHash" TEXT NOT NULL,
  "pseudonymousUserId" TEXT NOT NULL,
  "erasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnonymizationTombstone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnonymizationTombstone_originalUserIdHash_key"
  ON "AnonymizationTombstone"("originalUserIdHash");
CREATE UNIQUE INDEX "AnonymizationTombstone_pseudonymousUserId_key"
  ON "AnonymizationTombstone"("pseudonymousUserId");
CREATE INDEX "AnonymizationTombstone_erasedAt_idx"
  ON "AnonymizationTombstone"("erasedAt");
