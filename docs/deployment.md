# Production Deployment Guide

This guide describes a production-ready deployment shape for AfroPay-Stellar and the exact build, configuration, migration, and rollback practices to use when promoting the application from staging to production.

## Service Inventory

AfroPay-Stellar is deployed as four application containers plus managed data services:

| Component | Source path | Runtime | Required dependencies |
| --- | --- | --- | --- |
| Frontend | `apps/frontend` | Next.js on Node.js 20 | Public API URL |
| API | `apps/api` | NestJS on Node.js 20 | PostgreSQL, Redis, Stellar Horizon, JWT and wallet encryption secrets |
| Rust worker | `services/rust-worker` | Rust release binary | Redis, Stellar Horizon |
| Fraud service | `services/python-analytics` | FastAPI/Uvicorn on Python 3.12 | None required by the current container, but keep network access restricted to trusted callers |
| PostgreSQL | Managed PostgreSQL 16 or later | Database | Encrypted storage, backups, migration access |
| Redis | Managed Redis 7 or later | Queue/cache | TLS or private-network access, persistence appropriate for queue recovery |

The repository `docker-compose.yml` is suitable for local integration checks. For production, prefer managed PostgreSQL and Redis, a private container network, and an orchestrator such as Kubernetes, ECS/Fargate, Nomad, or a comparable platform that supports rolling deployments, health checks, autoscaling, and secrets injection.

## Recommended Production Infrastructure

Use separate infrastructure for staging and production. Do not share databases, Redis instances, Stellar accounts, JWT secrets, wallet encryption keys, or anchor credentials between environments.

### Network layout

- Put the frontend behind a CDN or edge load balancer with HTTPS enabled.
- Put the API behind an HTTPS application load balancer or ingress controller.
- Keep PostgreSQL, Redis, the Rust worker, and the fraud service on private subnets or private service networking.
- Allow the API to reach PostgreSQL, Redis, Stellar Horizon, configured anchor URLs, and the fraud service if fraud scoring is called synchronously.
- Allow the Rust worker to reach Redis and Stellar Horizon.
- Deny public inbound traffic to PostgreSQL, Redis, and the Rust worker.

### Compute and scaling

- Run at least two API replicas in production so rolling deployments and node failures do not take the API offline.
- Run at least two frontend replicas unless the frontend is deployed to a managed Next.js platform that handles redundancy.
- Run Rust worker replicas according to Redis queue throughput. Start with one or two workers and scale horizontally only after verifying job idempotency and duplicate-processing behavior for settlement jobs.
- Run the fraud service with at least two replicas if it is part of the user-facing request path; otherwise one replica may be acceptable for asynchronous analytics.
- Configure CPU and memory requests/limits for every container, and set restart policies equivalent to `unless-stopped` or `always`.

### Data services

- Use managed PostgreSQL 16+ with automated backups, point-in-time recovery, encryption at rest, and a tested restore procedure.
- Use managed Redis 7+ with private networking. Enable TLS and authentication where supported.
- Size PostgreSQL for transaction history growth and index migration headroom.
- Keep database migration execution as a single controlled job, not as a side effect of every API container start.

### Health checks and observability

- The compose file references `/health` for the API and fraud service. Before enforcing those checks in production, verify that each service exposes the route or configure the orchestrator to probe a route that exists.
- Collect structured application logs from all containers. The local compose file rotates JSON logs; in production, ship logs to a centralized backend.
- Track API latency/error rate, queue depth, worker failures, Redis availability, PostgreSQL connections/query latency, Stellar submission failures, and fraud service errors.
- Expose the Rust worker metrics port with `METRICS_PORT` only on the private monitoring network if metrics scraping is enabled.

## Docker Image Build and Publish Steps

Build immutable images from a clean checkout and tag each image with the Git SHA. Do not deploy `latest` to production.

```bash
export REGISTRY=registry.example.com/afropay-stellar
export GIT_SHA=$(git rev-parse --short=12 HEAD)

docker build -t "$REGISTRY/api:$GIT_SHA" apps/api
docker build -t "$REGISTRY/frontend:$GIT_SHA" apps/frontend
docker build -t "$REGISTRY/rust-worker:$GIT_SHA" services/rust-worker
docker build -t "$REGISTRY/fraud-service:$GIT_SHA" services/python-analytics

docker push "$REGISTRY/api:$GIT_SHA"
docker push "$REGISTRY/frontend:$GIT_SHA"
docker push "$REGISTRY/rust-worker:$GIT_SHA"
docker push "$REGISTRY/fraud-service:$GIT_SHA"
```

Recommended build pipeline checks before publishing:

```bash
cd apps/api && npm ci && npm run build && npm test
cd ../../apps/frontend && npm ci && npm run build
cd ../../services/python-analytics && python -m pip install -r requirements.txt && pytest
cd ../rust-worker && cargo test && cargo build --release
```

If your CI builds from the repository root, run each command in a separate job or reset the working directory between commands.

## Environment Configuration

Configure each deployed service with only the variables it needs.

### API (`apps/api`)

| Variable | Production guidance |
| --- | --- |
| `PORT` | Container listen port. Defaults to `3001`; keep aligned with service and load-balancer target port. |
| `DATABASE_URL` | PostgreSQL connection string for the environment. Use TLS and a least-privileged application role. |
| `REDIS_URL` | Private Redis URL. Use TLS/authentication where the provider supports it. |
| `JWT_SECRET` | High-entropy signing secret from the secret manager. Rotate through a planned token-expiry window. |
| `ENCRYPTION_KEY` | 64-character hex key used for 32-byte wallet-key encryption. Treat as critical key material and never regenerate without a migration/re-encryption plan. |
| `STELLAR_NETWORK` | `mainnet` for production, `testnet` for staging and local development. |
| `STELLAR_HORIZON_URL` | Mainnet Horizon endpoint for production; testnet Horizon endpoint for staging. |
| `ANCHOR_USDC_URL` | Production USDC anchor URL in production; sandbox/test anchor in staging. |
| `ANCHOR_NGN_URL` | Production NGN anchor URL in production; sandbox/test anchor in staging. |

### Frontend (`apps/frontend`)

| Variable | Production guidance |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Public HTTPS URL for the API, for example `https://api.example.com`. Because this is embedded into the browser bundle, it is configuration rather than a secret. |

### Rust worker (`services/rust-worker`)

| Variable | Production guidance |
| --- | --- |
| `REDIS_URL` | Same queue Redis used by the API, delivered through the secret manager. |
| `STELLAR_HORIZON_URL` | Same production or staging Horizon URL used by the API. |
| `METRICS_PORT` | Optional private metrics listener port. Defaults to `9100` in the worker code. |

### Fraud service (`services/python-analytics`)

The current Dockerfile starts Uvicorn on port `8000`. Add environment variables here as the service grows, but keep credentials in the secret manager and expose the service only to trusted private callers unless a public API is intentionally added.

## Secure Secret Management

- Store `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, anchor credentials, and any Stellar signing material in a managed secret store such as AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, Doppler, Vault, or sealed Kubernetes secrets backed by cloud KMS.
- Inject secrets at runtime as environment variables or mounted secret files. Never bake secrets into Docker images, commit them to the repository, or put production values in `docker-compose.yml`.
- Generate `JWT_SECRET` with at least 256 bits of entropy.
- Generate `ENCRYPTION_KEY` as exactly 32 random bytes encoded as 64 lowercase or uppercase hexadecimal characters, for example with `openssl rand -hex 32`.
- Restrict who can read production secrets. CI/CD should receive deploy-only access, and developers should use staging credentials by default.
- Rotate secrets on a documented schedule and immediately after suspected exposure. For `ENCRYPTION_KEY`, rotation requires a wallet-key re-encryption procedure because existing encrypted wallet data depends on the old key.
- Avoid logging environment variables, database URLs, bearer tokens, wallet secrets, or Stellar private keys.

## Database Migrations

Prisma uses `apps/api/prisma/schema.prisma` and reads `DATABASE_URL` from the environment. Run migrations before shifting user traffic to a new API version.

Recommended production sequence:

1. Take or verify a recent PostgreSQL backup and confirm point-in-time recovery is enabled.
2. Deploy a one-off migration job using the same API image tag that will be promoted.
3. Run:

   ```bash
   cd apps/api
   npx prisma migrate deploy
   ```

4. Confirm the migration job completed successfully and inspect application logs for schema-related errors.
5. Roll out API containers using the same image tag.
6. Roll out workers after the API when queue payloads or settlement behavior changed.
7. Roll out the frontend last when it depends on new API behavior.

Migration rules:

- Keep migrations backward compatible for rolling deployments. Prefer expand-and-contract changes: add nullable columns or new tables first, deploy code that writes both old and new shapes if needed, backfill data, then remove old columns in a later release.
- Do not run `prisma migrate dev` against staging or production; it is intended for development workflows.
- Do not let every API replica run migrations on startup, because concurrent migration attempts can fail or lock the database during deployment.
- For destructive migrations, rehearse the migration and rollback on staging using production-like data volume.

## Staging Versus Production

| Area | Staging | Production |
| --- | --- | --- |
| Stellar network | `testnet` with `https://horizon-testnet.stellar.org` | `mainnet` with a production Horizon provider or self-hosted Horizon |
| Anchors | Sandbox/test anchors such as the test anchor URL used by local compose | Approved production anchor endpoints and credentials |
| Data | Synthetic or anonymized data | Real customer and settlement data with retention and compliance controls |
| Secrets | Separate staging secrets; lower blast radius | Separate production secrets; strict access and audit logging |
| Scaling | Smaller replicas and database sizes are acceptable | Redundant API/frontend replicas, production database sizing, monitored worker capacity |
| Release policy | Can receive release candidates and migration rehearsals | Only deploy artifacts that passed CI, staging smoke tests, and migration validation |
| Observability | Validate dashboards, alerts, and runbooks | Page on critical API, queue, database, Redis, and settlement failures |

Promotion flow:

1. Build and push images tagged with the Git SHA.
2. Deploy the same image tags to staging.
3. Run staging migrations with `npx prisma migrate deploy`.
4. Run smoke tests for login, wallet retrieval, transfer simulation, anchor routes, queue processing, and fraud-service availability.
5. Promote the same image tags to production after approval.

## Rollback Considerations

Use image tags and migration discipline that make rollback predictable.

### Application rollback

- Keep the previous known-good image tag for each service.
- If a deployment fails before migrations, roll back by redeploying the previous image tags.
- If the frontend fails but the API is healthy, roll back only the frontend image.
- If worker failures cause settlement issues, pause or scale down the worker deployment first to stop new on-chain submissions, then redeploy the previous worker image after confirming queue state.
- If API failures are severe, shift traffic back to the previous API image and keep workers compatible with the queue payload version still in Redis.

### Database rollback

- Prefer forward fixes over database rollbacks once production traffic has written data with the new schema.
- For backward-compatible migrations, application rollback should not require database rollback.
- For destructive or data-transforming migrations, define the restore plan before deployment: snapshot restore, point-in-time recovery, or a written down-migration/backfill reversal.
- Never restore production from backup without deciding how to reconcile payments or Stellar transactions that may already have settled externally.

### External settlement rollback

Stellar transactions are externally visible and generally cannot be undone by redeploying code. Treat rollback as an operational recovery process:

- Stop affected workers to prevent additional submissions.
- Preserve queue messages, worker logs, Horizon transaction hashes, and API audit records.
- Reconcile pending, failed, and submitted transfers before retrying jobs.
- Communicate clearly with operations/compliance teams before manual corrections or compensating transactions.

## Production Readiness Checklist

- [ ] Images are built from a clean commit and tagged with the Git SHA.
- [ ] CI passed API tests/build, frontend build, Python tests, and Rust tests/build.
- [ ] Secrets are present in the secret manager and not stored in image layers or source control.
- [ ] `ENCRYPTION_KEY` is a 64-character hex string and is backed up securely.
- [ ] PostgreSQL backup/PITR is enabled and a restore has been tested.
- [ ] Migrations were run once with `npx prisma migrate deploy`.
- [ ] API and frontend health checks target real routes.
- [ ] Staging smoke tests passed with the same image tags intended for production.
- [ ] Rollback image tags and database recovery steps are documented for the release.
