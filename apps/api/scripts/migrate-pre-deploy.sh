#!/bin/sh
# Runs in the pre-deploy migration Job, before the new API/worker pods start.
#
# Applies every pending "safe" (additive, backward-compatible) migration.
# If a "breaking" migration is pending, its folder — and any pending
# migration folder after it — is moved out of prisma/migrations for the
# duration of this run, so `prisma migrate deploy` cannot see or apply it.
# It is moved back before this script exits, success or failure, so the
# repo checkout is left untouched for the post-deploy Job.
#
# See docs/zero-downtime-migrations.md for the full design.
set -eu

cd "$(dirname "$0")/.."  # apps/api

MIGRATIONS_DIR="prisma/migrations"
DEFER_DIR="${TMPDIR:-/tmp}/prisma-deferred-migrations-$$"

node scripts/migrate-classify.js validate

SAFE="$(node scripts/migrate-classify.js pending-safe)"
DEFER="$(node scripts/migrate-classify.js pending-breaking)"

if [ -z "$DEFER" ]; then
  if [ -z "$SAFE" ]; then
    echo "No pending migrations. Nothing to do."
    exit 0
  fi
  echo "No breaking migration is pending. Applying all pending (safe) migrations:"
  echo "$SAFE"
  npx --yes prisma migrate deploy --schema=prisma/schema.prisma
  exit 0
fi

echo "Deferring breaking migration for the post-deploy job (after old pods drain):"
echo "$DEFER"
mkdir -p "$DEFER_DIR"

restore_deferred() {
  # Move every deferred migration folder back into place, regardless of
  # whether the deploy below succeeded or failed.
  for name in $DEFER; do
    if [ -d "$DEFER_DIR/$name" ]; then
      mv "$DEFER_DIR/$name" "$MIGRATIONS_DIR/$name"
    fi
  done
  rmdir "$DEFER_DIR" 2>/dev/null || true
}
trap restore_deferred EXIT INT TERM

for name in $DEFER; do
  mv "$MIGRATIONS_DIR/$name" "$DEFER_DIR/$name"
done

if [ -z "$SAFE" ]; then
  echo "No safe migrations pending; nothing to apply in this phase."
else
  echo "Applying safe migrations: $SAFE"
  npx --yes prisma migrate deploy --schema=prisma/schema.prisma
fi

echo "Pre-deploy phase complete. Breaking migration(s) will run in the post-deploy job."
