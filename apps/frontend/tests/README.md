# E2E & Stress Testing

This directory contains the Playwright-based end-to-end and concurrency
stress testing pipeline for the AfroPay remittance flow.

## Prerequisites

- Docker & Docker Compose v2
- Node.js >= 18
- Playwright Chromium (`npx playwright install chromium`)

## Quick Start

Everything runs through a single command from `apps/frontend`:

```bash
npm run test:stress
```

This will:

1. **Boot the full stack** via `docker-compose.yml` (PostgreSQL, Redis, NestJS
   API on :3001, Next.js frontend on :3000, Rust worker, Python analytics).
2. **Run the sequential Playwright E2E suite** — login, dashboard, form
   validation, transaction history, wallet setup, and negative auth tests.
3. **Run the concurrency stress test** — seeds up to 50 users and spins up
   50 headless browser instances that simultaneously log in, simulate a
   transfer, and confirm a remittance transaction.

When finished, an HTML report is written to `stress-report/index.html` with
per-user step timing, pass/fail breakdowns, and DB/health metrics captured
before and after the run.

## Individual Commands

| Command | Description |
| --- | --- |
| `npm run test:e2e` | Sequential Playwright E2E suite only (stack must be up) |
| `npm run test:stress:run` | Concurrency stress test only (stack must be up) |
| `npm run test:stress:e2e` | docker-compose up + E2E suite |
| `npm run test:stress` | Full pipeline: stack + E2E + stress + report |

## Stress Test Options

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `STRESS_CONCURRENCY` | `50` | Number of concurrent browser users |
| `E2E_BASE_URL` | `http://127.0.0.1:3000` | Frontend URL |
| `E2E_API_URL` | `http://127.0.0.1:3001` | API URL |
| `REPORT_DIR` | `apps/frontend/stress-report` | HTML report output |

Or flags on the direct runner:

```bash
node scripts/stress-test.mjs --concurrency 25 --seed-only
```

## Test Files

- `tests/e2e/remittance.spec.ts` — the sequential E2E scenario suite
- `tests/e2e/helpers.ts` — shared login/user/API helpers
- `scripts/stress-test.mjs` — the concurrency simulator (Node + Playwright)
- `scripts/run-stress.sh` — Docker Compose orchestration wrapper

## Design Notes

- **Isolated contexts**: every stress user gets a fresh browser context so
  no session state leaks between concurrent flows.
- **Seeding over UI**: users are registered via `POST /auth/register` before
  the browser run so the login form path stays deterministic.
- **Metrics probe**: the runner captures `/health` before and after the run;
  the HTML report renders the JSON so regressions in DB pool, Redis, or
  Horizon connectivity are visible at a glance.
- **Always local**: all tests run against the local docker-compose stack.
  No live testnet/mainnet traffic is ever generated (per issue scope).