# AfroPay-Stellar
AfroPay-Stellar is a cross-border remittance platform built on the Stellar blockchain.
It provides fast, low-cost, and secure global money transfers, with a focus on Africa and Nigeria.
 

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/3ebd4b8d-079f-4cb0-a820-4fc86b8cf0ac" />


<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/29f32b93-b8e8-46c1-bb11-d129f3e60d71" />

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/b9378c93-224e-45e4-b9de-c2f41813fd62" />

https://afro-pay-stellar.vercel.app/login

website https://carbon-truth-chain.lovable.app/
---

## Overview

AfroPay-Stellar simplifies international money transfers by leveraging blockchain technology:

- Near-instant transactions (3–5 seconds)
- Low transaction fees
- Multi-currency support (NGN, USD, EUR, USDC)
- Seamless fiat-to-crypto and crypto-to-fiat integration via Stellar anchors

---

## Architecture

AfroPay-Stellar is structured as a **polyglot microservices architecture**:
Client (Next.js)
↓
API Gateway (NestJS - TypeScript)
↓
| Wallet Service (TypeScript) |
| Transaction Service (TypeScript)|
| Anchor Service (TypeScript) |
  ↓
Queue (Redis / BullMQ)
↓
| Rust Worker (Blockchain Engine) |
  ↓
| Python Services (Fraud/Risk) |
  ↓

PostgreSQL + Redis

### Detailed architecture

The production shape is a polyglot service graph. The Next.js frontend talks to
the NestJS API, the API persists application state in PostgreSQL through Prisma,
Redis backs asynchronous jobs and cache state, the Rust worker handles Stellar
execution, and Python analytics produces fraud and risk signals.

```mermaid
flowchart LR
  user["User / Wallet holder"]
  frontend["Next.js frontend\napps/frontend"]
  api["NestJS API\napps/api"]
  wallet["Wallet service\nkeys, balances, trustlines"]
  tx["Transaction service\nquotes, transfers, simulations"]
  anchor["Anchor service\ndeposit and withdrawal rails"]
  redis["Redis / BullMQ\njobs, retries, cache"]
  postgres["PostgreSQL + Prisma\nusers, wallets, transfers, audit data"]
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


---

## Tech Stack

**Languages:**

- TypeScript: Backend APIs and frontend
- Rust: Blockchain execution and smart contracts
- Python: Fraud detection and analytics
- JavaScript: Minimal utilities

**Frameworks & Tools:**

- Next.js (Frontend)
- NestJS (Backend)
- Stellar SDK
- PostgreSQL + Prisma
- Redis / BullMQ
- Docker & Docker Compose
- Terraform (optional)

---

## Features

**Wallet System:**

- Generate Stellar wallets
- Secure key storage and management
- Balance tracking (XLM, USDC, NGN)

**Cross-Border Transfers:**

- Multi-currency transfers
- Stellar path payments for currency conversion
- Real-time FX rates
- Local transfer simulation for USDC, NGN, and XLM path-payment scenarios,
  including trustline and exchange-rate checks before live submission

**Transaction Engine:**

- Async processing via queue
- Retry and failure handling
- Transaction tracking and logging

**Anchor Integration:**

- Deposit and withdrawal endpoints
- Multi-anchor fallback support
- Liquidity routing

**Security & Compliance:**

- Encrypted private keys
- JWT authentication
- KYC/AML-ready
- Rate limiting and audit logs

**Intelligence Layer:**

- Fraud detection
- Risk scoring
- Transaction monitoring

---

## Project Structure


/apps
/frontend # Next.js (TypeScript)
/api # NestJS backend

/services
/rust-worker # Blockchain execution engine
/python-analytics# Fraud detection & analytics

/packages
/stellar-wrapper
/shared-types

/infrastructure
/docker
/terraform

/scripts
setup.sh
deploy.sh


---

## Getting Started

### Prerequisites

- Node.js v18+
- Docker & Docker Compose
- PostgreSQL
- Redis

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/remitx.git
cd remitx

# Copy environment variables
cp .env.example .env

# Run with Docker
docker-compose up --build
Running Locally (Without Docker)
# Install dependencies
npm install

# Run backend
cd apps/api
npm run start:dev

# Run frontend
cd apps/frontend
npm run dev
Environment Variables

Create a .env file with the following keys:

DATABASE_URL=postgresql://user:password@localhost:5432/remitx
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_secret_key
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
Testing
# Run unit tests
npm run test

# Run linting
npm run lint

# Run the transfer simulation harness
cd apps/api
npm test -- transfer-simulation.service.spec.ts
Docker
# Build and run all services
docker-compose up --build

# Stop services
docker-compose down
Roadmap
Multi-signature wallets
Escrow smart contracts (Rust/Soroban)
Advanced liquidity routing
Admin dashboard
Mobile app (React Native)
Contributing

Contributions are welcome:

# Fork the repo
# Create a feature branch
git checkout -b feature/your-feature

# Commit changes
git commit -m "Add feature"

# Push and open a pull request
git push origin feature/your-feature
License

MIT License
