# Spec: Real-Time Transaction Status Updates & Authorization Fix

## Overview
Implement real-time transaction status updates using Server-Sent Events (SSE) and fix authorization vulnerability in GET /transactions/:id endpoint. Add optional webhook callback support for transaction completion events.

**Key Goals:**
1. Fix authorization issue: prevent users from accessing other users' transactions
2. Enable real-time status updates via SSE stream
3. Add optional webhook callbacks for external integrations
4. Maintain backward compatibility with existing polling patterns

## Current Problems

### Problem 1: Authorization Vulnerability
- **Issue**: `GET /transactions/:id` endpoint has no ownership verification
- **Impact**: Any authenticated user can retrieve any transaction by guessing/knowing the UUID
- **Current Code**: `getTransaction(id)` in TransactionService only filters by ID, not userId
- **Risk Level**: HIGH - data exposure vulnerability

### Problem 2: No Real-Time Updates
- **Issue**: Frontend polls `GET /transactions/:id` on a timer (manual refresh)
- **Impact**: 
  - Delayed transaction status visibility
  - Unnecessary API load from polling
  - Poor UX for time-sensitive financial operations
- **Current Code**: BullMQ processor updates DB but doesn't notify frontend

### Problem 3: No External Notifications
- **Issue**: No way for external systems to be notified of transaction completion
- **Impact**: Cannot integrate with webhooks, analytics, or reporting systems
- **Current Code**: No callback mechanism in sendTransfer DTO

## Design Decisions

### 1. Authorization Fix
**Approach**: Add userId ownership check to `getTransaction()`
- **Location**: TransactionService.getTransaction() method
- **Behavior**: 
  - Accept optional `userId` parameter
  - Return 403 Forbidden if transaction belongs to different user
  - Controller passes `req.user.userId` to service
- **Backward Compat**: Existing code that calls without userId still works (unsafe), but controller enforces check

### 2. SSE Implementation
**Approach**: Use NestJS `@Sse()` decorator with Observable
- **Endpoint**: `GET /transactions/:id/stream`
- **Auth**: Protected by JwtAuthGuard, ownership verified
- **Flow**:
  1. Client establishes SSE connection with valid transaction ID
  2. Controller verifies userId ownership
  3. EventEmitter2 emits `transaction.status.changed` events from processor
  4. SSE endpoint listens and forwards to client
  5. Stream closes automatically on SUCCESS or FAILED status
- **Event Format**: `{ txId, status, stellarTxHash?, error? }`
- **Retry**: Browser automatically reconnects on connection loss

### 3. Webhook Callback System
**Approach**: Add `callbackUrl` field to SendTransferDto
- **Field**: `callbackUrl?: string` (optional, validated URL)
- **Trigger**: Called on job completion (SUCCESS or FAILED)
- **Implementation**: TransactionProcessor calls endpoint via Axios
- **Security**: 
  - Validate URL format (HTTPS only, no localhost in prod)
  - Sign payload with HMAC-SHA256 using webhook secret
  - Retry up to 3 times with exponential backoff
- **Payload**: `{ txId, status, stellarTxHash?, error?, timestamp, signature }`

### 4. Database Schema Updates
**New Fields in Transaction Model**:
- `callbackUrl` (String?, optional) - User's webhook endpoint
- `callbackStatus` (Enum: PENDING, DELIVERED, FAILED) - Webhook delivery status
- `callbackAttempts` (Int, default: 0) - Number of webhook attempts

**No breaking changes** - all fields optional with sensible defaults

### 5. EventEmitter2 Integration
**Setup**: 
- Import EventEmitterModule in TransactionModule
- Inject EventEmitter2 into TransactionProcessor and SSE handler
- Use typed events for type safety

**Events**:
- `transaction.status.changed` - Emitted after DB status update
- Payload: `{ txId: string, status, oldStatus, error? }`

## Tasks

### Task 1: Fix Authorization in TransactionController & Service
**Description**: Add userId ownership verification to getTransaction

**Acceptance Criteria**:
- ✅ GET /transactions/:id with userId mismatch returns 403
- ✅ GET /transactions/:id with matching userId returns transaction
- ✅ Unauthorized users cannot bypass via invalid JWT
- ✅ Error message is generic (don't leak transaction existence)

**Files to Modify**:
- `apps/api/src/transaction/transaction.controller.ts` - Pass userId to service
- `apps/api/src/transaction/transaction.service.ts` - Add userId parameter and check

**Implementation Steps**:
1. Update `getTransaction(txId: string)` to `getTransaction(txId: string, userId: string)`
2. Add: `const tx = await this.prisma.transaction.findUnique({ where: { id: txId } })`
3. Verify: `if (!tx || tx.userId !== userId) throw new ForbiddenException('Not found')`
4. Update controller to pass `req.user.userId`

---

### Task 2: Create SSE Endpoint for Real-Time Updates
**Description**: Implement GET /transactions/:id/stream using @Sse() decorator

**Acceptance Criteria**:
- ✅ SSE endpoint pushes updates when transaction status changes
- ✅ Stream respects ownership (403 if not owner)
- ✅ Auto-closes after SUCCESS or FAILED status
- ✅ Handles connection errors gracefully
- ✅ No events sent before connection established

**Files to Modify**:
- `apps/api/src/transaction/transaction.controller.ts` - Add @Sse() route
- `apps/api/src/transaction/transaction.service.ts` - Add method to subscribe to updates

**Implementation Steps**:
1. Install rxjs if not present: `npm install rxjs`
2. Import `@Sse()`, `MessageEvent` from @nestjs/common
3. Create controller method:
   ```typescript
   @Sse(':id/stream')
   streamTransactionUpdates(@Param('id') id: string, @Request() req: any)
   ```
4. Call service method that returns Observable<MessageEvent>
5. Service creates Observable that:
   - Verifies ownership upfront
   - Subscribes to EventEmitter2 `transaction.status.changed`
   - Filters events for this txId
   - Maps to MessageEvent format
   - Completes on terminal status

---

### Task 3: Emit Events from TransactionProcessor
**Description**: Emit status change events after DB updates

**Acceptance Criteria**:
- ✅ Events emitted immediately after successful DB update
- ✅ Event includes txId, status, oldStatus
- ✅ Events emitted for all status transitions (PENDING → RETRYING, RETRYING → FAILED, etc.)
- ✅ No events on duplicate updates

**Files to Modify**:
- `apps/api/src/transaction/transaction.processor.ts` - Inject EventEmitter2, emit after updates
- `apps/api/src/transaction/transaction.module.ts` - Import EventEmitterModule

**Implementation Steps**:
1. Add to TransactionModule imports: `EventEmitterModule.forRoot()`
2. Inject in processor: `constructor(private emitter: EventEmitter2, ...)`
3. After each DB update in processor:
   ```typescript
   this.emitter.emit('transaction.status.changed', {
     txId,
     status: newStatus,
     oldStatus: previousStatus,
     error: reason || null
   })
   ```

---

### Task 4: Add Webhook Callback Support
**Description**: Add callbackUrl field and implement webhook delivery

**Acceptance Criteria**:
- ✅ SendTransferDto includes optional `callbackUrl?: string`
- ✅ URL validated (HTTPS, no localhost in production)
- ✅ Webhook called within 5 seconds of job completion
- ✅ Payload signed with HMAC-SHA256
- ✅ Retries up to 3 times on delivery failure
- ✅ Webhook attempts tracked in DB

**Files to Modify**:
- `apps/api/prisma/schema.prisma` - Add callbackUrl, callbackStatus, callbackAttempts fields
- `apps/api/src/transaction/transaction.service.ts` - Update SendTransferDto, validate URL
- `apps/api/src/transaction/transaction.processor.ts` - Call webhook on completion
- `apps/api/src/transaction/transaction.controller.ts` - Update SendDto to include callbackUrl

**Implementation Steps**:
1. Update Prisma schema with new fields
2. Update SendTransferDto interface to include `callbackUrl?: string`
3. In `sendTransfer()`:
   - Validate callbackUrl if provided (URL format, HTTPS only)
   - Store in transaction record
4. In processor on SUCCESS/FAILED:
   - Call `sendWebhookCallback(txId, status)`
   - Method makes HTTP POST to callbackUrl with signed payload
   - Implements retry logic
   - Updates callbackStatus and callbackAttempts in DB

---

### Task 5: Write Integration Tests
**Description**: Test authorization fix, SSE endpoint, and webhook integration

**Acceptance Criteria**:
- ✅ Test 403 response when accessing other user's transaction
- ✅ Test SSE connection and event delivery
- ✅ Test SSE stream closes after terminal status
- ✅ Test webhook is called with correct signature
- ✅ Test webhook retries on failure
- ✅ All tests pass in CI/CD pipeline

**Files to Create/Modify**:
- `apps/api/src/transaction/transaction.controller.spec.ts` - NEW or updated
- `apps/api/src/transaction/transaction.service.spec.ts` - NEW or updated
- `apps/api/src/transaction/transaction.processor.spec.ts` - NEW or updated

**Implementation Steps**:
1. Create test module with test database
2. Test authorization: call GET /:id as different user, verify 403
3. Test SSE: establish connection, verify events received, verify stream closes
4. Test webhook: mock HTTP POST, verify called with signature, verify retries
5. Run: `npm run test`

---

## Data Model Changes

**Migration**: Add to Transaction model
```prisma
model Transaction {
  // ... existing fields ...
  callbackUrl     String?           /// Optional webhook URL for completion notification
  callbackStatus  CallbackStatus    @default(PENDING) /// Webhook delivery status
  callbackAttempts Int              @default(0) /// Number of webhook delivery attempts
}

enum CallbackStatus {
  PENDING
  DELIVERED
  FAILED
}
```

## Frontend Integration Guide

### Polling Pattern (Current - Keep Working)
```typescript
// Existing code continues to work
GET /transactions/:id → returns transaction object
```

### Real-Time Pattern (New - Recommended)
```typescript
const eventSource = new EventSource(`/transactions/${txId}/stream`, {
  headers: { Authorization: `Bearer ${token}` }
});

eventSource.onmessage = (event) => {
  const { txId, status, stellarTxHash, error } = JSON.parse(event.data);
  console.log(`Transaction ${txId} is now ${status}`);
  
  if (status === 'SUCCESS' || status === 'FAILED') {
    eventSource.close();
  }
};

eventSource.onerror = () => {
  console.error('Connection lost, falling back to polling...');
  eventSource.close();
};
```

### Webhook Pattern (For External Systems)
```bash
# Register webhook when sending transfer
POST /transactions/send
{
  "destinationPublicKey": "...",
  "amount": "100",
  "assetCode": "XLM",
  "callbackUrl": "https://example.com/webhooks/transactions"
}

# Webhook payload received at completion
{
  "txId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "SUCCESS",
  "stellarTxHash": "abc123...",
  "timestamp": "2026-06-25T10:30:00Z",
  "signature": "sha256=..."
}
```

## Rollout Strategy

**Phase 1**: Authorization fix only (high priority, no new features)
- Merge when complete
- Monitor for regressions

**Phase 2**: SSE endpoint (low risk, additive)
- Add in parallel, feature-flag if needed
- Keep polling working as fallback

**Phase 3**: Webhooks (complex, post-MVP)
- Can defer if needed
- Good for enterprise features later

## Success Metrics

- ✅ No more unauthorized transaction access (403 on mismatch)
- ✅ Real-time updates reduce polling traffic by 80%+
- ✅ Transaction completion feedback within 100ms of processor completion
- ✅ All tests passing
- ✅ Zero breaking changes to existing API contracts
