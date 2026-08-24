-- Reverses 20260819000000_add_compliance_anonymization.
-- Used by scripts/migrate-rollback.sh; see docs/zero-downtime-migrations.md.
DROP TABLE IF EXISTS "AnonymizationTombstone";

ALTER TABLE "User"
  DROP COLUMN IF EXISTS "erasedAt",
  DROP COLUMN IF EXISTS "role",
  DROP COLUMN IF EXISTS "name";

DROP TYPE IF EXISTS "UserRole";
