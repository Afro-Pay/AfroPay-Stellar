# Zero-Downtime Prisma Migration Strategy

## Status

Accepted.

## Context

`deploy/kubernetes/migration-job.yaml` used to run `npx prisma migrate deploy`
as a single Kubernetes Job before the new API/worker pods started. That is
safe for purely additive migrations, but unsafe for any migration that
removes, renames, or narrows something the *old* API pods still depend on:
during a rolling update, old and new pods run side by side against the same
database for a period of time, so a destructive migration applied up front
can break the old pods before they are drained.

This document describes the blue/green migration runner that replaces the
single Job, the manifest that classifies each migration, the rollback
runbook, and the dry-run tooling, per the acceptance criteria in
[#206](https://github.com/Afro-Pay/AfroPay-Stellar/issues/206).

## Decision

### 1. Classify every migration as `safe` or `breaking`

[`apps/api/prisma/migrations/migration-manifest.json`](../apps/api/prisma/migrations/migration-manifest.json)
holds one entry per migration folder:

```json
{
  "classifications": {
    "20260624000000_add_wallet_fk_enum_indexes": "safe",
    "20260819000000_add_compliance_anonymization": "safe"
  }
}
```

- **`safe`** — additive and backward compatible while old and new pods run
  side by side: new tables, new nullable columns, new indexes built
  concurrently, widening a column type, adding an enum value used only by
  new code paths.
- **`breaking`** — anything the currently-running old pods would break on:
  dropping/renaming a column or table, tightening a constraint, narrowing a
  type, removing an enum value still written by old code.

[`apps/api/scripts/migrate-classify.js`](../apps/api/scripts/migrate-classify.js)
reads this manifest and enforces, **failing closed**:

- every migration folder on disk has a classification entry (an unclassified
  migration blocks the deploy instead of silently defaulting to safe);
- every `breaking` migration ships a `down.sql` in the same folder;
- **at most one `breaking` migration may be pending at a time, and it must
  be the last pending migration.** Prisma applies pending migrations
  strictly in timestamp order and has no "apply up to X" mode, so if a safe
  migration were pending *after* a breaking one, splitting the pre-deploy
  run would apply it out of order. Practically, this means: land the
  additive ("expand") half of a change and let it deploy and settle first,
  then land the destructive ("contract") half as its own, later migration.
  This is the standard Prisma
  [expand-and-contract](https://www.prisma.io/dataguide/types/relational/expand-and-contract-pattern)
  pattern, already recommended in [docs/deployment.md](deployment.md#database-migrations).

Run `node apps/api/scripts/migrate-classify.js report` at any time to see
every migration's classification and whether it's applied against
`DATABASE_URL`.

### 2. Split the migration Job into pre-deploy and post-deploy phases

- [`deploy/kubernetes/migration-job-pre-deploy.yaml`](../deploy/kubernetes/migration-job-pre-deploy.yaml)
  runs `apps/api/scripts/migrate-pre-deploy.sh` **before** the new
  api/rust-worker Deployments are rolled out. It applies every pending
  `safe` migration. If a `breaking` migration is pending, that migration's
  folder is moved out of `prisma/migrations` for the duration of the run (so
  `prisma migrate deploy` cannot see or apply it) and moved back before the
  script exits, success or failure.
- [`deploy/kubernetes/migration-job-post-deploy.yaml`](../deploy/kubernetes/migration-job-post-deploy.yaml)
  runs `apps/api/scripts/migrate-post-deploy.sh` **after** the rollout is
  complete and the old pods are confirmed drained
  (`kubectl rollout status deployment/api` /
  `kubectl rollout status deployment/rust-worker`). It applies whatever was
  deferred; it is a no-op if nothing was.

Both scripts call `migrate-classify.js validate` first and exit non-zero on
any manifest problem, so a misclassified or undocumented migration fails the
Job loudly instead of running (or silently skipping) the wrong SQL.

```
 pre-deploy Job          rollout                  post-deploy Job
 (safe migrations) ──▶ (new pods up,      ──▶  (breaking migration,
                        old pods draining)       old pods gone)
```

Deploy sequence (see [deploy/kubernetes/README.md](../deploy/kubernetes/README.md)
for the full `kubectl` commands):

1. Apply `migration-job-pre-deploy.yaml`, wait for completion.
2. Roll out `api.yaml` and `rust-worker.yaml` with the new image tag.
3. Wait for the rollout to finish and old pods to terminate.
4. Apply `migration-job-post-deploy.yaml`, wait for completion.
5. Roll out the frontend if it depends on the new API behavior.

### 3. Migration dry run

[`scripts/migrate-dry-run.sh`](../scripts/migrate-dry-run.sh) prints the
exact SQL `prisma migrate deploy` would run against a target database,
without applying it, using `prisma migrate diff` against a scratch shadow
database:

```bash
DATABASE_URL=postgresql://... \
SHADOW_DATABASE_URL=postgresql://.../throwaway_shadow_db \
  scripts/migrate-dry-run.sh
```

Run this against a staging or a fresh copy of the production schema before
every release that includes a `breaking` migration.

### 4. Rollback runbook

[`scripts/migrate-rollback.sh`](../scripts/migrate-rollback.sh) reverts one
applied migration:

```bash
DATABASE_URL=postgresql://... scripts/migrate-rollback.sh <migration_name>
# or, to roll back the most recently applied migration:
DATABASE_URL=postgresql://... scripts/migrate-rollback.sh
```

It runs the migration's `down.sql` and clears its `_prisma_migrations`
tracking row in a single transaction, so a subsequent `prisma migrate
deploy` re-applies it from scratch. (Prisma's own `migrate resolve
--rolled-back` only accepts migrations in a *failed* state — it exists to
recover from a deploy that errored partway through, not to undo one that
finished successfully, which is the case this script handles.)

This was tested against a local PostgreSQL 16 database seeded with all six
existing migrations: `migrate-rollback.sh` on
`20260819000000_add_compliance_anonymization` dropped the
`AnonymizationTombstone` table and the `name`/`role`/`erasedAt` columns it
added, and a subsequent `prisma migrate deploy` re-applied the migration
cleanly, restoring the schema.

Rollback rules:

- Prefer a forward fix over a database rollback once production traffic has
  written data under the new schema — this script is for pre-traffic
  recovery windows (a breaking migration just landed and something is
  wrong) or for staging rehearsals, not for reverting a schema that has
  already accumulated real writes in the new shape.
- Every `breaking` migration must ship a `down.sql`; `migrate-classify.js
  validate` fails the deploy otherwise.
- Rolling back does not undo anything already committed to the Stellar
  network. See [docs/deployment.md § External settlement rollback](deployment.md#external-settlement-rollback)
  — that section is unchanged by this work.

### 5. Fixed while implementing this: pinned Prisma CLI version at runtime

The `deps` build stage in `apps/api/Dockerfile` ran
`npm ci --omit=dev`, which drops `prisma` because it lived in
`devDependencies` — only `@prisma/client` (a regular dependency) was
installed. `npx prisma migrate deploy` in the migration Job therefore had no
local CLI to resolve and silently fetched the *latest* Prisma CLI from the
registry at deploy time. That CLI (major version 7 at the time of writing)
rejects this project's Prisma 5-style `schema.prisma`
(`url = env("DATABASE_URL")` in the `datasource` block), so every migration
Job run through a `--omit=dev` image would have failed outright — including
this feature's own pre-deploy/post-deploy Jobs. `prisma` now lives in
`dependencies` in `apps/api/package.json`, so `npm ci --omit=dev` installs
the pinned 5.x CLI and `npx prisma` resolves it locally, deterministically,
and without a network call at deploy time.

## Consequences

- Deploys with only `safe` migrations behave exactly as before (single Job,
  now named `migration-job-pre-deploy`), just gated one step earlier.
- Deploys with a `breaking` migration take two Jobs and require the
  operator (or CI/CD pipeline) to wait for the rollout to finish and pods to
  drain between them, per the sequence above.
- Two breaking migrations can't be in flight at once; a second one queues
  behind the first until it ships and the post-deploy Job for it runs.
- `docs/deployment.md` § Database Migrations is superseded for the
  "deploy a migration" step by the sequence above; its migration *rules*
  (expand-and-contract, no `migrate dev` in production, no per-pod startup
  migrations) still apply and this design builds directly on them.
