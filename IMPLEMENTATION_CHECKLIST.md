# Implementation Checklist

## Phase 1: Authorization Fix ⭐ HIGH PRIORITY

### 1.1 Update TransactionService
- [ ] Add `userId` parameter to `getTransaction()` method
- [ ] Add ownership check: `if (!tx || tx.userId !== userId) throw ForbiddenException`
- [ ] Generic error message (don't leak transaction existence)

**File**: `apps/api/src/transaction/transaction.service.ts`

```typescript
// Replace this:
async getTransaction(txId: string) {
  return this.prisma.transaction.findUnique({ where: { id: txId } });
}

// With this:
async getTransaction(txId: string, userId: string) {
  const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
  if (!tx || tx.userId !== userId) {
    throw new ForbiddenException('Not found');
  }
  return tx;
}
```

### 1.2 Update TransactionController
- [ ] Import `ForbiddenException` from @nestjs/common if not already imported
- [ ] Pass `req.user.userId` to `getTransaction()` call

**File**: `apps/api/src/transaction/transaction.controller.ts`

```typescript
// Replace this:
@Get(':id')
get(@Param('id') id: string) {
  return this.txService.getTransaction(id);
}

// With this:
@Get(':id')
get(@Param('id') id: string, @Request() req: any) {
  return this.txService.getTransaction(id, req.user.userId);
}
```

### 1.3 Write Authorization Tests
- [ ] Test 403 when accessed by different user
- [ ] Test 200 when accessed by owner
- [ ] Test 403 for non-existent transaction (don't leak existence)
- [ ] Ensure JwtAuthGuard still works

**File**: `apps/api/src/transaction/transaction.controller.spec.ts`

```typescript
describe('GET /transactions/:id - Authorization', () => {
  it('should return 403 when accessed by different user', async () => {
    const tx = await createTransaction(userA.id);
    const result = await request(app.getHttpServer())
      .get(`/transactions/${tx.id}`)
      .set('Authorization', `Bearer ${tokenUserB}`);
    expect(result.status).toBe(403);
  });

  it('should return 200 when accessed by owner', async () => {
    const tx = await createTransaction(userA.id);
    const result = await request(app.getHttpServer())
      .get(`/transactions/${tx.id}`)
      .set('Authorization', `Bearer ${tokenUserA}`);
    expect(result.status).toBe(200);
    expect(result.body.id).toBe(tx.id);
  });

  it('should return 403 for non-existent transaction', async () => {
    const result = await request(app.getHttpServer())
      .get(`/transactions/nonexistent-id`)
      .set('Authorization', `Bearer ${tokenUserA}`);
    expect(result.status).toBe(403);
  });
});
```

### 1.4 Verify
- [ ] Run: `npm run test` in `apps/api`
- [ ] All authorization tests pass
- [ ] No other tests broken
- [ ] Manual test with curl

---

## Phase 2: Real-Time SSE Endpoint

### 2.1 Update TransactionModule
- [ ] Add `EventEmitterModule.forRoot()` to imports
- [ ] Verify BullModule and other imports still present

**File**: `apps/api/src/transaction/transaction.module.ts`

```typescript
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'transactions' }),
    EventEmitterModule.forRoot(), // NEW
    // ... other imports
  ],
  controllers: [TransactionController],
  providers: [TransactionService, TransactionProcessor],
})
export class TransactionModule {}
```

### 2.2 Add SSE Method to Service
- [ ] Create `streamTransactionUpdates(txId, userId)` method
- [ ] Verify ownership before returning Observable
- [ ] Return Observable that subscribes to EventEmitter2
- [ ] Filter events for this txId
- [ ] Map to MessageEvent format
- [ ] Complete Observable when status is SUCCESS or FAILED

**File**: `apps/api/src/transaction/transaction.service.ts`

```typescript
import { Observable } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MessageEvent } from '@nestjs/common';

streamTransactionUpdates(txId: string, userId: string): Observable<MessageEvent> {
  return new Observable(observer => {
    // Verify ownership upfront
    this.prisma.transaction.findUnique({ where: { id: txId } })
      .then(tx => {
        if (!tx || tx.userId !== userId) {
          throw new ForbiddenException('Not found');
        }

        // Subscribe to events
        const handleStatusChange = (data: any) => {
          if (data.txId === txId) {
            observer.next({
              data: JSON.stringify({
                txId: data.txId,
                status: data.status,
                stellarTxHash: data.stellarTxHash || null,
                error: data.error || null,
                timestamp: new Date().toISOString(),
              }),
            });

            if (['SUCCESS', 'FAILED'].includes(data.status)) {
              observer.complete();
            }
          }
        };

        this.eventEmitter.on('transaction.status.changed', handleStatusChange);

        return () => {
          this.eventEmitter.off('transaction.status.changed', handleStatusChange);
        };
      })
      .catch(err => observer.error(err));
  });
}
```

### 2.3 Add SSE Route to Controller
- [ ] Import `@Sse()` and `MessageEvent` from @nestjs/common
- [ ] Create new route: `@Sse(':id/stream')`
- [ ] Call service method with both txId and userId
- [ ] Handle @Request() to extract userId

**File**: `apps/api/src/transaction/transaction.controller.ts`

```typescript
import { Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';

@Sse(':id/stream')
@UseGuards(JwtAuthGuard)
streamUpdates(
  @Param('id') id: string,
  @Request() req: any,
): Observable<MessageEvent> {
  return this.txService.streamTransactionUpdates(id, req.user.userId);
}
```

### 2.4 Verify Installation
- [ ] Check if `rxjs` is in `apps/api/package.json`
- [ ] If missing: `cd apps/api && npm install rxjs`
- [ ] Verify `@nestjs/event-emitter` is in package.json
- [ ] If missing: `npm install @nestjs/event-emitter`

### 2.5 Test SSE Endpoint
- [ ] Run: `npm run start:dev` in `apps/api`
- [ ] Open another terminal
- [ ] Manual test with curl:
  ```bash
  curl -N http://localhost:3000/transactions/SOME_VALID_ID/stream \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```
- [ ] Should show connection without immediate output
- [ ] Will show events once processor emits them

---

## Phase 3: Event Emission from Processor

### 3.1 Inject EventEmitter2 in Processor
- [ ] Add import: `import { EventEmitter2 } from '@nestjs/event-emitter'`
- [ ] Inject in constructor: `constructor(private emitter: EventEmitter2, ...)`

**File**: `apps/api/src/transaction/transaction.processor.ts`

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';

@Processor('transactions')
export class TransactionProcessor {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private emitter: EventEmitter2, // NEW
  ) {}
  
  // ... rest of class
}
```

### 3.2 Emit Event After SUCCESS
- [ ] After `prisma.transaction.update()` on SUCCESS
- [ ] Emit: `transaction.status.changed` event
- [ ] Include: txId, status, oldStatus, timestamp

**File**: `apps/api/src/transaction/transaction.processor.ts` - in `handleTransaction()` method

```typescript
// After successful update:
await this.prisma.transaction.update({
  where: { id: txId },
  data: {
    status: 'SUCCESS',
    stellarTxHash: result.hash,
    retryAttempts: job.attemptsMade,
    lastFailureReason: null,
    failedAt: null,
  },
});

// NEW: Emit event
this.emitter.emit('transaction.status.changed', {
  txId,
  status: 'SUCCESS',
  oldStatus: 'PENDING',
  stellarTxHash: result.hash,
  error: null,
});

this.logger.log(`Transaction ${txId} succeeded: ${result.hash}`);
```

### 3.3 Emit Event After RETRYING/FAILED
- [ ] After `prisma.transaction.update()` on error
- [ ] Emit: `transaction.status.changed` event
- [ ] Include: error message

**File**: `apps/api/src/transaction/transaction.processor.ts` - in catch block

```typescript
const newStatus = isFinalAttempt ? 'FAILED' : 'RETRYING';
await this.prisma.transaction.update({
  where: { id: txId },
  data: {
    status: newStatus,
    retryAttempts: attempt,
    lastFailureReason: reason,
    failedAt: isFinalAttempt ? new Date() : null,
  },
});

// NEW: Emit event
this.emitter.emit('transaction.status.changed', {
  txId,
  status: newStatus,
  oldStatus: previousStatus,
  error: reason,
});

this.logger.error(
  `Transaction ${txId} attempt ${attempt}/${attempts} failed: ${reason}`,
);
```

### 3.4 Test Event Emission
- [ ] Set up test with EventEmitter2 mock
- [ ] Verify event emitted after status update
- [ ] Verify event payload includes correct fields

---

## Phase 4: Webhook Callbacks (OPTIONAL - Can Defer)

### 4.1 Update Prisma Schema
**File**: `apps/api/prisma/schema.prisma`

```prisma
model Transaction {
  // ... existing fields ...
  callbackUrl     String?           /// Optional webhook URL
  callbackStatus  CallbackStatus    @default(PENDING)
  callbackAttempts Int              @default(0)
}

enum CallbackStatus {
  PENDING
  DELIVERED
  FAILED
}
```

### 4.2 Create Database Migration
```bash
cd apps/api
npx prisma migrate dev --name add_webhook_callbacks
```

### 4.3 Update SendTransferDto
**File**: `apps/api/src/transaction/transaction.service.ts`

```typescript
export interface SendTransferDto {
  destinationPublicKey: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
  callbackUrl?: string; // NEW
}
```

### 4.4 Update Controller DTO
**File**: `apps/api/src/transaction/transaction.controller.ts`

```typescript
class SendDto implements SendTransferDto {
  @IsString() destinationPublicKey: string;
  @IsString() amount: string;
  @IsString() assetCode: string;
  @IsOptional() @IsString() assetIssuer?: string;
  @IsOptional() @IsString() memo?: string;
  @IsOptional() @IsUrl() callbackUrl?: string; // NEW - validate URL format
}
```

### 4.5 Validate and Store callbackUrl
**File**: `apps/api/src/transaction/transaction.service.ts`

```typescript
async sendTransfer(userId: string, dto: SendTransferDto) {
  // Validate callbackUrl if provided
  if (dto.callbackUrl) {
    validateWebhookUrl(dto.callbackUrl);
  }

  const tx = await this.prisma.transaction.create({
    data: {
      userId,
      walletId: wallet.id,
      destination: dto.destinationPublicKey,
      amount: dto.amount,
      assetCode: dto.assetCode,
      assetIssuer: dto.assetIssuer ?? null,
      memo: dto.memo ?? null,
      status: 'PENDING',
      callbackUrl: dto.callbackUrl ?? null, // NEW
    },
  });

  // ... rest of method
}
```

### 4.6 Implement Webhook Delivery
**File**: `apps/api/src/transaction/transaction.processor.ts`

```typescript
import axios from 'axios';
import crypto from 'crypto';

// After job completion (SUCCESS or FAILED):
if (['SUCCESS', 'FAILED'].includes(newStatus)) {
  const tx = await this.prisma.transaction.findUnique({
    where: { id: txId }
  });
  
  if (tx?.callbackUrl) {
    await this.sendWebhookCallback(txId, newStatus);
  }
}

// New method:
private async sendWebhookCallback(txId: string, status: string) {
  const tx = await this.prisma.transaction.findUnique({
    where: { id: txId }
  });
  if (!tx?.callbackUrl) return;

  const payload = {
    txId,
    status,
    stellarTxHash: tx.stellarTxHash || null,
    timestamp: new Date().toISOString(),
  };

  const signature = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET || 'secret')
    .update(JSON.stringify(payload))
    .digest('hex');

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(tx.callbackUrl, {
        ...payload,
        signature: `sha256=${signature}`,
      }, {
        timeout: 5000,
      });

      await this.prisma.transaction.update({
        where: { id: txId },
        data: {
          callbackStatus: 'DELIVERED',
          callbackAttempts: attempt,
        },
      });
      
      this.logger.log(`Webhook delivered for ${txId}`);
      return;
    } catch (err) {
      this.logger.warn(
        `Webhook attempt ${attempt}/3 failed for ${txId}: ${err.message}`
      );

      if (attempt === 3) {
        await this.prisma.transaction.update({
          where: { id: txId },
          data: {
            callbackStatus: 'FAILED',
            callbackAttempts: attempt,
          },
        });
      } else {
        await new Promise(resolve => 
          setTimeout(resolve, Math.pow(2, attempt - 1) * 1000)
        );
      }
    }
  }
}
```

### 4.7 Install axios (if needed)
```bash
cd apps/api
npm install axios
```

---

## Phase 5: Integration Tests

### 5.1 Create SSE Test Suite
**File**: `apps/api/src/transaction/transaction.stream.spec.ts`

```typescript
describe('Transaction SSE Streaming', () => {
  it('should push status updates via SSE', async () => {
    // Create transaction
    const tx = await createTransaction(user.id);
    
    // Connect to SSE
    const eventSource = new EventSource(
      `http://localhost:3000/transactions/${tx.id}/stream`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Simulate processor update
    await emitTransactionStatusChange(tx.id, 'SUCCESS');

    // Verify event received
    const event = await waitForEvent(eventSource);
    expect(JSON.parse(event.data).status).toBe('SUCCESS');
    
    // Stream should close after terminal status
    expect(eventSource.readyState).toBe(EventSource.CLOSED);
  });

  it('should return 403 for unauthorized user', async () => {
    const tx = await createTransaction(userA.id);
    const eventSource = new EventSource(
      `http://localhost:3000/transactions/${tx.id}/stream`,
      { headers: { Authorization: `Bearer ${tokenUserB}` } }
    );

    expect(eventSource.onerror).toBeCalled();
  });
});
```

### 5.2 Add to Existing Test Suite
- [ ] Update `transaction.service.spec.ts` with authorization tests
- [ ] Update `transaction.controller.spec.ts` with SSE route tests
- [ ] Run: `npm run test`

### 5.3 Manual Testing
```bash
# Terminal 1: Start dev server
npm run start:dev

# Terminal 2: Create transaction
curl -X POST http://localhost:3000/transactions/send \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationPublicKey": "GBUQWP3BOUZX34ULNQG23RQ6F4BFSRJDICTZARF7CJW34EFTITXL2YQ5",
    "amount": "100",
    "assetCode": "XLM"
  }'
# Copy txId from response

# Terminal 3: Stream updates
curl -N http://localhost:3000/transactions/TX_ID/stream \
  -H "Authorization: Bearer TOKEN"

# Terminal 2: Trigger processor (or wait for BullMQ to process)
# Should see status update in Terminal 3
```

---

## Verification Checklist

### Before Committing
- [ ] All tests pass: `npm run test`
- [ ] No linting errors: `npm run lint`
- [ ] Manual SSE test works with curl
- [ ] Authorization 403 test works
- [ ] No breaking changes to existing API

### Before Creating PR
- [ ] Branch is up to date with main
- [ ] Commit messages are clear
- [ ] Code follows project conventions
- [ ] Documentation updated (if needed)
- [ ] No console.logs left in code

### Code Review Checklist
- [ ] Authorization check is in place
- [ ] No generic user data leakage
- [ ] SSE closes properly on terminal status
- [ ] Event emission happens in correct places
- [ ] Tests cover main happy paths and error cases
- [ ] No new security vulnerabilities introduced

---

## Quick Commands

```bash
# Run API tests
cd apps/api && npm run test

# Run linting
cd apps/api && npm run lint

# Start dev server
cd apps/api && npm run start:dev

# Create migration
cd apps/api && npx prisma migrate dev --name MIGRATION_NAME

# View SSE in real time
curl -N http://localhost:3000/transactions/ID/stream \
  -H "Authorization: Bearer TOKEN"

# Test authorization 403
curl -i http://localhost:3000/transactions/OTHER_USERS_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Troubleshooting

### SSE Connection Not Receiving Events
1. Check if EventEmitter2 is properly imported in module
2. Verify event name matches: `transaction.status.changed`
3. Check processor is actually emitting events (add logger.log)
4. Verify txId filter logic is correct

### Authorization Tests Failing
1. Ensure userId is being passed from controller to service
2. Check ForbiddenException is imported
3. Verify ownership check is before returning transaction
4. Test with actual user tokens

### Webhook Not Being Called
1. Check callbackUrl is being stored in DB
2. Verify axios is installed
3. Check processor is reaching webhook code
4. Add logger statements to debug flow
5. Test webhook endpoint separately (mock server)

---

**Status**: Ready for implementation
**Created**: June 25, 2026
**Branch**: `feature/real-time-transactions`
