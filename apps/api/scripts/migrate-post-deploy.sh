#!/bin/sh
# Runs in the post-deploy migration Job, only after the old API/worker pods
# have been fully drained (no pod still running the previous schema
# assumptions). Applies any remaining pending migrations, which by
# convention (enforced by scripts/migrate-classify.js) is at most one
# "breaking" migration.
#
# See docs/zero-downtime-migrations.md for the full design.
set -eu

cd "$(dirname "$0")/.."  # apps/api

node scripts/migrate-classify.js validate

BREAKING="$(node scripts/migrate-classify.js pending-breaking)"

if [ -z "$BREAKING" ]; then
  echo "No breaking migration is pending. Nothing to do."
  exit 0
fi

echo "Old pods are assumed drained. Applying deferred breaking migration(s):"
echo "$BREAKING"
npx --yes prisma migrate deploy --schema=prisma/schema.prisma

echo "Post-deploy phase complete."
