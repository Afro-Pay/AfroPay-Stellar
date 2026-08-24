# AfroPay-Stellar
 
> Cross-border remittance platform built on the Stellar blockchain — fast, low-cost, and Africa-focused.
 
[![Build](https://img.shields.io/github/actions/workflow/status/Fury03/AfroPay-Stellar/ci.yml?branch=main&label=build&style=flat-square)](https://github.com/Fury03/AfroPay-Stellar/actions)
[![Tests](https://img.shields.io/github/actions/workflow/status/Fury03/AfroPay-Stellar/ci.yml?branch=main&label=tests&style=flat-square)](https://github.com/Fury03/AfroPay-Stellar/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)
[![Stellar Network](https://img.shields.io/badge/stellar-testnet-blueviolet?style=flat-square)](https://stellar.org)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?style=flat-square&logo=docker&logoColor=white)](docker-compose.yml)
 
<img width="1920" height="1080" alt="AfroPay dashboard" src="https://github.com/user-attachments/assets/3ebd4b8d-079f-4cb0-a820-4fc86b8cf0ac" />
<img width="1920" height="1080" alt="AfroPay transfer view" src="https://github.com/user-attachments/assets/29f32b93-b8e8-46c1-bb11-d129f3e60d71" />
<img width="1920" height="1080" alt="AfroPay wallet view" src="https://github.com/user-attachments/assets/b9378c93-224e-45e4-b9de-c2f41813fd62" />
**Live demo:** https://afro-pay-stellar.vercel.app/login
 
---
 
## Table of Contents
 
- [Overview](#overview)
- [Feature Matrix](#feature-matrix)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Running Tests](#running-tests)
- [Docker](#docker)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
---
 
## Overview
 
AfroPay-Stellar simplifies international money transfers by leveraging the Stellar blockchain:
 
- **Near-instant settlement** — transactions confirm in 3–5 seconds
- **Low fees** — Stellar's base fee model keeps transfer costs minimal
- **Multi-currency** — supports NGN, USD, EUR, and USDC
- **Africa-first** — designed around the Nigerian Naira and broader African remittance corridors
- **Fiat rails** — deposit and withdrawal flows via Stellar anchor network
---
 
## Feature Matrix
 
This table captures the current state of the platform and what is planned next. The project is **active and in testnet**.
 
### ✅ Implemented
 
| Area | Feature | Notes |
|---|---|---|
| **Authentication** | JWT-based login & registration | `apps/api/src/auth` |
| **Authentication** | Password hashing (bcrypt) | Integrated in auth service |
| **Wallet** | Stellar wallet generation | Keypair created on user registration |
| **Wallet** | Encrypted private key storage | AES encryption at rest in PostgreSQL |
| **Wallet** | Balance tracking (XLM, USDC, NGN) | Queried from Stellar Horizon |
| **Wallet** | Trustline management | Checked before transfers |
| **Transfers** | Multi-currency send (XLM, USDC, NGN) | Via Stellar path payments |
| **Transfers** | Real-time FX rate fetch | Pre-transfer quote via Horizon |
| **Transfers** | Transfer simulation (dry-run) | `transfer-simulation.service.ts` — validates path, fees, trustlines without submitting |
| **Transaction Engine** | Async job queue | Redis + BullMQ decouples API from settlement |
| **Transaction Engine** | Stellar transaction submission | Rust worker consumes queued jobs |
| **Transaction Engine** | Retry & failure handling | BullMQ retry policies |
| **Transaction Engine** | Transaction status tracking | Persisted in PostgreSQL with `stellarTxHash` |
| **Anchor Integration** | Deposit endpoint | SEP-compliant anchor flow |
| **Anchor Integration** | Withdrawal endpoint | SEP-compliant anchor flow |
| **Anchor Integration** | Multi-anchor fallback config | `ANCHOR_USDC_URL`, `ANCHOR_NGN_URL` env vars |
| **Security** | Rate limiting | NestJS guards |
| **Security** | Audit logging | Transaction records with timestamps and status |
| **Security** | KYC/AML schema hooks | `riskScore` and `flagged` fields on Transaction model |
| **Intelligence** | Fraud & risk scoring | Python analytics service (`services/python-analytics`) |
| **Intelligence** | Transaction monitoring | Risk score fed back into transaction record |
| **Frontend** | Wallet dashboard | Next.js + Tailwind + ShadCN |
| **Frontend** | Send / transfer form | Currency and recipient input |
| **Frontend** | Transaction history view | Per-user transaction list |
| **Frontend** | Dark-mode fintech UI | Glassmorphism design system |
| **DevOps** | Full Docker Compose stack | All 5 services containerised |
| **DevOps** | Health checks & boot ordering | `service_healthy` conditions for all dependencies |
| **DevOps** | Structured JSON logging | Configurable log rotation in Docker |
 
### 🗓️ Planned (Roadmap)
 
| Area | Feature | Priority |
|---|---|---|
| **Wallet** | Multi-signature wallets | High |
| **Smart Contracts** | Escrow contracts (Soroban / Rust) | High |
| **Transfers** | Advanced liquidity routing | Medium |
| **Transfers** | Merchant payment tools | Medium |
| **Transfers** | Business remittance APIs | Medium |
| **Frontend** | Admin dashboard | Medium |
| **Frontend** | Mobile app (React Native) | Low |
| **Compliance** | Full KYC document upload & verification flow | Medium |
| **Compliance** | AML screening integration | Medium |
| **Infrastructure** | CI/CD pipeline (GitHub Actions) | High |
| **Infrastructure** | Terraform infra-as-code | Low |
 
---
 
## Architecture
 
AfroPay-Stellar is a **polyglot microservices** system. The Next.js frontend talks to a NestJS API gateway; settlement is handled asynchronously by a Rust worker; fraud signals come from a Python analytics service.
 
```
Client (Next.js)
    ↓ REST
API Gateway (NestJS)
    ├── Wallet Service   → PostgreSQL
    ├── Transaction Service → PostgreSQL + Redis queue
    └── Anchor Service   → Stellar Horizon
         ↓ BullMQ jobs
    Rust Worker          → Stellar Network (path payments, trustlines)
         ↓ tx hashes
    PostgreSQL
         ↓ transaction history
    Python Analytics     → risk score → API
```
 
```mermaid
flowchart LR
  user["User / Wallet holder"]
  frontend["Next.js frontend\napps/frontend"]
  api["NestJS API\napps/api"]
  wallet["Wallet service\nkeys, balances, trustlines"]
  tx["Transaction service\nquotes, transfers, simulations"]
  anchor["Anchor service\ndeposit and withdrawal rails"]
  redis["Redis / BullMQ\njobs, retries, cache"]
  postgres["PostgreSQL + Prisma\nusers, wallets, transfers, audit"]
  rust["Rust worker\nservices/rust-worker"]
  python["Python analytics\nfraud, risk scoring, monitoring"]
  stellar["Stellar network\nHorizon, anchors, Soroban contracts"]
 
  user --> frontend
  frontend -->|"REST requests + wallet actions"| api
  api --> wallet
  api --> tx
  api --> anchor
  wallet --> postgres
  tx --> postgres
  anchor --> postgres
  api --> redis
  tx -->|"enqueue settlement jobs"| redis
  redis --> rust
  rust -->|"submit path payments / contract calls"| stellar
  rust -->|"status + transaction hashes"| postgres
  postgres --> python
  python -->|"risk decisions + alerts"| api
  anchor -->|"fiat on/off-ramp flows"| stellar
```

Component responsibilities:

- **Frontend (`apps/frontend`)**: login, wallet views, send forms, balance cards, and transaction dashboards.
- **API (`apps/api`)**: authentication, wallet APIs, transfer simulation, transaction orchestration, anchor endpoints, and persistence through Prisma.
- **Redis / BullMQ**: decouples user-facing API calls from slower settlement work, supports retries, and stores short-lived workflow state.
- **Rust worker (`services/rust-worker`)**: consumes queued jobs, prepares Stellar operations, submits transactions, and reports settlement state.
- **Python analytics (`services/python-analytics`)**: evaluates fraud, risk, and monitoring signals from transaction history.
- **PostgreSQL**: source of truth for users, wallets, transfers, simulation records, and audit-friendly transaction status.
- **Stellar / anchors / Soroban**: final payment settlement, liquidity routing, and contract interactions.

See [docs/architecture.md](docs/architecture.md) for a longer data-flow view.
See [docs/deployment.md](docs/deployment.md) for production deployment, secret management, migration, staging, and rollback guidance.
 
---
 
## Tech Stack
 
| Layer | Technology |
|---|---|
| Frontend | Next.js, TypeScript, Tailwind CSS, ShadCN UI, Zustand |
| Backend API | NestJS (TypeScript), Passport JWT, class-validator |
| Blockchain | Stellar SDK v11, Rust worker, Soroban (planned) |
| Database | PostgreSQL 16, Prisma ORM |
| Queue | Redis 7, BullMQ |
| Analytics | Python 3, fraud/risk scoring service |
| DevOps | Docker, Docker Compose, Terraform (optional) |
 
---
 
## Project Structure
 
```
AfroPay-Stellar/
├── apps/
│   ├── api/                 # NestJS backend
│   │   ├── src/
│   │   │   ├── auth/        # JWT auth, registration, login
│   │   │   ├── wallet/      # Wallet generation, key storage, balances
│   │   │   ├── transaction/ # Transfer orchestration, simulation, queue processor
│   │   │   ├── anchor/      # Deposit/withdrawal SEP flows
│   │   │   └── prisma/      # Prisma client module
│   │   └── prisma/
│   │       └── schema.prisma
│   └── frontend/            # Next.js UI
│       ├── pages/
│       ├── components/
│       └── store/
├── services/
│   ├── rust-worker/         # Stellar transaction engine (Rust)
│   └── python-analytics/    # Fraud detection & risk scoring (Python)
├── packages/
│   └── shared-types/        # Shared TypeScript types
├── docs/
│   ├── architecture.md
│   ├── api-reference.md
│   ├── integration.md
│   └── logging.md
├── scripts/
│   └── setup.sh
└── docker-compose.yml
```
 
---
 
## Getting Started
 
### Prerequisites
 
| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| Docker & Docker Compose | Latest stable |
| PostgreSQL | 16 (or use Docker) |
| Redis | 7 (or use Docker) |
 
### Quickstart with Docker (recommended)
 
```bash
# 1. Clone
git clone https://github.com/Fury03/AfroPay-Stellar.git
cd AfroPay-Stellar
 
# 2. Configure environment
cp .env.example .env   # then edit values
 
# 3. Build and start all services
docker compose up --build
```
 
Services will be available at:
- Frontend: http://localhost:3000
- API: http://localhost:3001
- Python analytics: http://localhost:8000
### Local Development (without Docker)
 
```bash
# Install API dependencies
cd apps/api
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
 
# In a separate terminal — install frontend dependencies
cd apps/frontend
npm install
npm run dev
```
 
---
 
## Environment Variables
 
Create a `.env` file at the repo root (copy from `.env.example`):
 
```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/afropay
 
# Redis
REDIS_URL=redis://localhost:6379
 
# Auth
JWT_SECRET=your_secret_key
ENCRYPTION_KEY=64_char_hex_string_for_aes_256
 
# Stellar
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
 
# Anchors
ANCHOR_USDC_URL=https://testanchor.stellar.org
ANCHOR_NGN_URL=https://testanchor.stellar.org
 
# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
```
 
> **Never commit real keys.** Use `STELLAR_NETWORK=testnet` for local development. See [docs/integration.md](docs/integration.md) for anchor configuration details.
 
---
 
## Running Tests
 
```bash
# Run all unit tests (API)
cd apps/api
npm test
 
# Run a specific suite — transfer simulation
npm test -- transfer-simulation.service.spec.ts
 
# Run wallet service tests
npm test -- wallet.service.spec.ts
 
# Run anchor service tests
npm test -- anchor.service.spec.ts
 
# Lint
npm run lint
```
 
Test files live alongside their services (`*.spec.ts`) and use Jest + ts-jest.
 
---
 
## Docker
 
```bash
# Start all services
docker compose up --build
 
# Start in background
docker compose up -d --build
 
# View logs for a specific service
docker compose logs -f api
 
# Stop everything
docker compose down
 
# Stop and wipe volumes (resets database)
docker compose down -v
```
 
**Services in the Compose stack:**
 
| Service | Port | Description |
|---|---|---|
| `postgres` | 5432 | PostgreSQL 16 with health check |
| `redis` | 6379 | Redis 7 with health check |
| `api` | 3001 | NestJS API (waits for DB + Redis healthy) |
| `frontend` | 3000 | Next.js UI (waits for API healthy) |
| `rust-worker` | — | Stellar settlement worker (waits for Redis healthy) |
| `fraud-service` | 8000 | Python analytics / fraud scoring |
 
All services use `unless-stopped` restart policy. Startup order is enforced via `condition: service_healthy` — no service starts until its dependencies pass their health checks.
 
---
 
## Roadmap
 
The items below are **not yet implemented**. PRs and discussion for any of them are welcome.
 
- [ ] **CI/CD pipeline** — GitHub Actions for build, lint, and test on every PR *(high priority)*
- [ ] **Multi-signature wallets** — require M-of-N signers for large transfers *(high priority)*
- [ ] **Soroban escrow contracts** — trustless escrow and conditional release via Rust/Soroban *(high priority)*
- [ ] **Full KYC/AML verification flow** — document upload, identity checks, screening *(medium)*
- [ ] **Advanced liquidity routing** — smart path selection across multiple anchors *(medium)*
- [ ] **Merchant payment tools** — payment links, invoicing, webhook callbacks *(medium)*
- [ ] **Business remittance APIs** — bulk transfers and B2B corridors *(medium)*
- [ ] **Admin dashboard** — internal tooling for ops and compliance teams *(medium)*
- [ ] **Mobile app** — React Native client for iOS and Android *(low)*
- [ ] **Terraform infra** — production-grade IaC for cloud deployment *(low)*
---
 
## Contributing
 
Contributions are welcome! Please read [Contributorsguiude.md](Contributorsguiude.md) before opening a PR.
 
```bash
# Fork the repo, then:
git checkout -b feature/your-feature
git commit -m "feat: describe your change"
git push origin feature/your-feature
# Open a pull request against main
```
 
---
 
## License
 
[MIT](LICENSE) © AfroPay-Stellar contributors
 