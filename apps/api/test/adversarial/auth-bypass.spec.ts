import {
  Body,
  Controller,
  Get,
  INestApplication,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard';
import { JwtStrategy } from '../../src/auth/jwt.strategy';
import { KycGuard } from '../../src/kyc/kyc.guard';
import { KycService } from '../../src/kyc/kyc.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RateLimit } from '../../src/rate-limit/rate-limit.decorator';
import { RateLimitGuardRedis } from '../../src/rate-limit/rate-limit.guard.redis';
import { RedisRateLimiter } from '../../src/rate-limit/redis-rate-limiter';
import { assertTransactionAmountIntegrity } from '../../src/transaction/transaction-integrity';
import { WalletOwnershipGuard } from '../../src/wallet/wallet-ownership.guard';

const JWT_SECRET = 'adversarial-test-secret-at-least-32-characters';
const FOREIGN_WALLET_ID = '11111111-2222-4333-8444-555555555555';
const rateCounts = new Map<string, number>();

@Controller('adversarial')
class AdversarialHarnessController {
  @Get('protected')
  @UseGuards(JwtAuthGuard)
  protectedRoute() {
    return { ok: true };
  }

  @Post('kyc-transfer')
  @UseGuards(JwtAuthGuard, KycGuard)
  kycProtectedTransfer() {
    return { ok: true };
  }

  @Get('limited')
  @RateLimit({ keyPrefix: 'adversarial', limit: 2, windowMs: 60_000 })
  @UseGuards(RateLimitGuardRedis)
  limitedRoute() {
    return { ok: true };
  }

  @Post('submit-amount')
  submitAmount(@Body() body: { approvedAmount: string; persistedAmount: string }) {
    assertTransactionAmountIntegrity(body.approvedAmount, body.persistedAmount);
    return { ok: true };
  }

  @Get('wallet/:id')
  @UseGuards(JwtAuthGuard, WalletOwnershipGuard)
  walletData() {
    return { secret: 'must-never-be-returned' };
  }
}

@Module({
  imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
  controllers: [AdversarialHarnessController],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    KycGuard,
    WalletOwnershipGuard,
    RateLimitGuardRedis,
    {
      provide: KycService,
      useValue: {
        normalizeAmountToUsd: jest.fn().mockResolvedValue(1),
        assertWithinDailyLimit: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: PrismaService,
      useValue: {
        wallet: {
          findUnique: jest.fn().mockResolvedValue({ userId: 'wallet-owner' }),
        },
      },
    },
    {
      provide: RedisRateLimiter,
      useValue: {
        consume: jest.fn(async (key: string, limit: number, windowMs: number, now: number) => {
          const count = (rateCounts.get(key) ?? 0) + 1;
          rateCounts.set(key, count);
          return { limit, remaining: limit - count, resetAt: now + windowMs };
        }),
      },
    },
  ],
})
class AdversarialHarnessModule {}

describe('Adversarial authentication and authorization attacks', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let attackerToken: string;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [AdversarialHarnessModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
    attackerToken = jwt.sign({ sub: 'attacker-user', email: 'attacker@example.com' });
  });

  afterAll(async () => {
    await app?.close();
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  it('rejects a modified JWT whose header attempts an RS256/HMAC algorithm confusion (401)', async () => {
    // Attack vector: change both the algorithm declaration and privilege payload
    // while retaining a correctly shaped signature segment from a valid token.
    const [, , signature] = attackerToken.split('.');
    const forgedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const forgedPayload = Buffer.from(JSON.stringify({
      sub: 'attacker-user',
      email: 'attacker@example.com',
      role: 'ADMIN',
    })).toString('base64url');

    await request(app.getHttpServer())
      .get('/adversarial/protected')
      .set('Authorization', `Bearer ${forgedHeader}.${forgedPayload}.${signature}`)
      .expect(401);
  });

  it('rejects a KYC-protected transfer with a missing Authorization header (401)', async () => {
    // Attack vector: omit the bearer token and try to reach KYC logic with an
    // attacker-controlled request body.
    await request(app.getHttpServer())
      .post('/adversarial/kyc-transfer')
      .send({ amount: '1', assetCode: 'XLM' })
      .expect(401);
  });

  it('rejects a KYC-protected transfer with a malformed bearer token (401)', async () => {
    // Attack vector: provide a syntactically malformed JWT in the hope that the
    // KYC guard treats the request as an anonymous or legacy user.
    await request(app.getHttpServer())
      .post('/adversarial/kyc-transfer')
      .set('Authorization', 'Bearer malformed.jwt.value')
      .send({ amount: '1', assetCode: 'XLM' })
      .expect(401);
  });

  it('rejects rate-limit evasion using rotating X-Forwarded-For values (429)', async () => {
    // Attack vector: rotate a caller-controlled forwarding header on every
    // request to try to obtain a fresh unauthenticated IP bucket.
    const server = app.getHttpServer();
    await request(server).get('/adversarial/limited').set('X-Forwarded-For', '198.51.100.1').expect(200);
    await request(server).get('/adversarial/limited').set('X-Forwarded-For', '198.51.100.2').expect(200);
    await request(server).get('/adversarial/limited').set('X-Forwarded-For', '198.51.100.3').expect(429);
  });

  it('rejects transaction amount tampering between approval and submission (422)', async () => {
    // Attack vector: approve/simulate a small transfer, then mutate the stored
    // amount before fraud scoring and on-chain submission.
    await request(app.getHttpServer())
      .post('/adversarial/submit-amount')
      .send({ approvedAmount: '10.00', persistedAmount: '10000.00' })
      .expect(422);
  });

  it("rejects access to another user's wallet through a guessed UUID (403)", async () => {
    // Attack vector: authenticate normally, guess a valid wallet UUID belonging
    // to another user, and attempt to read the guarded wallet resource.
    await request(app.getHttpServer())
      .get(`/adversarial/wallet/${FOREIGN_WALLET_ID}`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .expect(403);
  });
});
