# ADR 0001: BullMQ for Asynchronous Settlement

## Status

Accepted

## Context

AfroPay-Stellar processes cross-border remittance transactions that involve multiple Stellar operations: trustline establishment, path payment queries, and asset transfers. The API must respond quickly to user requests while actual Stellar network calls can take 3–15 seconds due to network latency and blockchain consensus. Blocking the HTTP request thread on Stellar operations creates poor user experience and reduces API throughput.

## Decision Drivers

1. **User Experience**: HTTP response latency must be <500ms; Stellar confirmation is asynchronous.
2. **API Scalability**: A single API instance must handle hundreds of concurrent requests without blocking.
3. **Reliability**: Failed Stellar operations must be retried without losing the request context.
4. **Observability**: The team needs visibility into which transactions succeeded, failed, or are stuck.
5. **Decoupling**: API and worker logic should be independently deployable and testable.

## Considered Options

### Option 1: Direct Stellar SDK Calls (Rejected)

Make Stellar calls synchronously in the NestJS API, blocking until settlement completes.

**Pros**:

- Simplest implementation
- No infrastructure overhead

**Cons**:

- HTTP request blocked for 3–15 seconds
- Poor user experience and P99 latency spikes
- Low throughput under load (connection pool exhaustion)
- No built-in retry logic for network failures
- Difficult to scale horizontally

### Option 2: BullMQ + Redis (Chosen)

Queue settlement jobs in BullMQ (Redis-backed). API enqueues, worker consumes and executes Stellar calls, then reports status.

**Pros**:

- API responds immediately; HTTP latency decoupled from Stellar latency
- Built-in retry with exponential backoff
- Persistent queue survives process restarts
- Full audit trail of job attempts
- Horizontal scaling: multiple workers consume the same queue
- Native NestJS integration via `@nestjs/bull`

**Cons**:

- Additional Redis dependency
- Slightly more operational complexity
- Requires polling or WebSocket for frontend status updates

### Option 3: AWS SQS + Lambda (Rejected)

Offload to AWS managed services.

**Pros**:

- No Redis operations overhead
- AWS-managed durability

**Cons**:

- Vendor lock-in
- Cross-border remittances require low-latency local fulfillment
- Cold start latency on Lambda
- Adds AWS costs and credential complexity
- Overkill for a single microservice ecosystem

## Decision Outcome

**Chosen: BullMQ + Redis**

The API (`apps/api`) enqueues settlement jobs to BullMQ when a transfer is accepted:

```typescript
// apps/api/src/transaction/transaction.service.ts
await this.settleQueue.add(
  "settle-transfer",
  {
    transferId: transfer.id,
    sender: transfer.sender,
    recipient: transfer.recipient,
    amount: transfer.amount,
    // ...
  },
  { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
);
```

The Rust worker (`services/rust-worker`) consumes the queue:

```rust
// services/rust-worker/src/main.rs
async fn process_settlement_job(job: Job) -> Result<(), JobError> {
    // 1. Load job data
    // 2. Build Stellar transactions (payment, trustlines, etc.)
    // 3. Submit to Horizon and Soroban
    // 4. Write settlement record to PostgreSQL
    // 5. Return success or retry
}
```

The frontend polls the API for transfer status or uses server-sent events (SSE) for real-time updates.

## Consequences

### Positive

1. **API throughput increases** significantly; HTTP latency no longer tied to blockchain confirmation.
2. **User experience improves**; users see immediate feedback while work happens asynchronously.
3. **Reliability**: Jobs survive process crashes, network hiccups, and transient failures via automatic retries.
4. **Observability**: BullMQ admin UI and Redis commands provide full job history.
5. **Decoupling**: API and worker can scale independently. Worker upgrades don't affect API availability.
6. **Testing**: Jobs are unit-testable in isolation; mocking Stellar responses is straightforward.

### Negative

1. **Operational complexity**: Redis becomes a critical dependency; must be monitored and backed up.
2. **Debugging**: Asynchronous failures are harder to trace; requires strong logging and correlation IDs.
3. **Status consistency**: Frontend must poll or subscribe to real-time channels; can't rely on a single HTTP response.
4. **Potential stale jobs**: Long-running or hung workers can leave jobs unprocessed; requires monitoring thresholds.

## Links

- Related: [ADR 0005: Deterministic Keypair Derivation](./0005-deterministic-keypair-derivation.md) — worker uses deterministic keys for Stellar operations
- Reference: [Architecture Overview](../architecture.md#storage-and-messaging)
- Reference: [BullMQ Documentation](https://docs.bullmq.io/)
- Reference: [Stellar Horizon API](https://developers.stellar.org/api/introduction/curl-examples)
