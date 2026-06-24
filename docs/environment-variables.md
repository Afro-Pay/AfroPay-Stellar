# Environment Variables Reference

All environment variables used across AfroPay-Stellar services, their defaults, and whether they are required or secret-sensitive.

## API (`apps/api/`)

| Variable | Description | Default | Required | Secret |
|---|---|---|---|---|
| `PORT` | HTTP listen port | `3001` | No | No |
| `DATABASE_URL` | PostgreSQL connection string | — | Yes | Yes (contains DB password) |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` | No | No |
| `NODE_ENV` | Runtime environment (`development`, `test`, `production`) | — | No | No |
| `JWT_SECRET` | Secret key for signing JWT tokens | — | Yes | **Yes** |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-CBC wallet key encryption | — | Yes | **Yes** |
| `STELLAR_NETWORK` | Stellar network (`testnet` or `mainnet`) | `testnet` | No | No |
| `STELLAR_HORIZON_URL` | Stellar Horizon API endpoint | `https://horizon-testnet.stellar.org` | No | No |
| `ANCHOR_USDC_URL` | SEP-6 anchor URL for USDC deposits/withdrawals | `https://testanchor.stellar.org` | No | No |
| `ANCHOR_NGN_URL` | SEP-6 anchor URL for NGN deposits/withdrawals | `https://testanchor.stellar.org` | No | No |

## Frontend (`apps/frontend/`)

| Variable | Description | Default | Required | Secret |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL for the API backend | `http://localhost:3001` | No | No |

## Rust Worker (`services/rust-worker/`)

| Variable | Description | Default | Required | Secret |
|---|---|---|---|---|
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` | No | No |
| `STELLAR_HORIZON_URL` | Stellar Horizon API endpoint | `https://horizon-testnet.stellar.org` | No | No |
| `METRICS_PORT` | Prometheus metrics HTTP port | `9898` | No | No |
| `WORKER_CONCURRENCY` | Max concurrent async job workers | `10` | No | No |

## Python Analytics (`services/python-analytics/`)

No environment variables required.

## Docker Compose Only

These are used exclusively in `docker-compose.yml` for the PostgreSQL container:

| Variable | Description | Default |
|---|---|---|
| `POSTGRES_USER` | PostgreSQL user | `remitx` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `remitx` |
| `POSTGRES_DB` | PostgreSQL database name | `remitx` |

## Security Notes

- **`JWT_SECRET`** — If compromised, an attacker can forge authentication tokens. Rotate immediately if leaked.
- **`ENCRYPTION_KEY`** — Encrypts all stored Stellar wallet secret keys. If leaked, all wallet private keys can be decrypted. Store in a vault in production.
- **`DATABASE_URL`** — Contains the database password. Restrict file permissions on `.env`.
- **`POSTGRES_PASSWORD`** — docker-compose local default only; use a strong password in production.
