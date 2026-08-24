#!/usr/bin/env node
/**
 * Reads apps/api/prisma/migrations/migration-manifest.json and the actual
 * migrations on disk, cross-references them against `prisma migrate status`,
 * and answers the questions the pre-deploy/post-deploy Kubernetes Jobs need:
 *
 *   - which pending migrations are safe to run before the new pods start
 *   - which pending migration(s) must wait until old pods are drained
 *
 * See docs/zero-downtime-migrations.md for the classification rules this
 * script enforces.
 *
 * Usage:
 *   node migrate-classify.js validate          # manifest completeness/consistency check only
 *   node migrate-classify.js pending-safe       # one migration folder name per line
 *   node migrate-classify.js pending-breaking   # one migration folder name per line
 *   node migrate-classify.js report             # human-readable table of every migration
 *
 * Env overrides (mainly for tests): MIGRATE_CLASSIFY_MIGRATIONS_DIR,
 * MIGRATE_CLASSIFY_MANIFEST, MIGRATE_CLASSIFY_SCHEMA
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API_ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR =
  process.env.MIGRATE_CLASSIFY_MIGRATIONS_DIR || path.join(API_ROOT, 'prisma', 'migrations');
const MANIFEST_PATH =
  process.env.MIGRATE_CLASSIFY_MANIFEST || path.join(MIGRATIONS_DIR, 'migration-manifest.json');
const SCHEMA_PATH =
  process.env.MIGRATE_CLASSIFY_SCHEMA || path.join(API_ROOT, 'prisma', 'schema.prisma');

const VALID_CLASSIFICATIONS = new Set(['safe', 'breaking']);
const MIGRATION_NAME_RE = /^\d{14}_/;

function loadManifest() {
  let raw;
  try {
    raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  } catch (err) {
    fail(`Could not read manifest at ${MANIFEST_PATH}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`Manifest at ${MANIFEST_PATH} is not valid JSON: ${err.message}`);
  }
}

function listMigrationFolders() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && MIGRATION_NAME_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function classify(manifest, name) {
  const table = manifest.classifications || {};
  return table[name];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function validate(manifest, allNames) {
  const missing = allNames.filter((n) => classify(manifest, n) === undefined);
  if (missing.length) {
    console.error('The following migrations have no entry in migration-manifest.json:');
    missing.forEach((n) => console.error(`  - ${n}`));
    console.error('Add each one under "classifications" as "safe" or "breaking" before deploying.');
    process.exit(1);
  }

  const invalid = allNames.filter((n) => !VALID_CLASSIFICATIONS.has(classify(manifest, n)));
  if (invalid.length) {
    console.error('The following migrations have an invalid classification (expected "safe" or "breaking"):');
    invalid.forEach((n) => console.error(`  - ${n}: "${classify(manifest, n)}"`));
    process.exit(1);
  }

  const missingDownSql = allNames.filter((n) => {
    if (classify(manifest, n) !== 'breaking') return false;
    return !fs.existsSync(path.join(MIGRATIONS_DIR, n, 'down.sql'));
  });
  if (missingDownSql.length) {
    console.error('The following "breaking" migrations have no down.sql rollback script:');
    missingDownSql.forEach((n) => console.error(`  - ${n}`));
    console.error('Every breaking migration must ship a down.sql. See scripts/migrate-rollback.sh.');
    process.exit(1);
  }
}

/**
 * Runs `prisma migrate status` and returns the list of migration folder
 * names that have not yet been applied to the target database. Returns []
 * when the schema is fully up to date. Throws for any other failure
 * (connection error, drift, etc.) so callers do not silently proceed.
 */
function getPendingMigrations() {
  let output;
  let failed = false;
  let status;
  try {
    output = execFileSync('npx', ['--yes', 'prisma', 'migrate', 'status', '--schema', SCHEMA_PATH], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    failed = true;
    status = err.status;
    output = `${err.stdout || ''}${err.stderr || ''}`;
  }

  // Rather than matching the exact "Following migration(s) have not yet been
  // applied:" header (Prisma switches between singular/plural wording
  // depending on the count), scan every line of output for the migration
  // folder name pattern. Folder names are timestamp-prefixed
  // (`YYYYMMDDHHMMSS_name`) and won't collide with any other line Prisma
  // prints, so this is robust across CLI wording/version changes.
  const names = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => MIGRATION_NAME_RE.test(line));

  if (failed && names.length === 0) {
    // A real failure unrelated to pending migrations (auth/connection error,
    // schema drift, etc.) - surface it instead of silently proceeding as if
    // the database were up to date.
    process.stderr.write(output);
    throw new Error(`prisma migrate status failed unexpectedly (exit ${status})`);
  }

  return names;
}

/**
 * Splits the pending migrations into an "apply" list (safe migrations that
 * may run before the new pods start) and a "defer" list (must wait for the
 * post-deploy phase). Enforces the "at most one breaking migration pending,
 * and it must be last" rule from docs/zero-downtime-migrations.md.
 */
function planPreDeploy(manifest) {
  const allNames = listMigrationFolders();
  validate(manifest, allNames);

  const pendingSet = new Set(getPendingMigrations());
  const orderedPending = allNames.filter((n) => pendingSet.has(n));

  const firstBreakingIdx = orderedPending.findIndex((n) => classify(manifest, n) === 'breaking');
  if (firstBreakingIdx === -1) {
    return { apply: orderedPending, defer: [] };
  }

  const apply = orderedPending.slice(0, firstBreakingIdx);
  const defer = orderedPending.slice(firstBreakingIdx);

  if (defer.length > 1) {
    console.error('More than one pending migration follows (or is) a "breaking" migration:');
    defer.forEach((n) => console.error(`  - ${n} (${classify(manifest, n)})`));
    console.error(
      'At most one breaking migration may be pending, and it must be the last pending migration. ' +
        'See docs/zero-downtime-migrations.md.'
    );
    process.exit(1);
  }

  return { apply, defer };
}

function main() {
  const manifest = loadManifest();
  const cmd = process.argv[2];

  switch (cmd) {
    case 'validate': {
      validate(manifest, listMigrationFolders());
      console.log('OK: migration-manifest.json is complete and consistent.');
      break;
    }
    case 'pending-safe': {
      const { apply } = planPreDeploy(manifest);
      apply.forEach((n) => console.log(n));
      break;
    }
    case 'pending-breaking': {
      const { defer } = planPreDeploy(manifest);
      defer.forEach((n) => console.log(n));
      break;
    }
    case 'report': {
      const allNames = listMigrationFolders();
      validate(manifest, allNames);
      const pendingSet = new Set(getPendingMigrations());
      for (const n of allNames) {
        const state = pendingSet.has(n) ? 'pending' : 'applied';
        console.log(`${n}\t${classify(manifest, n)}\t${state}`);
      }
      break;
    }
    default: {
      console.error('Usage: migrate-classify.js <validate|pending-safe|pending-breaking|report>');
      process.exit(2);
    }
  }
}

main();
