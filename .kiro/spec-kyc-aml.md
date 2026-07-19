# Spec: KYC/AML Compliance Foundation

## Overview
Implement foundational KYC (Know Your Customer) and AML (Anti-Money Laundering) compliance infrastructure. Add KYC record storage, verification status tracking, and transaction limits based on verification tier.

**Key Goals:**
1. Store KYC records and verification status per user
2. Expose endpoints for KYC submission and status checking
3. Enforce transaction limits for unverified users
4. Provide pluggable hooks for KYC provider integration (Smile Identity, Onfido, etc.)
5. Support tiered verification (BASIC, FULL)

## Current Problems

### Problem 1: No KYC Infrastructure
- **Issue**: README claims "KYC/AML-ready" but no KYC model exists in database
- **Impact**: Cannot verify user identity before processing real-money transfers
- **Risk Level**: CRITICAL - compliance/regulatory risk
- **Current Code**: Prisma schema has no KycRecord model

### Problem 2: No Verification Endpoints
- **Issue**: No API endpoints for KYC submission or status checking
- **Impact**: Users have no way to submit documents or check verification status
- **Current Code**: No kyc.controller.ts or kyc.service.ts

### Problem 3: No Transaction Limits
- **Issue**: High-value transactions can proceed without identity verification
- **Impact**: 
  - Non-compliant with AML regulations
  - Increased fraud/money laundering risk
  - Potential fines or license suspension
- **Current Code**: Transaction service has no KYC checks

### Problem 4: No Provider Integration Framework
- **Issue**: Cannot plug in real KYC providers (Smile Identity, Onfido, IDology, etc.)
- **Impact**: No path to production compliance
- **Current Code**: No interfaces or adapter pattern defined

## Design Decisions

### 1. KYC Record Schema
**Approach**: Add comprehensive KycRecord model to Prisma

```prisma
model KycRecord {
  id                String        @id @default(uuid())
  userId            String        @unique
  status            KycStatus     @default(PENDING)
  tier              KycTier       @default(BASIC)
  documentType      String?       // e.g., "PASSPORT", "NATIONAL_ID", "DRIVERS_LICENSE"
  documentRef       String?       // e.g., S3 URL or external provider reference
  submittedAt       DateTime?
  reviewedAt        DateTime?
  expiresAt         DateTime?     // Document expiration date
  rejectionReason   String?       // Why verification was rejected
  riskScore         Float?        // Risk assessment score from provider
  metadata          Json?         // Provider-specific metadata
  
  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([status])
}

enum KycStatus {
  PENDING        // Awaiting submission
  SUBMITTED      // Submitted, awaiting review
  REVIEWING      // Under review by provider/internal
  APPROVED       // Verified and approved
  REJECTED       // Failed verification
  EXPIRED        // Document or verification expired
  SUSPENDED      // Temporarily suspended (review needed)
}

enum KycTier {
  NONE           // No verification
  BASIC          // Basic verification (selfie, ID scan)
  FULL           // Full verification (deep checks, background)
  ENHANCED       // Enhanced due diligence (high-risk profiles)
}
```

**Rationale**:
- `status` tracks verification lifecycle
- `tier` determines transaction limits
- `documentType` and `documentRef` enable document tracking
- `metadata` allows provider-specific data without schema changes
- `expiresAt` supports re-verification workflows
- Indexes optimize KYC lookups and status queries

### 2. KYC Submission Endpoint
**Approach**: POST /kyc/submit with document metadata

```typescript
interface KycSubmitDto {
  documentType: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE';
  documentUrl?: string;  // Or base64 data if small
  firstName: string;
  lastName: string;
  dateOfBirth: string;  // ISO 8601
  nationality: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
}
```

**Flow**:
1. User submits KYC data via endpoint
2. Service validates and stores in DB with status PENDING
3. Async job queues document for external provider (if configured)
4. Provider processes asynchronously
5. Webhook updates record when provider responds
6. User can check status via GET /kyc/status

**Why this approach**:
- Non-blocking: doesn't hold up transaction flow
- Provider-agnostic: works with any KYC vendor
- Trackable: users see submission status
- Auditable: all submissions logged

### 3. KYC Status Endpoint
**Approach**: GET /kyc/status returns verification status

**Response**:
```typescript
{
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'SUBMITTED' | 'REVIEWING' | 'EXPIRED',
  tier: 'NONE' | 'BASIC' | 'FULL' | 'ENHANCED',
  submittedAt: '2026-06-25T10:00:00Z',
  reviewedAt: '2026-06-25T10:30:00Z',
  expiresAt: '2027-06-25T00:00:00Z',
  rejectionReason?: 'Document quality too low' | 'Identity mismatch' | etc.,
  dailyLimit: 1000,  // USD equivalent
  dailyUsed: 250,    // Based on today's transactions
  remainingToday: 750,
}
```

**Why this approach**:
- Simple, read-only endpoint
- Includes transaction limits for frontend UX
- Provides rejection feedback for resubmission
- Non-authenticated users can check before sending money

### 4. Transaction Limit Guard
**Approach**: Custom NestJS Guard that checks KYC tier before transaction

```typescript
@Injectable()
export class KycGuard implements CanActivate {
  constructor(private kycService: KycService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const amount = parseFloat(request.body?.amount);

    if (!userId) throw new UnauthorizedException();

    const kycRecord = await this.kycService.getKycRecord(userId);
    const limit = this.getLimitForTier(kycRecord?.tier || 'NONE');

    if (amount > limit) {
      throw new ForbiddenException(
        `Daily limit for your KYC tier: $${limit}. Requested: $${amount}`
      );
    }

    return true;
  }

  private getLimitForTier(tier: string): number {
    const limits: Record<string, number> = {
      NONE: 100,        // $100/day unverified
      BASIC: 5000,      // $5k/day basic verification
      FULL: 50000,      // $50k/day full verification
      ENHANCED: 250000, // $250k/day enhanced (business accounts)
    };
    return limits[tier] || 100;
  }
}
```

**Application**:
```typescript
@Post('send')
@UseGuards(JwtAuthGuard, KycGuard)
send(@Request() req: any, @Body() dto: SendDto) {
  return this.txService.sendTransfer(req.user.userId, dto);
}
```

**Why this approach**:
- Reusable guard for consistency
- Configurable limits per tier
- Enforces limits before expensive Stellar operations
- Clear error messages for UX

### 5. Provider Integration Framework
**Approach**: Abstract interface for KYC providers

```typescript
// Pluggable provider interface
interface IKycProvider {
  // Initiate verification with provider
  submitVerification(record: KycRecord, data: any): Promise<{ providerRef: string }>;
  
  // Check status with provider
  checkStatus(providerRef: string): Promise<{
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    tier: 'BASIC' | 'FULL';
    riskScore?: number;
  }>;
  
  // Webhook handler (provider calls this)
  handleWebhook(payload: any): Promise<void>;
}

// Factory pattern
@Injectable()
export class KycProviderFactory {
  constructor(private configService: ConfigService) {}

  getProvider(): IKycProvider {
    const provider = this.configService.get('KYC_PROVIDER');
    switch (provider) {
      case 'smile-identity':
        return new SmileIdentityProvider(this.configService);
      case 'onfido':
        return new OnfidoProvider(this.configService);
      case 'mock':
      default:
        return new MockKycProvider(); // For development
    }
  }
}
```

**Supported Providers** (to be implemented):
- **SmileIdentity**: Africa-focused, fast, good for USSD
- **Onfido**: Global, enterprise-grade
- **IDology**: US/Latin America focused
- **Mock**: Development/testing

### 6. Transaction Limit Tracking
**Approach**: Track daily spend per user

```typescript
// In TransactionService
async sendTransfer(userId: string, dto: SendTransferDto) {
  const kycRecord = await this.kycService.getKycRecord(userId);
  const todaySpent = await this.getTodaysSpent(userId);
  const limit = this.getLimitForTier(kycRecord?.tier);

  const newTotal = todaySpent + parseFloat(dto.amount);
  if (newTotal > limit) {
    throw new ForbiddenException(
      `Daily limit exceeded. Used: $${todaySpent}, Limit: $${limit}`
    );
  }

  // Proceed with transaction
  return this.createTransaction(userId, dto);
}

private async getTodaysSpent(userId: string): Promise<number> {
  const today = new Date().toDateString();
  const txs = await this.prisma.transaction.findMany({
    where: {
      userId,
      status: 'SUCCESS',
      createdAt: {
        gte: new Date(today),
      },
    },
  });

  return txs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
}
```

### 7. Webhook for Provider Updates
**Approach**: Expose webhook endpoint for KYC providers to call

```typescript
@Post('kyc/webhook')
@UseGuards(WebhookSignatureGuard) // Verify provider signature
async handleKycUpdate(@Body() payload: any) {
  const { userId, status, tier, riskScore } = parsePayload(payload);

  await this.kycService.updateKycRecord(userId, {
    status,
    tier,
    riskScore,
    reviewedAt: new Date(),
  });

  return { success: true };
}
```

## Tasks

### Task 1: Add KycRecord Model to Database
**Description**: Create Prisma model and migration for KYC records

**Acceptance Criteria**:
- ✅ KycRecord model defined with all required fields
- ✅ Relationships to User model established
- ✅ KycStatus and KycTier enums defined
- ✅ Database migration created and applied
- ✅ Indexes added for performance

**Files to Create/Modify**:
- `apps/api/prisma/schema.prisma` - Add KycRecord model and enums
- Run: `npx prisma migrate dev --name add_kyc_record`

**Implementation Steps**:
1. Add KycStatus and KycTier enums to schema
2. Add KycRecord model with all fields
3. Create relationship: User 1-to-1 KycRecord
4. Add indexes on userId, status
5. Run migration to create table
6. Verify in database

---

### Task 2: Create KYC Module Structure
**Description**: Create KyC service, controller, and module

**Acceptance Criteria**:
- ✅ KycService with methods for CRUD operations
- ✅ KycController with endpoints
- ✅ KycModule properly configured
- ✅ All services injectable and tested

**Files to Create**:
- `apps/api/src/kyc/kyc.service.ts`
- `apps/api/src/kyc/kyc.controller.ts`
- `apps/api/src/kyc/kyc.module.ts`
- `apps/api/src/kyc/kyc.service.spec.ts`

**Implementation Steps**:
1. Create KycService with methods:
   - `submitKyc(userId, data)` - Store new KYC record
   - `getKycRecord(userId)` - Retrieve current record
   - `getKycStatus(userId)` - Get status with limits
   - `updateKycRecord(userId, updates)` - Admin/webhook updates
   - `getDailySpent(userId)` - Calculate today's spending
2. Create KycController with endpoints:
   - `POST /kyc/submit`
   - `GET /kyc/status`
3. Create KycModule with dependency injection
4. Write unit tests

---

### Task 3: Implement KYC Endpoints
**Description**: POST /kyc/submit and GET /kyc/status endpoints

**Acceptance Criteria**:
- ✅ POST /kyc/submit validates input and stores record
- ✅ GET /kyc/status returns current status + limits
- ✅ Both endpoints require authentication
- ✅ Input validation on document type
- ✅ Proper error handling and messages

**Files to Modify**:
- `apps/api/src/kyc/kyc.controller.ts` - Implement endpoints
- `apps/api/src/kyc/kyc.service.ts` - Add business logic

**Implementation Steps**:
1. Create KycSubmitDto with validation:
   - documentType (enum: PASSPORT, NATIONAL_ID, etc.)
   - firstName, lastName (required, non-empty)
   - dateOfBirth (valid ISO date, under 18 check)
   - address, city, country (required)
2. Implement POST /kyc/submit:
   - Validate input
   - Check if record exists (update) or create new
   - Set status to PENDING
   - Save to DB
   - Return { status: 'PENDING', submittedAt }
3. Implement GET /kyc/status:
   - Get KycRecord or return default (NONE, no limits)
   - Calculate daily spent via transaction query
   - Return full status object with limits
4. Add authentication decorator to both routes

---

### Task 4: Create KycGuard for Transaction Limits
**Description**: Implement guard to enforce KYC-based transaction limits

**Acceptance Criteria**:
- ✅ Guard checks user's KYC tier
- ✅ Calculates daily spend from transactions
- ✅ Blocks transactions exceeding limit
- ✅ Returns clear error message with remaining limit
- ✅ All tiers have defined limits

**Files to Create/Modify**:
- `apps/api/src/kyc/kyc.guard.ts` - NEW
- `apps/api/src/transaction/transaction.controller.ts` - Apply guard to POST /send

**Implementation Steps**:
1. Create KycGuard implementing CanActivate:
   - Extract userId from request
   - Extract amount from request body
   - Query KycRecord (default to NONE tier)
   - Get tier-based limit
   - Calculate today's spent
   - Check if newTotal > limit
   - Throw ForbiddenException if exceeded
2. Create getLimitForTier() mapping:
   - NONE: $100/day
   - BASIC: $5,000/day
   - FULL: $50,000/day
   - ENHANCED: $250,000/day
3. Apply guard to TransactionController:
   - Add `@UseGuards(JwtAuthGuard, KycGuard)` to POST /send
4. Test with mock KYC records

---

### Task 5: Add Provider Integration Framework
**Description**: Create pluggable interface for KYC providers

**Acceptance Criteria**:
- ✅ IKycProvider interface defined
- ✅ KycProviderFactory implements factory pattern
- ✅ Mock provider for testing
- ✅ Configuration-driven provider selection

**Files to Create**:
- `apps/api/src/kyc/providers/kyc.provider.interface.ts`
- `apps/api/src/kyc/providers/kyc-provider.factory.ts`
- `apps/api/src/kyc/providers/mock-kyc.provider.ts`

**Implementation Steps**:
1. Define IKycProvider interface:
   - submitVerification(record, data): Promise<{providerRef}>
   - checkStatus(providerRef): Promise<status>
   - handleWebhook(payload): Promise<void>
2. Create KycProviderFactory:
   - Read KYC_PROVIDER env variable
   - Return appropriate provider instance
   - Default to MockKycProvider
3. Implement MockKycProvider for testing:
   - Auto-approve after 2 seconds
   - Return random risk score
   - Support manual override via DB seed
4. Update .env.example with KYC_PROVIDER setting

---

### Task 6: Implement Webhook Handler
**Description**: Create endpoint for KYC provider callbacks

**Acceptance Criteria**:
- ✅ POST /kyc/webhook accepts provider updates
- ✅ Webhook signature verified (if applicable)
- ✅ Updates KycRecord status and tier
- ✅ Handles both approval and rejection
- ✅ Idempotent (duplicate webhooks don't cause issues)

**Files to Create/Modify**:
- `apps/api/src/kyc/kyc.controller.ts` - Add webhook endpoint
- `apps/api/src/kyc/kyc.service.ts` - Update record logic

**Implementation Steps**:
1. Add POST /kyc/webhook route:
   - No auth guard (provider calls directly)
   - Verify webhook signature if provider requires
   - Parse payload
   - Call service to update record
2. Implement webhook update logic:
   - Find KycRecord by provider reference
   - Update status, tier, risk score
   - Set reviewedAt timestamp
   - If rejected, store rejectionReason
3. Add idempotency check:
   - Track processed webhook IDs to avoid double-processing
   - Return success even if duplicate

---

### Task 7: Write Integration Tests
**Description**: Test KYC flow and transaction limits

**Acceptance Criteria**:
- ✅ KYC submission and status retrieval work
- ✅ Transaction blocked for unverified user ($100 limit)
- ✅ Transaction allowed for verified user (higher limit)
- ✅ Daily limit resets at midnight UTC
- ✅ Rejected KYC blocks high-value transactions

**Files to Create/Modify**:
- `apps/api/src/kyc/kyc.controller.spec.ts`
- `apps/api/src/kyc/kyc.guard.spec.ts`
- `apps/api/src/transaction/transaction.controller.spec.ts` - Add KYC tests

**Implementation Steps**:
1. Test KYC submission:
   - Submit valid data → status PENDING
   - Submit invalid data → validation error
   - Submit second time → update existing record
2. Test status endpoint:
   - New user → NONE tier, 0 spent, $100 limit
   - Approved user → BASIC tier, $5k limit
3. Test transaction limits:
   - Unverified user tries $150 → blocked with error
   - Unverified user sends $50 → succeeds
   - Unverified user tries $75 → fails (daily total $125 > $100)
   - Day changes → limit resets
4. Test guard with mocked KycRecord

---

## Data Model Changes

**New Prisma Model**:
```prisma
model KycRecord {
  id                String        @id @default(uuid())
  userId            String        @unique
  status            KycStatus     @default(PENDING)
  tier              KycTier       @default(NONE)
  documentType      String?
  documentRef       String?
  submittedAt       DateTime?
  reviewedAt        DateTime?
  expiresAt         DateTime?
  rejectionReason   String?
  riskScore         Float?
  metadata          Json?
  
  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([status])
}

enum KycStatus {
  PENDING
  SUBMITTED
  REVIEWING
  APPROVED
  REJECTED
  EXPIRED
  SUSPENDED
}

enum KycTier {
  NONE
  BASIC
  FULL
  ENHANCED
}
```

**Migration Command**:
```bash
cd apps/api
npx prisma migrate dev --name add_kyc_record
```

## Configuration

Add to `.env` and `.env.example`:
```bash
# KYC Provider configuration
KYC_PROVIDER=mock                    # Options: mock, smile-identity, onfido, idology
KYC_WEBHOOK_SECRET=your-secret-key   # Sign webhooks with this secret
KYC_SUBMIT_AUTO_REVIEW=true          # Auto-approve submissions in dev
KYC_REVIEW_DELAY_MS=2000             # Simulate review time

# Tier-based transaction limits (in USD)
KYC_TIER_NONE_DAILY_LIMIT=100
KYC_TIER_BASIC_DAILY_LIMIT=5000
KYC_TIER_FULL_DAILY_LIMIT=50000
KYC_TIER_ENHANCED_DAILY_LIMIT=250000
```

## API Reference

### POST /kyc/submit
Submit or update KYC information.

**Auth**: Required (JwtAuthGuard)

**Request**:
```json
{
  "documentType": "PASSPORT",
  "firstName": "John",
  "lastName": "Doe",
  "dateOfBirth": "1990-01-15",
  "nationality": "US",
  "address": "123 Main St",
  "city": "New York",
  "postalCode": "10001",
  "country": "US"
}
```

**Response (201 Created)**:
```json
{
  "id": "uuid",
  "status": "PENDING",
  "tier": "NONE",
  "submittedAt": "2026-06-25T10:00:00Z",
  "message": "KYC submission received. We'll review it and notify you shortly."
}
```

**Errors**:
- 400: Invalid input (bad email format, under 18, missing fields)
- 401: Unauthorized
- 500: Internal error

### GET /kyc/status
Retrieve KYC status and transaction limits.

**Auth**: Required (JwtAuthGuard)

**Response (200 OK)**:
```json
{
  "status": "APPROVED",
  "tier": "BASIC",
  "submittedAt": "2026-06-20T10:00:00Z",
  "reviewedAt": "2026-06-20T11:00:00Z",
  "expiresAt": "2027-06-20T00:00:00Z",
  "dailyLimit": 5000,
  "dailyUsed": 1250.50,
  "remainingToday": 3749.50,
  "documentType": "PASSPORT",
  "nextRenewalDate": "2027-06-20"
}
```

**Or (for unverified user)**:
```json
{
  "status": "PENDING",
  "tier": "NONE",
  "submittedAt": null,
  "dailyLimit": 100,
  "dailyUsed": 0,
  "remainingToday": 100,
  "message": "Please complete KYC to increase your limits"
}
```

### POST /kyc/webhook (Internal)
Webhook endpoint for KYC provider updates.

**Auth**: None (but signature verified)

**Request**:
```json
{
  "userId": "uuid",
  "providerRef": "smile_12345",
  "status": "APPROVED",
  "tier": "FULL",
  "riskScore": 0.15,
  "timestamp": "2026-06-25T10:30:00Z",
  "signature": "sha256=..."
}
```

**Response**:
```json
{
  "success": true
}
```

## Rollout Strategy

**Phase 1**: Database & Basic Endpoints
- Add KycRecord model
- Create /kyc/submit and /kyc/status endpoints
- Manual status updates for testing

**Phase 2**: Transaction Limits
- Add KycGuard to POST /transactions/send
- Start enforcing limits for unverified users
- Monitor for issues

**Phase 3**: Provider Integration
- Implement KycProviderFactory
- Add mock provider for testing
- Create webhook handler

**Phase 4**: Real Provider Integration
- Integrate with Smile Identity (recommended for Africa)
- Configure webhook URL with provider
- Test end-to-end flow

**Phase 5**: Enhancement
- Add document upload/storage
- Implement re-verification workflows
- Add admin dashboard for KYC review

## Regulatory Compliance

This implementation addresses:
- **KYC Regulations**: Collect and store identity information
- **AML Compliance**: Track transaction limits based on verification
- **Travel Rule**: Foundation for monitoring large transfers (future)
- **GDPR Compliance**: Support data deletion/export workflows
- **Sanctions Screening**: Hook for third-party screening APIs

## Frontend Integration Guide

### Checking User's KYC Status
```typescript
const response = await fetch('/kyc/status', {
  headers: { Authorization: `Bearer ${token}` }
});
const status = await response.json();

if (status.tier === 'NONE') {
  showKycForm(); // Show form if not verified
  showLimit(`Daily limit: $${status.dailyLimit}`);
}
```

### Submitting KYC
```typescript
const response = await fetch('/kyc/submit', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    documentType: 'NATIONAL_ID',
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1990-01-15',
    nationality: 'NG',
    address: '123 Main',
    city: 'Lagos',
    postalCode: '100001',
    country: 'NG'
  })
});

if (response.ok) {
  showMessage('KYC submitted! Review typically takes 24 hours.');
} else {
  showError('KYC submission failed. Please check your info.');
}
```

### Handling Transaction Limit Errors
```typescript
try {
  await sendTransaction(destination, amount);
} catch (error) {
  if (error.status === 403 && error.message.includes('Daily limit')) {
    const { dailyLimit, dailyUsed, remainingToday } = await fetch('/kyc/status');
    showAlert(
      `You've used $${dailyUsed} of your $${dailyLimit} daily limit. ` +
      `You can send $${remainingToday} more today.`
    );
    showKycUpgradeOffer(); // Offer to complete full KYC
  }
}
```

---

## Success Metrics

- ✅ KYC records created and stored for all users
- ✅ Unverified users limited to $100/day
- ✅ Verified users (BASIC tier) can send $5k/day
- ✅ Transaction limits enforced consistently
- ✅ All endpoints documented and tested
- ✅ Provider framework extensible for real integrations
- ✅ Zero data breaches or compliance violations

---

**Created**: June 25, 2026
**Branch**: `feature/real-time-transactions` (continuing)
**Status**: Ready for implementation
