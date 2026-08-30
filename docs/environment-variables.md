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
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-CBC wallet key encryption | — | Conditional | **Yes** |
| `KMS_KEY_ID` | AWS KMS key identifier used to encrypt per-wallet data keys | — | Conditional | **Yes** |
| `AWS_REGION` | AWS region for the KMS key | — | Conditional | No |
| `SIGNER_URL` | Internal URL for the delegated signer contract | — | Required for signing | No |
| `SIGNER_AUTH_TOKEN` | POC signer bearer credential; use workload identity and mTLS in production | — | Required for signing | **Yes** |
| `COSIGNER_PUBLIC_KEY` | Multisig policy public key; the API does not load a cosigner secret | — | Optional | No |
| `STELLAR_NETWORK` | Stellar network (`testnet` or `mainnet`) | `testnet` | No | No |
| `STELLAR_HORIZON_URL` | Stellar Horizon API endpoint | `https://horizon-testnet.stellar.org` | No | No |
| `STELLAR_HORIZON_URLS` | Comma-separated Horizon endpoints for failover, optionally weighted as `url\|weight` | falls back to `STELLAR_HORIZON_URL` | No | No |
| `SOROBAN_RPC_URL` | Primary Soroban JSON-RPC endpoint | `https://soroban-testnet.stellar.org` | No | No |
| `SOROBAN_RPC_URLS` | Comma-separated Soroban JSON-RPC endpoints for failover, optionally weighted as `url\|weight` | falls back to `SOROBAN_RPC_URL` | No | No |
| `RPC_HEALTH_INTERVAL_MS` | RPC health polling interval | `10000` | No | No |
| `RPC_MAX_BLOCK_LAG` | Maximum ledger lag allowed before a node is excluded | `3` | No | No |
| `RPC_RATE_LIMIT_COOLDOWN_MS` | Time to keep a 429-rate-limited provider out of rotation | `60000` | No | No |
| `RPC_REQUEST_TIMEOUT_MS` | Timeout for RPC health and REST/JSON-RPC calls | `5000` | No | No |
| `ANCHOR_USDC_URL` | SEP-6 anchor URL for USDC deposits/withdrawals | `https://testanchor.stellar.org` | No | No |
| `ANCHOR_NGN_URL` | SEP-6 anchor URL for NGN deposits/withdrawals | `https://testanchor.stellar.org` | No | No |
| `RATE_LIMIT_MAX` | Global fallback request limit for any `@RateLimit()`-decorated route that doesn't set its own `limitEnv` | `60` | No | No |
| `RATE_LIMIT_WINDOW_MS` | Global fallback rate-limit window (ms), same fallback rules as `RATE_LIMIT_MAX` | `60000` | No | No |
| `PUBLIC_API_RATE_LIMIT_MAX` | Request limit for `POST /transaction/send` | `20` | No | No |
| `PUBLIC_API_RATE_LIMIT_WINDOW_MS` | Rate-limit window (ms) for `POST /transaction/send` | `60000` | No | No |
| `WALLET_BALANCES_RATE_LIMIT_MAX` | Per-user request limit for `GET /wallet/balances` (proxies to Stellar Horizon) | `10` | No | No |
| `WALLET_BALANCES_RATE_LIMIT_WINDOW_MS` | Rate-limit window (ms) for `GET /wallet/balances` | `60000` | No | No |
| `ANCHOR_FX_RATE_RATE_LIMIT_MAX` | Per-user request limit for `GET /anchor/fx-rate` | `10` | No | No |
| `ANCHOR_FX_RATE_RATE_LIMIT_WINDOW_MS` | Rate-limit window (ms) for `GET /anchor/fx-rate` | `60000` | No | No |
| `ANCHOR_AUTH_RATE_LIMIT_MAX` | Per-IP request limit for the unauthenticated `GET /anchor/auth/challenge` and `POST /anchor/auth/token` SEP-10 endpoints | `20` | No | No |
| `ANCHOR_AUTH_RATE_LIMIT_WINDOW_MS` | Rate-limit window (ms) for the anchor-auth endpoints above | `60000` | No | No |

## Frontend (`apps/frontend/`)

| Variable | Description | Default | Required | Secret |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL for the API backend | `http://localhost:3001` | No | No |

## Rust Worker (`services/rust-worker/`)

| Variable | Description | Default | Required | Secret |
|---|---|---|---|---|
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` | No | No |
| `STELLAR_HORIZON_URL` | Stellar Horizon API endpoint | `https://horizon-testnet.stellar.org` | No | No |
| `HORIZON_URL` | Horizon endpoint used by legacy worker paths | `https://horizon-testnet.stellar.org` | No | No |
| `HORIZON_URLS` | Comma-separated Horizon endpoints for the Rust RPC pool, optionally weighted as `url\|weight` | falls back to `HORIZON_URL` | No | No |
| `SOROBAN_RPC_URL` | Soroban JSON-RPC endpoint used by the Rust RPC pool | `https://soroban-testnet.stellar.org` | No | No |
| `SOROBAN_RPC_URLS` | Comma-separated Soroban endpoints for the Rust RPC pool, optionally weighted as `url\|weight` | falls back to `SOROBAN_RPC_URL` | No | No |
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

## Docker Compose Environment Wiring

The local Compose stack loads the repository root `.env` file and uses the values there when available.
If `.env` is missing, Compose falls back to the development defaults defined in `docker-compose.yml`.

This makes it easy to start the full stack with one command while still allowing developers to override secrets and service URLs locally.

## Security Notes

- **`JWT_SECRET`** — If compromised, an attacker can forge authentication tokens. Rotate immediately if leaked.
- **`ENCRYPTION_KEY`** — Encrypts all stored Stellar wallet secret keys. If leaked, all wallet private keys can be decrypted. Store in a vault in production.
- **`DATABASE_URL`** — Contains the database password. Restrict file permissions on `.env`.
- **`POSTGRES_PASSWORD`** — docker-compose local default only; use a strong password in production.
