# Local Development Setup Guide

This guide provides a comprehensive step-by-step workflow to configure and run the AfroPay-Stellar ecosystem locally across all polyglot microservices.

---

## 🏗️ System Prerequisites

Ensure you have the following global dependencies installed on your machine:
* **Node.js**: v18.0.0 or higher
* **Rust**: v1.70.0+
* **Python**: v3.10 or v3.11
* **Docker & Docker Compose**

---

## ⚡ Step 1: Infrastructure Initialization (Database & Cache)

1. Copy the example environment file if you do not already have one:
   ```bash
   cp .env.example .env
   ```

2. Start the local PostgreSQL and Redis containers:
   ```bash
   docker-compose up -d postgres redis
   ```

3. Confirm both infrastructure services are healthy:
   ```bash
   docker compose ps
   ```

---

## 🚀 Step 2: Start the Full Stack

Start all required services with one command:

```bash
docker-compose up --build
```

This launches:
* `postgres`
* `redis`
* `api`
* `frontend`
* `rust-worker`
* `python-analytics`

If you only want to run the full stack in detached mode:

```bash
docker-compose up -d --build
```

---

## 🧩 Environment Variable Wiring

The Compose stack reads the repository root `.env` file and provides default local development values for all services.

Supported services and variable sources:
* `apps/api/` — uses `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `STELLAR_NETWORK`, `STELLAR_HORIZON_URL`, `ANCHOR_USDC_URL`, and `ANCHOR_NGN_URL`
* `apps/frontend/` — uses `NEXT_PUBLIC_API_URL`
* `services/rust-worker/` — uses `REDIS_URL`, `STELLAR_HORIZON_URL`, `METRICS_PORT`, and `WORKER_CONCURRENCY`
* `services/python-analytics/` — uses `DATABASE_URL` and `REDIS_URL`

Review `docs/environment-variables.md` for the full variable reference.
