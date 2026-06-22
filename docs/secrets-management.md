# Secrets Management

## Overview

AfroPay-Stellar handles several categories of sensitive values:

| Category | Examples | Risk if exposed |
|---|---|---|
| Database credentials | `DATABASE_URL` | Full data access |
| Cryptographic keys | `JWT_SECRET`, `ENCRYPTION_KEY` | Forged tokens, decrypted wallets |
| API tokens | Stellar anchor credentials | Financial transaction fraud |
| Service URLs with credentials | `REDIS_URL` | Queue/cache manipulation |

Every service **validates required environment variables at startup** and fails immediately if any are missing or malformed. This ensures misconfiguration is caught before any traffic is served.

---

## Required Environment Variables

### API (`apps/api`)

| Variable | Required | Validation | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | Must be a valid PostgreSQL connection string (`postgresql://...`) | Prisma ORM connection |
| `REDIS_URL` | Yes | Must be a valid Redis connection string (`redis://...` or `rediss://...`) | BullMQ queue backend |
| `JWT_SECRET` | Yes | Minimum 32 characters | JWT signing/verification |
| `ENCRYPTION_KEY` | Yes | Must be a 64-character hex string (32 bytes) | AES-256-CBC wallet key encryption |
| `STELLAR_NETWORK` | Yes | Must be `testnet` or `mainnet` | Stellar network passphrase selection |
| `STELLAR_HORIZON_URL` | Yes | Must be a valid HTTPS URL | Stellar Horizon API endpoint |
| `ANCHOR_USDC_URL` | Yes | Must be a valid HTTPS URL | USDC anchor (SEP-6) endpoint |
| `ANCHOR_NGN_URL` | Yes | Must be a valid HTTPS URL | NGN anchor (SEP-6) endpoint |
| `PORT` | No | Numeric, defaults to `3001` | HTTP listen port |
| `NODE_ENV` | No | `development`, `production`, or `test`; defaults to `development` | Runtime mode |

### Frontend (`apps/frontend`)

| Variable | Required | Validation | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Must be a valid HTTP(S) URL | Backend API base URL |

### Rust Worker (`services/rust-worker`)

| Variable | Required | Validation | Purpose |
|---|---|---|---|
| `REDIS_URL` | Yes | Must be a valid Redis connection string | Job queue consumption |
| `STELLAR_HORIZON_URL` | Yes | Must be a valid HTTPS URL | Stellar transaction submission |

### Python Analytics (`services/python-analytics`)

| Variable | Required | Validation | Purpose |
|---|---|---|---|
| `DATABASE_URL` | No | Valid PostgreSQL connection string if provided | Optional DB connection for historical analysis |
| `REDIS_URL` | No | Valid Redis connection string if provided | Optional pub/sub integration |

---

## Local Development

### `.env` File

Copy the template and never commit the resulting `.env` file:

```bash
cp .env.example .env
```

The `.env` file is already listed in `.gitignore`. Verify:

```bash
grep .env .gitignore
# Should contain: .env
```

### Safe Defaults for Local Dev

The `.env.example` ships with safe defaults:

- `JWT_SECRET=change_me_in_production` — acceptable for local dev but **must** be changed before any public deployment
- `ENCRYPTION_KEY` — all-zero key for development only; generate a real key with:
  ```bash
  openssl rand -hex 32
  ```
- `STELLAR_NETWORK=testnet` — uses the Stellar testnet; no real funds involved
- All anchors point to `testanchor.stellar.org`

### Generating Keys

```bash
# Generate a secure JWT secret (64 chars)
openssl rand -base64 48

# Generate an AES-256 encryption key (32 bytes = 64 hex chars)
openssl rand -hex 32

# Put them in your .env:
# JWT_SECRET=<output from first command>
# ENCRYPTION_KEY=<output from second command>
```

### Docker Compose (Local)

When using `docker-compose up`, secrets are passed as environment variables in the compose file. For local development this is acceptable, but production deployments **must not** hardcode secrets in Compose files.

---

## Production

### Principles

1. **Never hardcode secrets** in source code, Dockerfiles, Compose files, or Helm charts
2. **Never log secrets** — the validation code masks secrets in error messages
3. **Rotate regularly** — `JWT_SECRET` and `ENCRYPTION_KEY` should be rotated on a schedule
4. **Use a secrets manager** — AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager, or Kubernetes Secrets
5. **Least privilege** — each service gets only the secrets it needs

### Recommended Approaches

#### Option A: Docker Compose + `.env` file (simple deployments)

```bash
# On the production host
scp .env.production user@host:/opt/afropay/.env
docker-compose --env-file /opt/afropay/.env up -d
```

Ensure the `.env` file is **readable only by the running user**:

```bash
chmod 600 /opt/afropay/.env
chown appuser:appuser /opt/afropay/.env
```

#### Option B: Kubernetes Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: afropay-secrets
type: Opaque
stringData:
  DATABASE_URL: "postgresql://..."
  JWT_SECRET: "..."
  ENCRYPTION_KEY: "..."
```

Reference in deployments via `envFrom` or `valueFrom.secretKeyRef`.

#### Option C: HashiCorp Vault / AWS Secrets Manager

Inject secrets at runtime via sidecar containers or SDK integrations. The application reads from the secret store on startup before validation runs.

### Production Checklist

- [ ] `JWT_SECRET` is at least 64 characters of cryptographic randomness
- [ ] `ENCRYPTION_KEY` is a genuine 32-byte hex key (not all zeros)
- [ ] `STELLAR_NETWORK` is set to `mainnet`
- [ ] `STELLAR_HORIZON_URL` points to the mainnet Horizon instance
- [ ] `ANCHOR_USDC_URL` and `ANCHOR_NGN_URL` point to production anchor endpoints
- [ ] `NODE_ENV` is set to `production`
- [ ] Secrets file has `chmod 600` and is owned by the application user
- [ ] Secrets are not logged anywhere (the app masks them on startup)

---

## Startup Validation (Fail-Fast)

Every service validates its required environment variables during initialization. If any required variable is missing or fails validation, the service **exits immediately with a non-zero exit code and a clear error message**.

### API (NestJS)

Validation uses **Joi** schemas in the `ConfigModule` configuration. On failure, the process exits with:

```
[AfroPay] FATAL: Environment variable validation failed
- "JWT_SECRET" is required
- "ENCRYPTION_KEY" must be a 64-character hex string
```

### Frontend (Next.js)

A startup script validates `NEXT_PUBLIC_API_URL` before the Next.js dev server starts. On failure, the process exits with:

```
[AfroPay] FATAL: NEXT_PUBLIC_API_URL is not set
```

### Rust Worker

Validates `REDIS_URL` and `STELLAR_HORIZON_URL` in `main()` before entering the event loop. On failure, it exits with:

```
[AfroPay] FATAL: REDIS_URL environment variable is not set
```

### Python Analytics

Validates environment at module load time in `main.py`. On failure, it exits with:

```
[AfroPay] FATAL: Required environment variable REDIS_URL is not set
```

---

## Common Tasks

### Rotating JWT_SECRET

1. Generate a new secret: `openssl rand -base64 48`
2. Update the environment variable
3. Restart the API service
4. All existing JWTs become invalid — users must re-authenticate

### Rotating ENCRYPTION_KEY

1. Generate a new key: `openssl rand -hex 32`
2. The old key cannot decrypt existing wallet secrets — you must re-encrypt all stored secrets:
   - Decrypt each wallet's `encryptedSecret` using the old key
   - Re-encrypt using the new key
   - Update the database
3. Update the environment variable
4. Restart the API service

### Adding a New Required Variable

1. Add it to `.env.example` with a sensible default
2. Add it to the Joi validation schema in `apps/api/src/config/env.validation.ts`
3. Add it to the secrets management documentation
4. Update `docker-compose.yml` if the service needs it in CI/dev
5. For production, ensure the secrets manager is updated

---

## Security Notes

### Local Development

- The `.env` file must never be committed. `.gitignore` already excludes it.
- Use testnet (`STELLAR_NETWORK=testnet`) — never develop against mainnet with real funds.
- The default `ENCRYPTION_KEY` in `.env.example` (all zeros) is **for development only**. Generate a real key if you store real data.
- Docker Compose exposes PostgreSQL on port 5432 and Redis on 6379 to the host. In production, remove `ports` from these services or bind to `127.0.0.1` only.
- Database credentials in `docker-compose.yml` and `.env.example` are weak defaults. Change them for any shared or long-lived environment.

### Production

- **Never** use the values from `.env.example` in production. Generate fresh, cryptographically random values.
- Run the `scripts/validate-env.sh` script as part of your CI/CD pipeline to catch missing secrets before deploy.
- Use a dedicated secrets manager (Vault, AWS Secrets Manager, etc.) — do not rely solely on `.env` files.
- Ensure TLS is terminated at the load balancer and connections between services are encrypted.
- Audit logs should never contain raw secret values. The startup validation masks values in error output.
- Restrict database and Redis access to the service mesh / VPC — no public endpoints.
