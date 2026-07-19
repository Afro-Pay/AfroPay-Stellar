# KYC/AML Implementation Checklist

**Branch**: `feature/real-time-transactions` (continuing)

## Phase 1: Database Schema & Migration

### 1.1 Update Prisma Schema
**File**: `apps/api/prisma/schema.prisma`

- [ ] Add KycStatus enum (PENDING, SUBMITTED, REVIEWING, APPROVED, REJECTED, EXPIRED, SUSPENDED)
- [ ] Add KycTier enum (NONE, BASIC, FULL, ENHANCED)
- [ ] Add KycRecord model with fields:
  - `id` (uuid, primary key)
  - `userId` (string, unique FK to User)
  - `status` (KycStatus, default PENDING)
  - `tier` (KycTier, default NONE)
  - `documentType` (string, nullable)
  - `documentRef` (string, nullable)
  - `submittedAt` (DateTime, nullable)
  - `reviewedAt` (DateTime, nullable)
  - `expiresAt` (DateTime, nullable)
  - `rejectionReason` (string, nullable)
  - `riskScore` (float, nullable)
  - `metadata` (Json, nullable)
- [ ] Add User relation to KycRecord

**Schema Addition**:
```prisma
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

model KycRecord {
  id              String        @id @default(uuid())
  userId          String        @unique
  status          KycStatus     @default(PENDING)
  tier            KycTier       @default(NONE)
  documentType    String?
  documentRef     String?
  submittedAt     DateTime?
  reviewedAt      DateTime?
  expiresAt       DateTime?
  rejectionReason String?
  riskScore       Float?
  metadata        Json?
  
  user            User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([status])
}
```

### 1.2 Add to User Model
**File**: `apps/api/prisma/schema.prisma`

```prisma
model User {
  id              String        @id @default(uuid())
  email           String        @unique
  password        String
  createdAt       DateTime      @default(now())
  wallet          Wallet?
  transactions    Transaction[]
  kyc             KycRecord?    // NEW
}
```

### 1.3 Create Migration
```bash
cd apps/api
npx prisma migrate dev --name add_kyc_record
```

- [ ] Migration created successfully
- [ ] Database schema updated
- [ ] No migration errors
- [ ] Can see KycRecord table in database

### 1.4 Verify Migration
```bash
npx prisma studio
```

- [ ] KycRecord table visible in Prisma Studio
- [ ] All fields present and nullable as expected
- [ ] Relationships working in UI

---

## Phase 2: Create KYC Module Structure

### 2.1 Create KYC Service
**File**: `apps/api/src/kyc/kyc.service.ts`

- [ ] Create class `KycService`
- [ ] Inject `PrismaService`
- [ ] Implement method: `getKycRecord(userId: string): Promise<KycRecord | null>`
  - Query KycRecord by userId
  - Return null if not found
- [ ] Implement method: `submitKyc(userId: string, data: any): Promise<KycRecord>`
  - Find or create KycRecord
  - Set status to PENDING
  - Store document info
  - Store submittedAt timestamp
  - Return record
- [ ] Implement method: `getKycStatus(userId: string): Promise<object>`
  - Get KycRecord (or default to NONE tier)
  - Calculate daily spent amount
  - Return status object with limits
- [ ] Implement method: `updateKycRecord(userId: string, updates: any): Promise<KycRecord>`
  - Update fields: status, tier, riskScore, etc.
  - Set reviewedAt if status changes to APPROVED/REJECTED
  - Return updated record
- [ ] Implement method: `getDailySpent(userId: string): Promise<number>`
  - Query transactions created today with status SUCCESS
  - Sum amounts
  - Return total

**Service Structure**:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KycService {
  constructor(private prisma: PrismaService) {}

  async getKycRecord(userId: string) {
    return this.prisma.kycRecord.findUnique({
      where: { userId },
    });
  }

  async submitKyc(userId: string, data: any) {
    return this.prisma.kycRecord.upsert({
      where: { userId },
      create: {
        userId,
        status: 'PENDING',
        documentType: data.documentType,
        documentRef: data.documentRef,
        submittedAt: new Date(),
      },
      update: {
        status: 'PENDING',
        documentType: data.documentType,
        documentRef: data.documentRef,
        submittedAt: new Date(),
      },
    });
  }

  async getKycStatus(userId: string) {
    const record = await this.getKycRecord(userId);
    const dailySpent = await this.getDailySpent(userId);
    const limits = this.getLimitForTier(record?.tier || 'NONE');

    return {
      status: record?.status || 'PENDING',
      tier: record?.tier || 'NONE',
      submittedAt: record?.submittedAt,
      reviewedAt: record?.reviewedAt,
      expiresAt: record?.expiresAt,
      rejectionReason: record?.rejectionReason,
      dailyLimit: limits,
      dailyUsed: dailySpent,
      remainingToday: limits - dailySpent,
    };
  }

  async updateKycRecord(userId: string, updates: any) {
    return this.prisma.kycRecord.upsert({
      where: { userId },
      create: {
        userId,
        ...updates,
        reviewedAt: new Date(),
      },
      update: {
        ...updates,
        reviewedAt: new Date(),
      },
    });
  }

  async getDailySpent(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        status: 'SUCCESS',
        createdAt: {
          gte: today,
        },
      },
    });

    return transactions.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
  }

  private getLimitForTier(tier: string): number {
    const limits: Record<string, number> = {
      NONE: 100,
      BASIC: 5000,
      FULL: 50000,
      ENHANCED: 250000,
    };
    return limits[tier] || 100;
  }
}
```

### 2.2 Create KYC Controller
**File**: `apps/api/src/kyc/kyc.controller.ts`

- [ ] Create class `KycController` with `@Controller('kyc')`
- [ ] Inject `KycService`
- [ ] Create method: `@Post('submit')` - submitKyc()
  - Guard: JwtAuthGuard
  - Body: KycSubmitDto
  - Extract userId from request
  - Call service.submitKyc()
  - Return { id, status, submittedAt, message }
- [ ] Create method: `@Get('status')` - getStatus()
  - Guard: JwtAuthGuard
  - Extract userId from request
  - Call service.getKycStatus()
  - Return status object
- [ ] Create method: `@Post('webhook')` - handleWebhook()
  - No guard (public endpoint)
  - Body: webhook payload
  - Parse and validate
  - Call service.updateKycRecord()
  - Return { success: true }

**Controller Structure**:
```typescript
import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('kyc')
export class KycController {
  constructor(private kycService: KycService) {}

  @Post('submit')
  @UseGuards(JwtAuthGuard)
  async submitKyc(@Request() req: any, @Body() dto: KycSubmitDto) {
    const record = await this.kycService.submitKyc(req.user.userId, {
      documentType: dto.documentType,
      documentRef: dto.documentUrl,
    });
    return {
      id: record.id,
      status: record.status,
      submittedAt: record.submittedAt,
      message: 'KYC submission received. Review typically takes 24 hours.',
    };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Request() req: any) {
    return this.kycService.getKycStatus(req.user.userId);
  }

  @Post('webhook')
  async handleWebhook(@Body() payload: any) {
    const { userId, status, tier, riskScore } = payload;
    await this.kycService.updateKycRecord(userId, {
      status,
      tier,
      riskScore,
    });
    return { success: true };
  }
}
```

### 2.3 Create KYC Module
**File**: `apps/api/src/kyc/kyc.module.ts`

- [ ] Create class `KycModule`
- [ ] Import: PrismaModule
- [ ] Providers: KycService
- [ ] Controllers: KycController
- [ ] Export: KycService (for use in guards)

**Module Structure**:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';

@Module({
  imports: [PrismaModule],
  providers: [KycService],
  controllers: [KycController],
  exports: [KycService],
})
export class KycModule {}
```

### 2.4 Add KYC Module to App
**File**: `apps/api/src/app.module.ts`

- [ ] Import KycModule in AppModule imports array
- [ ] Verify module loads without errors

---

## Phase 3: Create KYC DTOs and DTOs

### 3.1 Create KycSubmitDto
**File**: `apps/api/src/kyc/dto/kyc-submit.dto.ts`

```typescript
import {
  IsEnum,
  IsString,
  IsDateString,
  IsEmail,
  MinLength,
  MaxLength,
  IsISO31661Alpha2,
} from 'class-validator';

export enum DocumentType {
  PASSPORT = 'PASSPORT',
  NATIONAL_ID = 'NATIONAL_ID',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
}

export class KycSubmitDto {
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName: string;

  @IsDateString()
  dateOfBirth: string; // ISO 8601, must be 18+

  @IsString()
  @MaxLength(100)
  address: string;

  @IsString()
  @MaxLength(50)
  city: string;

  @IsString()
  @MaxLength(10)
  postalCode: string;

  @IsISO31661Alpha2()
  country: string;

  @IsString()
  nationality: string;

  @IsString()
  @MaxLength(500)
  documentUrl?: string; // Optional: URL to document
}
```

### 3.2 Add Validation
- [ ] Validate dateOfBirth is 18 years old or older
- [ ] Validate required fields non-empty
- [ ] Validate country codes are valid ISO 3166-1 alpha-2
- [ ] Create custom validator for age check

---

## Phase 4: Create KYC Guard

### 4.1 Create KycGuard
**File**: `apps/api/src/kyc/kyc.guard.ts`

- [ ] Create class `KycGuard` implementing CanActivate
- [ ] Inject KycService
- [ ] In canActivate():
  - Extract userId from request.user
  - Extract amount from request.body
  - Get KycRecord (or default to NONE tier)
  - Get limit for tier
  - Calculate daily spent
  - Check if newTotal > limit
  - Throw ForbiddenException with clear message if exceeded
  - Return true if allowed

**Guard Structure**:
```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { KycService } from './kyc.service';

@Injectable()
export class KycGuard implements CanActivate {
  constructor(private kycService: KycService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const amount = parseFloat(request.body?.amount);

    if (!userId) return false;
    if (!amount || amount <= 0) return false;

    const kycRecord = await this.kycService.getKycRecord(userId);
    const tier = kycRecord?.tier || 'NONE';
    const limit = this.getLimitForTier(tier);
    const dailySpent = await this.kycService.getDailySpent(userId);
    const newTotal = dailySpent + amount;

    if (newTotal > limit) {
      throw new ForbiddenException(
        `Transaction limit exceeded. ` +
        `Daily limit: $${limit}, Already used: $${dailySpent}, ` +
        `Remaining: $${limit - dailySpent}`
      );
    }

    return true;
  }

  private getLimitForTier(tier: string): number {
    const limits: Record<string, number> = {
      NONE: 100,
      BASIC: 5000,
      FULL: 50000,
      ENHANCED: 250000,
    };
    return limits[tier] || 100;
  }
}
```

### 4.2 Apply Guard to Transaction Endpoint
**File**: `apps/api/src/transaction/transaction.controller.ts`

- [ ] Import KycGuard
- [ ] Add `@UseGuards(JwtAuthGuard, KycGuard)` to POST /send route
- [ ] Test that unverified users are blocked for high amounts

**Updated Route**:
```typescript
@Post('send')
@UseGuards(JwtAuthGuard, KycGuard)
@RateLimit({
  keyPrefix: 'transactions:send',
  limit: 20,
  windowMs: 60_000,
  limitEnv: 'PUBLIC_API_RATE_LIMIT_MAX',
  windowMsEnv: 'PUBLIC_API_RATE_LIMIT_WINDOW_MS',
})
send(@Request() req: any, @Body() dto: SendDto) {
  return this.txService.sendTransfer(req.user.userId, dto);
}
```

---

## Phase 5: Create Provider Framework (Optional)

### 5.1 Create KYC Provider Interface
**File**: `apps/api/src/kyc/providers/kyc.provider.interface.ts`

```typescript
export interface IKycProvider {
  submitVerification(
    record: any,
    data: any
  ): Promise<{ providerRef: string }>;

  checkStatus(providerRef: string): Promise<{
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    tier: 'BASIC' | 'FULL';
    riskScore?: number;
  }>;

  handleWebhook(payload: any): Promise<void>;
}
```

### 5.2 Create Mock Provider
**File**: `apps/api/src/kyc/providers/mock-kyc.provider.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IKycProvider } from './kyc.provider.interface.ts';

@Injectable()
export class MockKycProvider implements IKycProvider {
  private logger = new Logger(MockKycProvider.name);

  async submitVerification(record: any, data: any) {
    this.logger.log(`Mock KYC submission for user ${data.userId}`);
    return { providerRef: `mock_${Date.now()}` };
  }

  async checkStatus(providerRef: string) {
    this.logger.log(`Mock KYC status check for ${providerRef}`);
    return {
      status: 'APPROVED',
      tier: 'BASIC',
      riskScore: 0.1,
    };
  }

  async handleWebhook(payload: any) {
    this.logger.log(`Mock webhook received:`, payload);
  }
}
```

### 5.3 Create Provider Factory
**File**: `apps/api/src/kyc/providers/kyc-provider.factory.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IKycProvider } from './kyc.provider.interface';
import { MockKycProvider } from './mock-kyc.provider';

@Injectable()
export class KycProviderFactory {
  constructor(private configService: ConfigService) {}

  getProvider(): IKycProvider {
    const provider = this.configService.get('KYC_PROVIDER', 'mock');

    switch (provider) {
      case 'smile-identity':
        // return new SmileIdentityProvider(this.configService);
        throw new Error('SmileIdentityProvider not yet implemented');
      case 'onfido':
        // return new OnfidoProvider(this.configService);
        throw new Error('OnfidoProvider not yet implemented');
      case 'mock':
      default:
        return new MockKycProvider();
    }
  }
}
```

---

## Phase 6: Write Tests

### 6.1 Create KYC Service Tests
**File**: `apps/api/src/kyc/kyc.service.spec.ts`

- [ ] Test getKycRecord(): returns record or null
- [ ] Test submitKyc(): creates or updates record
- [ ] Test getKycStatus(): returns status with limits
- [ ] Test updateKycRecord(): updates fields
- [ ] Test getDailySpent(): calculates daily total correctly

**Test Structure**:
```typescript
describe('KycService', () => {
  let service: KycService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [KycService, mockPrismaService],
    }).compile();

    service = module.get<KycService>(KycService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should submit KYC and set status to PENDING', async () => {
    const userId = 'test-user-1';
    const result = await service.submitKyc(userId, {
      documentType: 'PASSPORT',
    });

    expect(result.status).toBe('PENDING');
    expect(result.submittedAt).toBeDefined();
  });

  it('should return daily limits based on tier', async () => {
    const status = await service.getKycStatus('unverified-user');
    expect(status.dailyLimit).toBe(100); // NONE tier
  });

  it('should calculate daily spent from SUCCESS transactions', async () => {
    // Mock transactions
    const spent = await service.getDailySpent('test-user');
    expect(typeof spent).toBe('number');
    expect(spent).toBeGreaterThanOrEqual(0);
  });
});
```

### 6.2 Create KYC Guard Tests
**File**: `apps/api/src/kyc/kyc.guard.spec.ts`

- [ ] Test guard allows transaction under limit
- [ ] Test guard blocks transaction over limit
- [ ] Test guard passes for BASIC tier users with higher limit
- [ ] Test error message includes remaining amount

### 6.3 Create KYC Controller Tests
**File**: `apps/api/src/kyc/kyc.controller.spec.ts`

- [ ] Test POST /kyc/submit with valid data
- [ ] Test POST /kyc/submit with invalid data (age check, missing fields)
- [ ] Test GET /kyc/status returns correct response
- [ ] Test unauthorized access returns 401

### 6.4 Update Transaction Controller Tests
**File**: `apps/api/src/transaction/transaction.controller.spec.ts`

- [ ] Test unverified user can send up to $100
- [ ] Test unverified user blocked from sending $101+
- [ ] Test verified user (BASIC) can send $5k
- [ ] Test daily limit resets

---

## Phase 7: Environment Configuration

### 7.1 Update .env.example
**File**: `apps/api/.env.example`

```bash
# KYC Configuration
KYC_PROVIDER=mock                      # Options: mock, smile-identity, onfido
KYC_WEBHOOK_SECRET=your-webhook-secret
KYC_SUBMIT_AUTO_REVIEW=true
KYC_REVIEW_DELAY_MS=2000

# Transaction Limits (USD)
KYC_TIER_NONE_DAILY_LIMIT=100
KYC_TIER_BASIC_DAILY_LIMIT=5000
KYC_TIER_FULL_DAILY_LIMIT=50000
KYC_TIER_ENHANCED_DAILY_LIMIT=250000
```

### 7.2 Update .env (Local Development)
- [ ] Copy values from .env.example
- [ ] Set KYC_PROVIDER=mock for testing
- [ ] Adjust limits if testing requires

---

## Phase 8: Integration & Verification

### 8.1 Run Tests
```bash
cd apps/api
npm run test                    # All tests
npm run test -- kyc            # KYC tests only
npm run test -- --coverage     # With coverage
```

- [ ] All tests passing
- [ ] KYC tests have good coverage
- [ ] Guard tests passing

### 8.2 Run Linting
```bash
npm run lint
```

- [ ] No linting errors
- [ ] Code style matches project standards

### 8.3 Manual Testing - KYC Submission
```bash
# Get a test token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq -r '.accessToken')

# Submit KYC
curl -X POST http://localhost:3000/kyc/submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "documentType": "PASSPORT",
    "firstName": "John",
    "lastName": "Doe",
    "dateOfBirth": "1990-01-15",
    "nationality": "US",
    "address": "123 Main St",
    "city": "New York",
    "postalCode": "10001",
    "country": "US"
  }'

# Check status
curl http://localhost:3000/kyc/status \
  -H "Authorization: Bearer $TOKEN"
```

### 8.4 Manual Testing - Transaction Limits
```bash
# Create 2 test users
USER_A_TOKEN=$(getToken user-a)
USER_B_TOKEN=$(getToken user-b)

# User A (unverified) tries to send $150
curl -X POST http://localhost:3000/transactions/send \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationPublicKey": "G...",
    "amount": "150",
    "assetCode": "XLM"
  }'
# Expected: 403 Forbidden - limit exceeded

# User A (unverified) sends $50
curl -X POST http://localhost:3000/transactions/send \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationPublicKey": "G...",
    "amount": "50",
    "assetCode": "XLM"
  }'
# Expected: 201 Created

# User A (unverified) tries to send $75 more (total $125 > $100 limit)
curl -X POST http://localhost:3000/transactions/send \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationPublicKey": "G...",
    "amount": "75",
    "assetCode": "XLM"
  }'
# Expected: 403 Forbidden - daily limit exceeded ($50 + $75 = $125 > $100)

# Manually approve User B to BASIC tier (in DB)
UPDATE kyc_records SET status = 'APPROVED', tier = 'BASIC', reviewed_at = NOW() WHERE user_id = user_b_id;

# User B (verified, BASIC) sends $5000
curl -X POST http://localhost:3000/transactions/send \
  -H "Authorization: Bearer $USER_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationPublicKey": "G...",
    "amount": "5000",
    "assetCode": "XLM"
  }'
# Expected: 201 Created
```

---

## Verification Checklist

### Before Committing
- [ ] All KYC tests passing
- [ ] All transaction tests passing (including new limit tests)
- [ ] No linting errors
- [ ] Manual testing confirms:
  - Unverified users limited to $100/day
  - Verified users have higher limits
  - Error messages are clear
  - KYC status endpoint returns correct data
- [ ] Database migration applied successfully
- [ ] No breaking changes to existing API

### Before Creating PR
- [ ] Branch is up to date with main
- [ ] Commit messages are clear and descriptive
- [ ] Documentation updated
- [ ] Code follows project conventions
- [ ] No console.logs in production code
- [ ] Sensitive data not logged

### Code Review Checklist
- [ ] KycRecord model is correct
- [ ] Ownership verified (KYC belongs to user)
- [ ] Limits enforced consistently
- [ ] No data leakage in error messages
- [ ] Guard properly integrated
- [ ] Tests cover main paths
- [ ] Migration is safe (no data loss)

---

## Quick Commands

```bash
# Create migration
cd apps/api && npx prisma migrate dev --name add_kyc_record

# View database
npx prisma studio

# Run KYC tests
npm run test -- kyc

# Run specific test
npm run test -- kyc.service.spec.ts

# Run with coverage
npm run test -- --coverage

# Start dev server
npm run start:dev

# Lint
npm run lint

# Build
npm run build
```

---

## Troubleshooting

### Migration Failed
1. Check database connection in DATABASE_URL
2. Check Prisma version: `npx prisma --version`
3. Reset database if needed: `npx prisma migrate reset`
4. Check migration file syntax

### KYC Endpoint Returns 401
1. Verify token is valid
2. Check JwtAuthGuard is properly configured
3. Verify token contains `sub` claim with userId

### Transaction Limit Not Enforced
1. Verify KycGuard is applied to POST /send route
2. Check guard is imported in module
3. Verify mock KYC record is in database
4. Check transaction amounts are strings (as in schema)

### Tests Failing
1. Check PrismaService mock is properly configured
2. Verify test database is clean
3. Check DTOs are imported in test files
4. Run single test in isolation first

---

## File Structure

```
apps/api/src/kyc/
├── kyc.service.ts          # Business logic
├── kyc.controller.ts        # API endpoints
├── kyc.module.ts            # Module definition
├── kyc.guard.ts             # Transaction limit guard
├── kyc.service.spec.ts      # Service tests
├── kyc.controller.spec.ts   # Controller tests
├── kyc.guard.spec.ts        # Guard tests
├── dto/
│   └── kyc-submit.dto.ts    # Request DTOs
└── providers/
    ├── kyc.provider.interface.ts
    ├── mock-kyc.provider.ts
    └── kyc-provider.factory.ts
```

---

**Status**: Ready for implementation
**Created**: June 25, 2026
**Branch**: `feature/real-time-transactions` (continuing)
