import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  TransactionService,
  HISTORY_MAX_LIMIT,
  HISTORY_DEFAULT_LIMIT,
} from './transaction.service';
import { TRANSACTION_QUEUE_OPTIONS } from './transaction-retry.config';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockWallet = { id: 'wallet-456', userId: 'user-123', publicKey: 'GPUBKEY' };

function makeRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `tx-${i + 1}`,
    userId: 'user-123',
    createdAt: new Date(Date.now() - i * 1000),
    amount: '10',
    assetCode: 'XLM',
    status: 'SUCCESS',
  }));
}

function buildService(overrides: {
  txRows?: ReturnType<typeof makeRows>;
  total?: number;
  walletFindUnique?: any;
  txCreate?: any;
}) {
  const rows = overrides.txRows ?? [];
  const total = overrides.total ?? rows.length;

  const txQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    wallet: {
      findUnique: overrides.walletFindUnique ?? jest.fn().mockResolvedValue(mockWallet),
    },
    transaction: {
      create: overrides.txCreate ?? jest.fn().mockResolvedValue({ id: 'tx-new' }),
      count: jest.fn().mockResolvedValue(total),
      findMany: jest.fn().mockImplementation(({ take, cursor, skip }: any) => {
        let start = 0;
        if (cursor?.id) {
          const idx = rows.findIndex((r) => r.id === cursor.id);
          start = idx === -1 ? rows.length : idx + (skip ?? 0);
        }
        return Promise.resolve(rows.slice(start, start + take));
      }),
    },
  };

  const kycService = {
    normalizeAmountToUsd: jest.fn().mockResolvedValue(1),
    assertWithinDailyLimit: jest.fn().mockResolvedValue(undefined),
  };

  const service = new TransactionService(txQueue as any, prisma as any, kycService as any);
  return { service, prisma, txQueue, kycService };
}

// ---------------------------------------------------------------------------
// sendTransfer tests (kept from original spec, updated for new service shape)
// ---------------------------------------------------------------------------

describe('TransactionService.sendTransfer', () => {
  it('enqueues transfers with KYC checks and bounded retry options', async () => {
    const { service, prisma, txQueue, kycService } = buildService({});

    await expect(
      service.sendTransfer('user-123', {
        destinationPublicKey: 'GDESTINATION',
        amount: '10',
        assetCode: 'XLM',
        memo: 'invoice',
      }),
    ).resolves.toEqual({ txId: 'tx-new', status: 'PENDING' });

    expect(kycService.normalizeAmountToUsd).toHaveBeenCalledWith('10', 'XLM');
    expect(kycService.assertWithinDailyLimit).toHaveBeenCalledWith('user-123', 1);
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-123',
        walletId: 'wallet-456',
        destination: 'GDESTINATION',
        amount: '10',
        assetCode: 'XLM',
        assetIssuer: null,
        memo: 'invoice',
        status: 'PENDING',
      },
    });
    expect(txQueue.add).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({ txId: 'tx-new', userId: 'user-123' }),
      TRANSACTION_QUEUE_OPTIONS,
    );
  });

  it('throws NotFoundException when the user has no wallet', async () => {
    const { service } = buildService({
      walletFindUnique: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.sendTransfer('user-no-wallet', {
        destinationPublicKey: 'GDESTINATION',
        amount: '10',
        assetCode: 'XLM',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// getHistory pagination tests
// ---------------------------------------------------------------------------

describe('TransactionService.getHistory', () => {
  describe('first page — no cursor', () => {
    it('returns up to limit records and a nextCursor when more pages exist', async () => {
      // 30 total rows, page size 25 → first page returns 25 rows + nextCursor
      const rows = makeRows(30);
      const { service } = buildService({ txRows: rows, total: 30 });

      const result = await service.getHistory('user-123', { limit: 25 });

      expect(result.data).toHaveLength(25);
      expect(result.nextCursor).toBe('tx-25');
      expect(result.total).toBe(30);
    });

    it('returns all records and null nextCursor when count ≤ limit', async () => {
      const rows = makeRows(10);
      const { service } = buildService({ txRows: rows, total: 10 });

      const result = await service.getHistory('user-123', { limit: 25 });

      expect(result.data).toHaveLength(10);
      expect(result.nextCursor).toBeNull();
      expect(result.total).toBe(10);
    });

    it('uses HISTORY_DEFAULT_LIMIT when limit is omitted', async () => {
      const rows = makeRows(HISTORY_DEFAULT_LIMIT + 5);
      const { service, prisma } = buildService({ txRows: rows, total: rows.length });

      await service.getHistory('user-123');

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: HISTORY_DEFAULT_LIMIT + 1 }),
      );
    });
  });

  describe('cursor navigation', () => {
    it('uses cursor + skip:1 to fetch the next page', async () => {
      const rows = makeRows(50);
      const { service, prisma } = buildService({ txRows: rows, total: 50 });

      const result = await service.getHistory('user-123', { limit: 25, cursor: 'tx-25' });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'tx-25' },
          skip: 1,
          take: 26,
        }),
      );
      // rows 26–50: 25 items, last page
      expect(result.data).toHaveLength(25);
      expect(result.nextCursor).toBeNull();
    });

    it('returns nextCursor when a third page still exists', async () => {
      const rows = makeRows(80);
      const { service } = buildService({ txRows: rows, total: 80 });

      const page2 = await service.getHistory('user-123', { limit: 25, cursor: 'tx-25' });

      expect(page2.data).toHaveLength(25);
      expect(page2.nextCursor).toBe('tx-50');
    });
  });

  describe('empty history', () => {
    it('returns empty data, null nextCursor, and total 0', async () => {
      const { service } = buildService({ txRows: [], total: 0 });

      const result = await service.getHistory('user-123', { limit: 25 });

      expect(result.data).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
      expect(result.total).toBe(0);
    });
  });

  describe('limit validation', () => {
    it(`throws BadRequestException when limit exceeds ${HISTORY_MAX_LIMIT}`, async () => {
      const { service } = buildService({ txRows: [], total: 0 });

      await expect(
        service.getHistory('user-123', { limit: HISTORY_MAX_LIMIT + 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it(`accepts the maximum allowed limit of ${HISTORY_MAX_LIMIT}`, async () => {
      const rows = makeRows(HISTORY_MAX_LIMIT);
      const { service } = buildService({ txRows: rows, total: rows.length });

      await expect(
        service.getHistory('user-123', { limit: HISTORY_MAX_LIMIT }),
      ).resolves.toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// getHistory — server-side filter tests (Issue #146)
// ---------------------------------------------------------------------------

describe('TransactionService.getHistory — filters', () => {
  describe('status filter', () => {
    it('passes status into the Prisma where clause', async () => {
      const { service, prisma } = buildService({ txRows: [], total: 0 });

      await service.getHistory('user-123', { status: 'SUCCESS' });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-123', status: 'SUCCESS' }),
        }),
      );
      expect(prisma.transaction.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-123', status: 'SUCCESS' }),
        }),
      );
    });

    it('omits status from where when it is undefined', async () => {
      const { service, prisma } = buildService({ txRows: [], total: 0 });

      await service.getHistory('user-123', {});

      const whereArg = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0].where;
      expect(whereArg).not.toHaveProperty('status');
    });
  });

  describe('currency filter', () => {
    it('maps currency to assetCode in the Prisma where clause', async () => {
      const { service, prisma } = buildService({ txRows: [], total: 0 });

      await service.getHistory('user-123', { currency: 'USDC' });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-123', assetCode: 'USDC' }),
        }),
      );
    });

    it('omits assetCode from where when currency is undefined', async () => {
      const { service, prisma } = buildService({ txRows: [], total: 0 });

      await service.getHistory('user-123', {});

      const whereArg = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0].where;
      expect(whereArg).not.toHaveProperty('assetCode');
    });
  });

  describe('dateRange filter', () => {
    it('adds a createdAt gte filter for "7d"', async () => {
      const { service, prisma } = buildService({ txRows: [], total: 0 });
      const before = Date.now();

      await service.getHistory('user-123', { dateRange: '7d' });

      const whereArg = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0].where;
      expect(whereArg).toHaveProperty('createdAt');
      const gte: Date = whereArg.createdAt.gte;
      const after = Date.now();
      // gte should be approximately now − 7 days
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(before - gte.getTime()).toBeCloseTo(sevenDaysMs, -3);
      expect(after - gte.getTime()).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
    });

    it('adds a createdAt gte filter for "30d"', async () => {
      const { service, prisma } = buildService({ txRows: [], total: 0 });

      await service.getHistory('user-123', { dateRange: '30d' });

      const whereArg = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0].where;
      expect(whereArg).toHaveProperty('createdAt');
      const gte: Date = whereArg.createdAt.gte;
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      // Allow ±2 seconds of test-execution drift
      expect(Math.abs(Date.now() - gte.getTime() - thirtyDaysMs)).toBeLessThan(2000);
    });

    it('omits createdAt from where when dateRange is undefined', async () => {
      const { service, prisma } = buildService({ txRows: [], total: 0 });

      await service.getHistory('user-123', {});

      const whereArg = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0].where;
      expect(whereArg).not.toHaveProperty('createdAt');
    });
  });

  describe('combined filters', () => {
    it('applies status + currency + dateRange together', async () => {
      const { service, prisma } = buildService({ txRows: [], total: 0 });

      await service.getHistory('user-123', {
        status: 'FAILED',
        currency: 'XLM',
        dateRange: '7d',
      });

      const whereArg = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0].where;
      expect(whereArg).toMatchObject({
        userId: 'user-123',
        status: 'FAILED',
        assetCode: 'XLM',
        createdAt: { gte: expect.any(Date) },
      });
    });

    it('returns paginated results that respect the filtered total', async () => {
      // Only 5 FAILED rows out of 30 total match the filter.
      const failedRows = Array.from({ length: 5 }, (_, i) => ({
        id: `fail-${i + 1}`,
        userId: 'user-123',
        createdAt: new Date(),
        amount: '10',
        assetCode: 'XLM',
        status: 'FAILED',
      }));
      const { service } = buildService({ txRows: failedRows, total: 5 });

      const result = await service.getHistory('user-123', { status: 'FAILED', limit: 25 });

      expect(result.data).toHaveLength(5);
      expect(result.nextCursor).toBeNull();
      expect(result.total).toBe(5);
    });
  });
});