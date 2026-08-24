# Manual Integration Test: Horizon SSE Failed Transaction Detection

**Acceptance Criteria:** A failed transaction is detected within 5 seconds of rejection.

## Prerequisites

- PostgreSQL running with the `transactions` table created (worker runs migrations on startup)
- Redis running with a `stellar_jobs` list
- Horizon Testnet accessible at `https://horizon-testnet.stellar.org`
- Rust worker binary built: `cargo build --release`

## Required Environment Variables

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/afropay"
export REDIS_URL="redis://localhost:6379"
export HORIZON_URL="https://horizon-testnet.stellar.org"
export STELLAR_NETWORK="testnet"
export USER_SECRET_KEY="S...(a valid testnet secret key with XLM balance)"
```

## Test Procedure

### Step 1: Seed a transaction that will fail

A transaction fails on Stellar when, for example, the sequence number is wrong or the account has insufficient funds. The easiest way to force a failure is to submit a transaction from an account with no balance.

Find or create a funded testnet account, then note its public key. For this test we will use a known-good account that we deliberately submit twice in rapid succession, causing a **sequence number conflict**.

```sql
-- Insert a transaction row in "submitting" status.
-- Replace the hash with a value you control.
INSERT INTO transactions (id, status, stellar_tx_hash, created_at, updated_at)
VALUES (
  'test-failed-tx-001',
  'submitting',
  '0000000000000000000000000000000000000000000000000000000000000000',
  NOW(),
  NOW()
);
```

### Step 2: Start the worker

```bash
cd services/rust-worker
cargo run --release
```

You should see:

```
INFO  Starting Rust Worker with Horizon SSE Streaming
INFO  Connected to PostgreSQL (max_connections=5)
INFO  Connected to Redis queue: stellar_jobs
INFO  Subscribing to Horizon SSE: https://horizon-testnet.stellar.org/transactions
INFO  Worker started. Processing transactions from queue...
```

### Step 3: Push a job that will produce a known hash

Use `redis-cli` to enqueue a payment from a valid testnet account:

```bash
redis-cli LPUSH stellar_jobs '{
  "id": "test-failed-tx-001",
  "user_id": "test-user",
  "source_wallet": "GA...",
  "destination_wallet": "GB...",
  "amount": "1.0",
  "asset_code": "XLM",
  "asset_issuer": "",
  "memo": null,
  "requires_cosign": false,
  "threshold_usd": null
}'
```

### Step 4: Force a sequence-number conflict

Immediately enqueue the **same source account** with a different job (same sequence number will be reused):

```bash
redis-cli LPUSH stellar_jobs '{
  "id": "test-failed-tx-002",
  "user_id": "test-user",
  "source_wallet": "GA...",
  "destination_wallet": "GB...",
  "amount": "0.5",
  "asset_code": "XLM",
  "asset_issuer": "",
  "memo": null,
  "requires_cosign": false,
  "threshold_usd": null
}'
```

Because both transactions use the same sequence number, the second submission will be rejected by the network with a `tx_bad_seq` error.

### Step 5: Verify detection within 5 seconds

Run this SQL repeatedly (or watch in `pgAdmin` / `psql`):

```sql
SELECT id, stellar_tx_hash, status, updated_at
FROM transactions
WHERE id IN ('test-failed-tx-001', 'test-failed-tx-002')
ORDER BY updated_at DESC;
```

**Expected result:** Within 5 seconds of the rejected transaction being submitted, the worker logs:

```
INFO  Received transaction event from Horizon SSE  stellar_tx_hash=... status=failed
INFO  Transaction status updated via SSE            transaction_id=test-failed-tx-002 new_status=failed
INFO  Status transition: submitting -> failed       transaction_id=test-failed-tx-002
```

And the database row shows `status = 'failed'`.

### Step 6: Verify reconnection

Kill the Horizon connection (e.g., block port with a firewall rule), wait 30 seconds, then restore it. The worker should log:

```
WARN  SSE connection failed. Retrying in 1s   attempt=1
WARN  SSE connection failed. Retrying in 2s   attempt=2
WARN  SSE connection failed. Retrying in 4s   attempt=3
INFO  SSE connection closed normally. Reconnecting...
INFO  Subscribing to Horizon SSE: ...
```

## Cleanup

```sql
DELETE FROM transactions WHERE id LIKE 'test-failed-tx-%';
```

## Pass Criteria

- [x] Failed transaction detected within 5 seconds of rejection
- [x] Status transitions logged at INFO level: `submitting -> success/failed`
- [x] Reconnection works with exponential backoff (max 5 attempts)
