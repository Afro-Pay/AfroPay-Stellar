# Project Plan: Real-Time Transaction Status Updates & Authorization Fix

**Branch**: `feature/real-time-transactions`

## Overview

This project addresses three critical issues in the AfroPay-Stellar transaction system:

1. **Authorization Vulnerability** (HIGH PRIORITY): Users can access any transaction by ID
2. **No Real-Time Updates** (MEDIUM PRIORITY): Frontend must poll for status changes
3. **No External Webhooks** (LOW PRIORITY): External systems can't be notified of completion

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Browser)                       │
├─────────────────────────────────────────────────────────────────┤
│  Option 1: Polling           │  Option 2: SSE (Real-Time)       │
│  GET /transactions/:id       │  GET /transactions/:id/stream    │
│  (Every 2-5 seconds)         │  (EventSource connection)        │
└──────────────┬───────────────┴──────────────┬────────────────────┘
               │                             │
        ┌──────▼──────────────────────────────▼─────────┐
        │    NestJS API with JwtAuthGuard                │
        ├──────────────────────────────────────────────┤
        │ GET /transactions/:id                         │
        │  ✅ FIXED: Now checks userId ownership        │
        │  ✅ Returns 403 if not owner                  │
        │                                               │
        │ GET /transactions/:id/stream                  │
        │  🆕 NEW: SSE endpoint                         │
        │  Pushes real-time status updates              │
        │                                               │
        │ POST /transactions/send                       │
        │  ✨ ENHANCED: Supports callbackUrl parameter │
        └──────────────────┬──────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │         BullMQ Job Processor         │
        ├──────────────────────────────────────┤
        │ 1. Process payment on Stellar        │
        │ 2. Update transaction status in DB   │
        │ 3. Emit EventEmitter2 event          │
        │ 4. Call webhook callback (if set)    │
        │ 5. Retry on failure (3x exponential) │
        └──────────────────┬──────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │  PostgreSQL Database                 │
        ├──────────────────────────────────────┤
        │ Transaction (id, userId, status)     │
        │ NEW: callbackUrl, callbackStatus     │
        └──────────────────────────────────────┘
```

## Key Components

### 1. Authorization Fix

**Problem**: `getTransaction(id)` returns ANY transaction

```typescript
// BEFORE (Vulnerable)
async getTransaction(txId: string) {
  return this.prisma.transaction.findUnique({ where: { id: txId } });
}

// AFTER (Secure)
async getTransaction(txId: string, userId: string) {
  const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
  if (!tx || tx.userId !== userId) {
    throw new ForbiddenException('Not found'); // Generic message
  }
  return tx;
}
```

**Controller**:
```typescript
@Get(':id')
get(@Param('id') id: string, @Request() req: any) {
  return this.txService.getTransaction(id, req.user.userId); // Pass userId
}
```

### 2. Real-Time SSE Endpoint

**Mechanism**:
- Frontend establishes `EventSource` connection to `/transactions/:id/stream`
- Controller verifies userId ownership (same as regular GET)
- Service returns Observable that listens to EventEmitter2 events
- When processor emits `transaction.status.changed`, event pushed to client
- Stream auto-closes when status becomes SUCCESS or FAILED

**Example**:
```typescript
@Sse(':id/stream')
@HttpCode(200)
streamTransactionUpdates(@Param('id') id: string, @Request() req: any) {
  return this.txService.streamTransactionUpdates(id, req.user.userId);
}
```

**Service**:
```typescript
streamTransactionUpdates(txId: string, userId: string): Observable<MessageEvent> {
  return new Observable(observer => {
    // Verify ownership upfront
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx || tx.userId !== userId) {
      observer.error(new ForbiddenException('Not found'));
      return;
    }

    // Listen for events
    const listener = (data: any) => {
      if (data.txId === txId) {
        observer.next({ data: JSON.stringify(data) });
        if (['SUCCESS', 'FAILED'].includes(data.status)) {
          observer.complete();
        }
      }
    };

    this.eventEmitter.on('transaction.status.changed', listener);
    return () => this.eventEmitter.off('transaction.status.changed', listener);
  });
}
```

### 3. EventEmitter2 Integration

**Setup in TransactionModule**:
```typescript
@Module({
  imports: [
    BullModule.registerQueue({ name: 'transactions' }),
    EventEmitterModule.forRoot(), // NEW
    // ...
  ],
  controllers: [TransactionController],
  providers: [TransactionService, TransactionProcessor],
})
export class TransactionModule {}
```

**In Processor**:
```typescript
@Processor('transactions')
export class TransactionProcessor {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private eventEmitter: EventEmitter2, // NEW
  ) {}

  @Process('process')
  async handleTransaction(job: Job) {
    // ... existing code ...
    
    // After SUCCESS
    await this.prisma.transaction.update({
      where: { id: txId },
      data: { status: 'SUCCESS', stellarTxHash: result.hash },
    });
    
    this.eventEmitter.emit('transaction.status.changed', {
      txId,
      status: 'SUCCESS',
      oldStatus: 'PENDING',
    });
  }
}
```

### 4. Webhook Callbacks (Optional)

**New Transaction Fields**:
```prisma
callbackUrl     String?           // User's webhook endpoint
callbackStatus  CallbackStatus    @default(PENDING)
callbackAttempts Int              @default(0)
```

**In sendTransfer()**:
```typescript
async sendTransfer(userId: string, dto: SendTransferDto) {
  // Validate callbackUrl if provided
  if (dto.callbackUrl) {
    validateWebhookUrl(dto.callbackUrl);
  }
  
  const tx = await this.prisma.transaction.create({
    data: {
      // ... existing fields ...
      callbackUrl: dto.callbackUrl ?? null,
    },
  });
  // ...
}
```

**In Processor**:
```typescript
if (['SUCCESS', 'FAILED'].includes(newStatus)) {
  if (tx.callbackUrl) {
    await this.sendWebhookCallback(txId, newStatus);
  }
}

private async sendWebhookCallback(txId: string, status: string) {
  // Call webhook with retries, sign payload
  const payload = { txId, status, timestamp: new Date() };
  const signature = generateHmacSignature(payload, WEBHOOK_SECRET);
  
  for (let i = 0; i < 3; i++) {
    try {
      await axios.post(tx.callbackUrl, { ...payload, signature });
      await this.prisma.transaction.update({
        where: { id: txId },
        data: { callbackStatus: 'DELIVERED', callbackAttempts: i + 1 },
      });
      return;
    } catch (err) {
      if (i === 2) {
        await this.prisma.transaction.update({
          where: { id: txId },
          data: { callbackStatus: 'FAILED', callbackAttempts: i + 1 },
        });
      }
      await delay(Math.pow(2, i) * 1000); // Exponential backoff
    }
  }
}
```

## Implementation Tasks

### Phase 1: Authorization Fix (MUST DO FIRST)
- [ ] Update `TransactionService.getTransaction()` to accept userId
- [ ] Update `TransactionController.get()` to pass userId
- [ ] Add 403 test cases
- [ ] Test with curl/Postman

### Phase 2: Real-Time SSE
- [ ] Install rxjs: `npm install rxjs` (if needed)
- [ ] Add EventEmitterModule to TransactionModule
- [ ] Create `streamTransactionUpdates()` in service
- [ ] Add `@Sse(':id/stream')` to controller
- [ ] Test with curl: `curl -N -H "Authorization: Bearer TOKEN" http://localhost:3000/transactions/ID/stream`

### Phase 3: Event Emission
- [ ] Inject EventEmitter2 in TransactionProcessor
- [ ] Emit after each status update
- [ ] Test with SSE endpoint

### Phase 4: Webhooks (Can be deferred)
- [ ] Add fields to Prisma schema
- [ ] Update SendTransferDto
- [ ] Validate and store callbackUrl
- [ ] Implement webhook delivery in processor
- [ ] Write tests

### Phase 5: Integration Tests
- [ ] Test authorization 403
- [ ] Test SSE event delivery
- [ ] Test SSE stream closure
- [ ] Test webhook signature & retries (if implemented)

## File Changes Summary

**Modified**:
- `apps/api/src/transaction/transaction.controller.ts`
- `apps/api/src/transaction/transaction.service.ts`
- `apps/api/src/transaction/transaction.processor.ts`
- `apps/api/src/transaction/transaction.module.ts`
- `apps/api/prisma/schema.prisma` (if webhooks implemented)

**New**:
- `apps/api/src/transaction/transaction.stream.spec.ts` (tests)
- Optionally: webhook utility file

## Testing Strategy

### Unit Tests
- Authorization: call getTransaction with mismatched userId
- Event emission: mock EventEmitter2, verify emitted events
- Webhook validation: test URL format validation

### Integration Tests
- Full transaction flow with authorization checks
- SSE connection and event delivery
- Webhook delivery with retries

### Manual Testing
```bash
# 1. Create transaction as User A
curl -X POST http://localhost:3000/transactions/send \
  -H "Authorization: Bearer USER_A_TOKEN" \
  -d '{"destinationPublicKey": "...", "amount": "100", ...}'

# 2. Try to access as User B (should get 403)
curl http://localhost:3000/transactions/TX_ID \
  -H "Authorization: Bearer USER_B_TOKEN"

# 3. Access as User A (should succeed)
curl http://localhost:3000/transactions/TX_ID \
  -H "Authorization: Bearer USER_A_TOKEN"

# 4. Stream updates as User A (SSE)
curl -N http://localhost:3000/transactions/TX_ID/stream \
  -H "Authorization: Bearer USER_A_TOKEN"
```

## Database Migration

Create migration for webhook fields:
```bash
npx prisma migrate dev --name add_webhook_callbacks
```

Generated migration will:
- Add `callbackUrl` (nullable String)
- Add `callbackStatus` enum (PENDING, DELIVERED, FAILED)
- Add `callbackAttempts` (Int, default 0)

## Rollout Plan

1. **Day 1**: Deploy authorization fix (Phase 1)
   - Highest priority security fix
   - Backward compatible
   - Monitor for issues

2. **Day 2**: Deploy SSE (Phases 2-3)
   - Additive feature, no breaking changes
   - Polling still works as fallback
   - Monitor adoption

3. **Day 3+**: Deploy webhooks (Phase 4)
   - Post-MVP feature
   - Can iterate on implementation
   - Good for enterprise integrations

## Monitoring & Alerts

Watch for:
- Authorization errors (should be rare after fix)
- SSE connection failures
- Webhook delivery failures
- Transaction processing latency

## Success Criteria

- ✅ No unauthorized transaction access (tests pass)
- ✅ Real-time updates working (SSE events received)
- ✅ All existing tests passing
- ✅ Zero breaking changes to API
- ✅ Documentation updated

---

**Created**: June 25, 2026
**Branch**: `feature/real-time-transactions`
**Status**: Ready for implementation
