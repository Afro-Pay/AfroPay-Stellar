# Integration Guide

## Architecture Overview

AfroPay-Stellar uses a polyglot microservices architecture with five main components:

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js 14)                     │
│                  Port 3000 · TypeScript                      │
│         Communicates only with API Gateway via REST          │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS / JSON
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  API GATEWAY (NestJS 10)                     │
│                  Port 3001 · TypeScript                      │
│                                                              │
│  ┌──────────┐  ┌─────────────┐  ┌───────────────────┐       │
│  │  Auth    │  │   Wallet    │  │  Transaction       │       │
│  │ Service  │  │   Service   │  │  Service           │       │
│  │ JWT,     │  │ Keypair     │  │  BullMQ enqueue    │       │
│  │ bcrypt   │  │ AES encrypt │  │  DB persistence    │       │
│  └──────────┘  └──────┬──────┘  └────────┬──────────┘       │
│                       │                  │                   │
│                       │          ┌───────▼──────────┐       │
│                       │          │Transaction       │       │
│                       │          │Processor         │       │
│                       │          │(BullMQ consumer) │       │
│                       │          │stellar-sdk:      │       │
│                       │          │build & submit tx │       │
│                       │          └───────┬──────────┘       │
│                       │                  │                   │
│              ┌────────▼────────┐         │                   │
│              │ Horizon.Server  │◄────────┘                   │
│              │ (stellar-sdk)   │                             │
│              │ balance queries │                             │
│              └─────────────────┘                             │
│                                                              │
│  ┌──────────────────────────────────────────────────┐        │
│  │           Anchor Service (SEP-6)                 │        │
│  │   GET /anchor/deposit · /anchor/withdraw         │        │
│  │   Proxies to external anchor servers             │        │
│  └──────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
┌──────────────────────┐  ┌──────────────────────────┐
│    Redis (BullMQ)     │  │  PostgreSQL 16 (Prisma)   │
│  transactions queue   │  │  User · Wallet · Tx      │
│  stellar_jobs list    │  └──────────────────────────┘
└──────────┬───────────┘
           │ BLPOP
           ▼
┌─────────────────────────────────────────────────────────────┐
│                  RUST WORKER (Blockchain Engine)              │
│           Tokio · redis · reqwest · stellar-base            │
│                                                              │
│  Listens on Redis list "stellar_jobs"                        │
│  Constructs XDR payment envelopes                            │
│  Submits to Horizon POST /transactions                       │
│                                                              │
│  NOTE: Scaffolded but not yet wired to the API.              │
│  The API currently uses BullMQ / TransactionProcessor        │
│  as its primary transaction path.                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│               PYTHON ANALYTICS (Fraud Detection)             │
│               Port 8000 · FastAPI · Pydantic                 │
│                                                              │
│  POST /fraud/score → { risk_score, flagged, reasons }       │
│                                                              │
│  NOTE: Service is running but not yet called by the API.     │
│  The TransactionProcessor does not currently invoke it.     │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Interactions

### 1. Frontend → API Gateway

The frontend (Next.js) has **no direct blockchain interaction**. All Stellar operations are handled server-side.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/register` | Create account (email + password) |
| POST | `/auth/login` | Authenticate, receive JWT |
| POST | `/wallet/create` | Generate Stellar keypair |
| GET | `/wallet/balances` | Fetch balances from Horizon |
| POST | `/wallet/import` | Import existing secret key |
| GET | `/wallet/export` | Get public + decrypted secret key |
| POST | `/transactions/send` | Submit a payment |
| GET | `/transactions/history` | Last 50 transactions |
| GET | `/transactions/:id` | Single transaction details |
| GET | `/anchor/deposit` | SEP-6 deposit info (proxied) |
| GET | `/anchor/withdraw` | SEP-6 withdraw info (proxied) |
| GET | `/anchor/fx-rate` | FX rates (stub) |

**Communication:** HTTP REST via Axios. JWT stored in `localStorage`, attached as `Authorization: Bearer <token>` header automatically by the Axios interceptor (`apps/frontend/lib/api.ts`).

**State management:** Zustand store (`apps/frontend/store/walletStore.ts`) manages balances, transactions, and send operations.

---

### 2. API Gateway Internal Services

#### Auth Service (`apps/api/src/auth/`)
- **Registration:** Validates email/password, hashes password with bcrypt (10 rounds), stores user in PostgreSQL, returns signed JWT (7-day expiry).
- **Login:** Validates credentials, returns JWT.
- **No Stellar interaction** — auth is purely application-level.

#### Wallet Service (`apps/api/src/wallet/wallet.service.ts`)
- **Create Wallet:** Generates `Keypair.random()` via `stellar-sdk`, encrypts the secret key with AES-256-CBC, stores `publicKey` + `encryptedSecret` in PostgreSQL. Returns only the public key to the client.
- **Get Balances:** Loads the Stellar account from Horizon via `server.loadAccount(publicKey)`, returns all balances (native XLM and issued assets).
- **Export Wallet:** Decrypts and returns both public and secret keys (server-side decryption only).
- **Import Wallet:** Recovers a `Keypair` from a provided secret key via `Keypair.fromSecret()`, encrypts and stores it.

**Horizon calls made by Wallet Service:**
- `Horizon.Server(horizonUrl).loadAccount(publicKey)` — used in `getBalances()`

#### Transaction Service (`apps/api/src/transaction/transaction.service.ts`)
- **Send Transfer:**
  1. Creates a `Transaction` record in PostgreSQL with status `PENDING`
  2. Enqueues a BullMQ job to the `transactions` queue with the job payload `{ txId, userId, destinationPublicKey, amount, assetCode, assetIssuer, memo }`
  3. Returns `{ txId, status: 'PENDING' }` immediately to the client
- **History:** Fetches last 50 transactions for the user from PostgreSQL
- **Get Transaction:** Fetches a single transaction by ID

#### Transaction Processor (`apps/api/src/transaction/transaction.processor.ts`)
This is a BullMQ consumer that processes jobs from the `transactions` queue:

1. **Load keypair:** Calls `walletService.getKeypair(userId)` which decrypts the stored secret from PostgreSQL
2. **Load source account:** Calls `server.loadAccount(keypair.publicKey())` from Horizon to get the current sequence number
3. **Build transaction:**
   - Creates `TransactionBuilder` with `BASE_FEE` and the network passphrase (testnet/public)
   - Adds `Operation.payment()` with the destination, asset, and amount
   - Sets a 30-second timeout
   - Adds an optional memo if provided
   - Signs the transaction with the source keypair
4. **Submit to Horizon:** Calls `server.submitTransaction(transaction)` which posts the signed XDR to Horizon
5. **Update DB:** On success, updates the transaction record to `SUCCESS` and stores the `stellarTxHash`. On failure, records `retryAttempts` and `lastFailureReason`, retries up to 3 times with exponential backoff (2s → 4s → 8s), then marks as `FAILED` with `failedAt` or `RETRYING`.

**Horizon calls made by Transaction Processor:**
- `server.loadAccount(publicKey)` — get source account sequence
- `server.submitTransaction(transaction)` — submit signed XDR

#### Anchor Service (`apps/api/src/anchor/anchor.service.ts`)
- Acts as a proxy to external Stellar anchor servers (SEP-6)
- **Deposit:** `GET {anchor_url}/sep6/deposit?asset_code=X&account=Y`
- **Withdraw:** `GET {anchor_url}/sep6/withdraw?asset_code=X&account=Y&amount=Z`
- **FX Rates:** Returns stub rates (USD-NGN: 1550, NGN-USD: 0.00065, XLM-USD: 0.11) — placeholder for a real FX provider

**External calls made by Anchor Service:**
- HTTP GET to configured anchor URLs (via axios)

---

### 3. Rust Worker (`services/rust-worker/`)

The Rust worker is a **blockchain execution engine** that provides an alternative transaction processing path.

| Aspect | Detail |
|---|---|
| **Runtime** | Tokio (async) |
| **Queue** | Redis BLPOP on list `stellar_jobs` |
| **Dependencies** | `redis`, `reqwest`, `serde`, `stellar-base 0.7`, `stellar-horizon 0.7` |
| **Port** | None (no HTTP server) |
| **Dockerfile** | Multi-stage: `cargo build --release` → `debian:bookworm-slim` |

**Flow:**

1. **Listen** (`src/queue.rs`): Infinite loop calling `BLPOP stellar_jobs 0` on Redis. When a job arrives, it deserializes the JSON payload into a `TransactionJob` struct.
2. **Process** (`src/stellar.rs`):
   - Fetches the source account from Horizon: `GET /accounts/{publicKey}`
   - Builds a payment XDR envelope (currently a placeholder stub)
   - Submits the transaction: `POST /transactions` to Horizon with form-encoded `tx` parameter
3. **Result:** Logs success/failure — currently does **not** update the PostgreSQL database

**TransactionJob payload** (`src/models.rs`):
```json
{
  "tx_id": "uuid",
  "user_id": "uuid",
  "source_secret": "S...",
  "destination_public_key": "G...",
  "amount": "100",
  "asset_code": "XLM",
  "asset_issuer": null,
  "memo": null
}
```

**Current status:** The Rust worker is scaffolded and compiles, but:
- The `build_payment_xdr()` function returns a placeholder string (`"STUB_XDR_{tx_id}_{amount}_{asset_code}"`) instead of a real XDR envelope
- The `derive_public_key()` function is also a stub (takes first 56 chars of secret)
- The NestJS API does not currently publish jobs to the `stellar_jobs` Redis list — it uses BullMQ queues instead
- The worker does not update PostgreSQL with results

To wire the Rust worker into the main flow, the API's `TransactionService` would need to `RPUSH` a job to `stellar_jobs` in addition to (or instead of) the BullMQ queue, and the worker would need to call back to the API or directly update PostgreSQL on completion.

---

### 4. Python Analytics (`services/python-analytics/`)

A fraud detection and risk scoring service.

| Aspect | Detail |
|---|---|
| **Framework** | FastAPI 0.110 |
| **Port** | 8000 |
| **Endpoint** | `POST /fraud/score` |
| **Dockerfile** | `pip install` → `uvicorn main:app --host 0.0.0.0 --port 8000` |

**Request** (`TransactionInput`):
```json
{
  "tx_id": "uuid",
  "user_id": "uuid",
  "amount": "10000",
  "asset_code": "USDC",
  "destination": "G...",
  "source_country": "NG",
  "destination_country": "US"
}
```

**Response** (`RiskResult`):
```json
{
  "risk_score": 0.4,
  "flagged": false,
  "reasons": []
}
```

**Scoring logic** (`app/fraud.py`):
- Amount > $10,000: +0.4
- High-risk destination country (KP, IR, SY): +0.5
- High-risk source country (KP, IR, SY): +0.3
- Round-number amount (divisible by 1000): +0.1
- Score capped at 1.0, flagged if ≥ 0.5

**Current status:** The service runs but is **not called** by the NestJS API. The `TransactionProcessor` does not invoke `POST /fraud/score` before submitting transactions. Integrating fraud scoring would involve adding an HTTP call to the fraud service in the processor before building and submitting the transaction.

---

### 5. Shared Types Package (`packages/shared-types/`)

Defines TypeScript interfaces shared across the monorepo:

| Interface | Fields |
|---|---|
| `User` | id, email, createdAt |
| `Wallet` | id, userId, publicKey, encryptedSecret, createdAt |
| `Balance` | asset, balance |
| `Transaction` | id, userId, destination, amount, assetCode, assetIssuer, memo, status, stellarTxHash, riskScore, flagged, createdAt, updatedAt |
| `SendTransferPayload` | destinationPublicKey, amount, assetCode, assetIssuer?, memo? |

**Note:** Neither `apps/frontend` nor `apps/api` currently import from this package — both define their own local interfaces. This package is aspirational for future consolidation.

---

## Stellar / Horizon Integration Points

### Which Services Call Horizon

| Service | File | Horizon Endpoint | Purpose |
|---|---|---|---|
| Wallet Service | `apps/api/src/wallet/wallet.service.ts` | `GET /accounts/{publicKey}` (via `server.loadAccount()`) | Fetch balances |
| Transaction Processor | `apps/api/src/transaction/transaction.processor.ts` | `GET /accounts/{publicKey}` (via `server.loadAccount()`) | Get source account sequence |
| Transaction Processor | `apps/api/src/transaction/transaction.processor.ts` | `POST /transactions` (via `server.submitTransaction()`) | Submit signed payment |
| Rust Worker | `services/rust-worker/src/stellar.rs` | `GET /accounts/{publicKey}` (via `reqwest`) | Get source account sequence |
| Rust Worker | `services/rust-worker/src/stellar.rs` | `POST /transactions` (via `reqwest` + form-encoded) | Submit XDR envelope |

### Which Components Submit Transactions

| Component | Method | Status |
|---|---|---|
| TransactionProcessor (NestJS/BullMQ) | `stellar-sdk` `TransactionBuilder` + `server.submitTransaction()` | **Active** — this is the primary transaction path |
| Rust Worker | Raw HTTP `POST /transactions` with form-encoded XDR | **Scaffolded** — not yet wired, XDR builder is a stub |

### Network Configuration

- **Default network:** Testnet (`https://horizon-testnet.stellar.org`)
- **Switch to mainnet:** Set `STELLAR_NETWORK=mainnet` in environment
- **Environment variable:** `STELLAR_HORIZON_URL` (in `apps/api`, `services/rust-worker`, and `docker-compose.yml`)

---

## Transaction Routing

### Primary Path: BullMQ + TransactionProcessor (Active)

```
User                  Frontend                API                   PostgreSQL          Redis/BullMQ       TransactionProcessor       Horizon
 │                       │                     │                       │                    │                     │                      │
 │─ Send form ──────────►│                     │                       │                    │                     │                      │
 │                       │─ POST /send ───────►│                       │                    │                     │                      │
 │                       │                     │─ INSERT tx ──────────►│                    │                     │                      │
 │                       │                     │  (PENDING)           │                    │                     │                      │
 │                       │                     │─ Queue.add() ──────────────────────────────►│                     │                      │
 │                       │◄──── { txId } ─────│                       │                    │                     │                      │
 │◄── "Submitted" ──────│                     │                       │                    │                     │                      │
 │                       │                     │                       │                    │                     │                      │
 │                       │                     │                       │                    │─ Consume job ──────►│                      │
 │                       │                     │                       │                    │                     │                      │
 │                       │                     │                       │                    │                     │─ loadAccount() ─────►│
 │                       │                     │                       │                    │                     │                      │
 │                       │                     │                       │                    │                     │─ Build + sign tx     │
 │                       │                     │                       │                    │                     │                      │
 │                       │                     │                       │                    │                     │─ submitTransaction ─►│
 │                       │                     │                       │                    │                     │                      │
 │                       │                     │                       │                    │                     │◄── { tx hash } ─────│
 │                       │                     │─ UPDATE SUCCESS ─────►│                    │                     │                      │
 │                       │                     │  + hash               │                    │                     │                      │
 │ (User refreshes via GET /transactions/history to see updated status)
```

### Alternative Path: Rust Worker (Scaffolded, Not Wired)

```
API                        Redis "stellar_jobs"         Rust Worker              Horizon
 │                              │                           │                      │
 │─ RPUSH stellar_jobs ────────►│                           │                      │
 │  (TransactionJob JSON)       │                           │                      │
 │                              │─ BLPOP stellar_jobs ────►│                      │
 │                              │                           │                      │
 │                              │                           │─ GET /accounts ─────►│
 │                              │                           │◄── { sequence } ────│
 │                              │                           │                      │
 │                              │                           │─ POST /transactions ─►│
 │                              │                           │  (XDR form data)     │
 │                              │                           │◄── { hash } ────────│
 │                              │                           │                      │
 │                              │                           │─ (logs result,       │
 │                              │                           │   no DB update)      │
```

### Retry Strategy (BullMQ)

- **Max attempts:** 3
- **Backoff:** Exponential (2s, 4s, 8s)
- **Status mapping:** attempts before the max are stored as `RETRYING`; the final exhausted attempt is stored as `FAILED`
- **Failure tracking:** every failed attempt updates `retryAttempts` and `lastFailureReason`; the exhausted final attempt also sets `failedAt`
- **On success:** Status set to `SUCCESS`, `stellarTxHash` stored, previous failure context cleared

---

## Anchor Integration (SEP-6)

| Endpoint | Description | Parameters | Proxy Target |
|---|---|---|---|
| `GET /anchor/deposit` | Get deposit instructions | `asset`, `account` | `{anchor}/sep6/deposit` |
| `GET /anchor/withdraw` | Get withdrawal instructions | `asset`, `account`, `amount` | `{anchor}/sep6/withdraw` |
| `GET /anchor/fx-rate` | Get exchange rate | `from`, `to` | Stub (no external call) |

**Configured anchors:**
- `ANCHOR_USDC_URL` — defaults to `https://testanchor.stellar.org`
- `ANCHOR_NGN_URL` — defaults to `https://testanchor.stellar.org`

**Flow:** The API acts as a proxy. The frontend calls the API, which forwards the request to the external anchor server and returns the response. No Stellar SDK calls are made — the anchor handles the on-chain operations.

---

## Soroban Smart Contracts

There are **no Soroban smart contracts** in this codebase. The project currently uses basic Stellar `Operation.payment()` transactions only. Soroban is mentioned in the documentation as a future roadmap item for:

- Payment automation
- Transaction verification
- Advanced remittance logic

When Soroban support is added, contract interactions would likely be routed through:
- The Rust worker (for contract execution via Soroban RPC)
- The Transaction Processor (for submitting invokeHostFunction operations)

---

## Data Flow Summary

### Wallet Creation Flow
```
Frontend → POST /wallet/create → WalletService creates Keypair.random()
  → Encrypts secret with AES-256-CBC (32-byte key from ENCRYPTION_KEY)
  → Stores publicKey + encryptedSecret in PostgreSQL
  → Returns publicKey to frontend
```

### Balance Fetch Flow
```
Frontend → GET /wallet/balances → WalletService decrypts stored secret
  → Loads account from Horizon via server.loadAccount(publicKey)
  → Returns [{ asset, balance }] to frontend
```

### Payment Flow
```
Frontend → POST /transactions/send → TransactionService creates DB record (PENDING)
  → Enqueues to BullMQ "transactions" queue
  → Returns { txId, PENDING }

TransactionProcessor (async):
  → Loads keypair from WalletService (decrypts secret)
  → Loads account from Horizon (for sequence number)
  → Builds TransactionBuilder + Operation.payment()
  → Signs with source keypair
  → Submits to Horizon via server.submitTransaction()
  → Updates DB to SUCCESS with stellarTxHash, or RETRYING/FAILED with retryAttempts and failure context
```

### Deposit/Withdraw Info Flow
```
Frontend → GET /anchor/deposit or /anchor/withdraw → AnchorService
  → Proxies request to external anchor server (SEP-6)
  → Returns anchor's response to frontend
```

---

## Security Architecture

| Concern | Implementation |
|---|---|
| **Auth** | JWT (7-day expiry) + bcrypt password hashing (10 rounds) |
| **Key storage** | AES-256-CBC encryption (32-byte key from `ENCRYPTION_KEY` env var) |
| **Key exposure** | Secret keys never sent to frontend by default; `/wallet/export` decrypts server-side |
| **API protection** | `@UseGuards(AuthGuard('jwt'))` on all wallet/transaction/anchor endpoints |
| **Transaction signing** | Done server-side in TransactionProcessor (secret loaded from DB, decrypted, used to sign, never logged) |

---

## Deployment Architecture

See `docker-compose.yml` for the full service orchestration:

| Service | Image | Port | Depends On |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 | — |
| `redis` | redis:7-alpine | 6379 | — |
| `api` | ./apps/api | 3001 | postgres, redis |
| `frontend` | ./apps/frontend | 3000 | api |
| `rust-worker` | ./services/rust-worker | — | redis |
| `fraud-service` | ./services/python-analytics | 8000 | — |
