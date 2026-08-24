#!/usr/bin/env bash
# =============================================================================
# AfroPay-Stellar — Prisma Migration Dry Run
# =============================================================================
# Shows the exact SQL that `prisma migrate deploy` would run against a
# target database for every pending migration in apps/api/prisma/migrations,
# without applying anything. Read-only: prisma migrate diff never writes to
# DATABASE_URL or SHADOW_DATABASE_URL.
#
# Usage:
#   DATABASE_URL=postgresql://... \
#   SHADOW_DATABASE_URL=postgresql://... \
#     scripts/migrate-dry-run.sh
#
# SHADOW_DATABASE_URL must point at an empty (or throwaway) database on the
# same server — Prisma replays the migration history there to compute the
# diff. Never point it at a database with real data.
#
# See docs/zero-downtime-migrations.md for how this fits into the deploy
# sequence.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$SCRIPT_DIR/../apps/api"

: "${DATABASE_URL:?DATABASE_URL must be set to the target database to diff against}"
: "${SHADOW_DATABASE_URL:?SHADOW_DATABASE_URL must be set to an empty scratch database on the same server}"

cd "$API_DIR"

node scripts/migrate-classify.js report

echo
echo "SQL that 'prisma migrate deploy' would run (nothing has been applied):"
echo "-------------------------------------------------------------------"
npx --yes prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-migrations prisma/migrations \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --script
