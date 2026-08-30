import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Sep24Service } from '../sep24.service';
import { PrismaService } from '../../prisma/prisma.service';

const TEST_SECRET = 'test-secret-for-sep24-unit-tests-32chars!!';

/**
 * In-memory store that behaves like the subset of PrismaService.sep24Transaction
 * used by Sep24Service, so tests don't require a real database.
 */
function createMockPrisma() {
  const store = new Map<string, any>();

  return {
    sep24Transaction: {
      create: jest.fn(async ({ data }: any) => {
        const id = data.id ?? `mock-${Date.now()}-${Math.random()}`;
        const record = {
          id,
          ...data,
          status: data.status ?? 'incomplete',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.set(id, record);
        // Also index by sessionToken so findFirst can look it up
        store.set(`token:${data.sessionToken}`, record);
        return record;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.sessionToken) return store.get(`token:${where.sessionToken}`) ?? null;
        return null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where?.id) return store.get(where.id) ?? null;
        return null;
      }),
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = store.get(where.id);
        if (!existing) return null;
        const updated = { ...existing, ...data, updatedAt: new Date() };
        store.set(where.id, updated);
        if (existing.sessionToken) store.set(`token:${existing.sessionToken}`, updated);
        return updated;
      }),
    },
    _store: store,
  };
}

describe('Sep24Service', () => {
  let service: Sep24Service;
  let jwtService: JwtService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    mockPrisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: { expiresIn: '30m' },
        }),
      ],
      providers: [
        Sep24Service,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<Sep24Service>(Sep24Service);
    jwtService = module.get<JwtService>(JwtService);
  });

  // -------------------------------------------------------------------------
  // getSep24Info
  // -------------------------------------------------------------------------

  describe('getSep24Info', () => {
    it('returns deposit and withdraw sections with supported assets', () => {
      const info = service.getSep24Info();
      expect(info.deposit).toBeDefined();
      expect(info.withdraw).toBeDefined();
      expect(info.deposit.USDC.enabled).toBe(true);
      expect(info.withdraw.USDC.enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // createInteractiveSession
  // -------------------------------------------------------------------------

  describe('createInteractiveSession', () => {
    const account = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV';

    it('creates a deposit session and returns SEP-24 compliant response', async () => {
      const result = await service.createInteractiveSession(
        account,
        'deposit',
        'USDC',
      );

      expect(result.type).toBe('interactive_customer_info_needed');
      expect(result.url).toContain('/anchor/interactive');
      expect(result.url).toContain('token=');
      expect(result.id).toBeDefined();

      // Verify the session token is a valid JWT
      const url = new URL(result.url);
      const token = url.searchParams.get('token')!;
      const payload = jwtService.verify(token);
      expect(payload.account).toBe(account);
      expect(payload.kind).toBe('deposit');
    });

    it('creates a withdrawal session', async () => {
      const result = await service.createInteractiveSession(
        account,
        'withdraw',
        'USDC',
        undefined,
        '100',
      );

      expect(result.type).toBe('interactive_customer_info_needed');
      expect(result.id).toBeDefined();
    });

    it('persists the transaction in the database', async () => {
      await service.createInteractiveSession(account, 'deposit', 'USDC');
      expect(mockPrisma.sep24Transaction.create).toHaveBeenCalledTimes(1);

      const createCall = mockPrisma.sep24Transaction.create.mock.calls[0][0];
      expect(createCall.data.kind).toBe('deposit');
      expect(createCall.data.stellarAccount).toBe(account);
      expect(createCall.data.assetCode).toBe('USDC');
      expect(createCall.data.sessionToken).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getSessionData
  // -------------------------------------------------------------------------

  describe('getSessionData', () => {
    const account = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV';

    it('returns session data for a valid token', async () => {
      const session = await service.createInteractiveSession(account, 'deposit', 'USDC');
      const url = new URL(session.url);
      const token = url.searchParams.get('token')!;

      const sessionData = await service.getSessionData(token);
      expect(sessionData.kind).toBe('deposit');
      expect(sessionData.stellarAccount).toBe(account);
      expect(sessionData.assetCode).toBe('USDC');
      expect(sessionData.status).toBe('incomplete');
    });

    it('throws UnauthorizedException for an invalid token', async () => {
      await expect(service.getSessionData('invalid.jwt.token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws NotFoundException when session is not in the database', async () => {
      // Create a valid JWT but don't store it in the mock database
      const token = jwtService.sign({ txId: 'nonexistent', account, kind: 'deposit' });

      await expect(service.getSessionData(token)).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // confirmInteractiveSession
  // -------------------------------------------------------------------------

  describe('confirmInteractiveSession', () => {
    const account = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV';

    it('transitions status to pending_user_transfer_start after confirmation', async () => {
      const session = await service.createInteractiveSession(account, 'deposit', 'USDC');
      const url = new URL(session.url);
      const token = url.searchParams.get('token')!;

      const result = await service.confirmInteractiveSession(
        token,
        { first_name: 'Test', last_name: 'User', email: 'test@example.com' },
        'bank_transfer',
        '500',
      );

      expect(result.status).toBe('pending_user_transfer_start');
      expect(result.memo).toBeDefined();
      expect(result.memoType).toBe('text');
    });

    it('rejects confirmation on an already completed session', async () => {
      const session = await service.createInteractiveSession(account, 'deposit', 'USDC');
      const url = new URL(session.url);
      const token = url.searchParams.get('token')!;

      // First confirmation succeeds
      await service.confirmInteractiveSession(
        token,
        { first_name: 'Test' },
        'bank_transfer',
      );

      // Second confirmation fails
      await expect(
        service.confirmInteractiveSession(
          token,
          { first_name: 'Test' },
          'bank_transfer',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // Session token signing and verification
  // -------------------------------------------------------------------------

  describe('signSessionToken / verifySessionToken', () => {
    it('round-trips a payload through sign and verify', () => {
      const payload = { txId: 'tx-1', account: 'GABC', kind: 'deposit' };
      const token = service.signSessionToken(payload);
      const decoded = service.verifySessionToken(token);

      expect(decoded.txId).toBe('tx-1');
      expect(decoded.account).toBe('GABC');
      expect(decoded.kind).toBe('deposit');
    });

    it('throws UnauthorizedException for an expired token', () => {
      // Sign a token that already expired
      const token = jwtService.sign(
        { txId: 'tx-expired', account: 'GABC', kind: 'deposit' },
        { expiresIn: '0s' },
      );

      // Wait a tick so the expiration kicks in
      expect(() => service.verifySessionToken(token)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a tampered token', () => {
      const token = service.signSessionToken({
        txId: 'tx-1',
        account: 'GABC',
        kind: 'deposit',
      });
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(() => service.verifySessionToken(tampered)).toThrow(UnauthorizedException);
    });
  });

  // -------------------------------------------------------------------------
  // getTransactionById
  // -------------------------------------------------------------------------

  describe('getTransactionById', () => {
    const account = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV';

    it('throws NotFoundException for nonexistent transaction', async () => {
      await expect(
        service.getTransactionById('nonexistent-id', account),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
