#!/usr/bin/env bash
# =============================================================================
# AfroPay-Stellar — Prisma Migration Rollback
# =============================================================================
# Reverts one applied migration by running its down.sql against DATABASE_URL,
# then clears its row from Prisma's _prisma_migrations tracking table so a
# subsequent `prisma migrate deploy` will re-apply it from scratch.
#
# Only migrations classified "breaking" in
# apps/api/prisma/migrations/migration-manifest.json are required to ship a
# down.sql (see scripts/migrate-classify.js), but any migration with one can
# be rolled back this way.
#
# Usage:
#   DATABASE_URL=postgresql://... scripts/migrate-rollback.sh
#     Rolls back the most recently applied migration.
#
#   DATABASE_URL=postgresql://... scripts/migrate-rollback.sh <migration_name>
#     Rolls back a specific migration by folder name.
#
# Requires: psql, node, npx (prisma CLI resolved from apps/api/node_modules).
#
# This is a destructive, hand-run operational script — not part of the
# pre-deploy/post-deploy Kubernetes Jobs. See docs/zero-downtime-migrations.md
# for the rollback runbook and when to use this versus a forward fix.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$SCRIPT_DIR/../apps/api"
MIGRATIONS_DIR="$API_DIR/prisma/migrations"

: "${DATABASE_URL:?DATABASE_URL must be set to the database to roll back}"

TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  echo "No migration given; looking up the most recently applied migration..."
  TARGET="$(psql "$DATABASE_URL" -Atc \
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1;")"
  if [ -z "$TARGET" ]; then
    echo "No applied, non-rolled-back migration found in _prisma_migrations." >&2
    exit 1
  fi
fi

DOWN_SQL="$MIGRATIONS_DIR/$TARGET/down.sql"

if [ ! -d "$MIGRATIONS_DIR/$TARGET" ]; then
  echo "Error: no migration folder named '$TARGET' under $MIGRATIONS_DIR" >&2
  exit 1
fi

if [ ! -f "$DOWN_SQL" ]; then
  echo "Error: $DOWN_SQL does not exist. This migration has no rollback script." >&2
  exit 1
fi

echo "About to roll back migration: $TARGET"
echo "Running: $DOWN_SQL"
echo "Against: $DATABASE_URL"
if [ -t 0 ] && [ "${MIGRATE_ROLLBACK_YES:-}" != "1" ]; then
  read -r -p "Type the migration name to confirm: " CONFIRM
  if [ "$CONFIRM" != "$TARGET" ]; then
    echo "Confirmation did not match. Aborting." >&2
    exit 1
  fi
fi

# Prisma's own `migrate resolve --rolled-back` only accepts migrations that
# are in a *failed* state (finished_at IS NULL) — it exists to recover a
# deploy that errored partway through, not to undo a migration that finished
# successfully. Since down.sql reverses a completed migration, delete its
# tracking row directly instead, in the same transaction as the schema
# revert, so a future `prisma migrate deploy` will re-apply it from scratch.
echo "Applying down.sql and clearing the _prisma_migrations tracking row in one transaction..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -f "$DOWN_SQL" \
  -c "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '$TARGET';"

echo "Done. '$TARGET' is reverted and no longer recorded as applied."
echo "Re-running 'prisma migrate deploy' will re-apply it from scratch."
