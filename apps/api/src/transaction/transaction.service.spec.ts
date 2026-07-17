import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { PrismaService } from '../prisma/prisma.service';
import { KycService } from '../kyc/kyc.service';
import { TransactionService } from './transaction.service';

describe('TransactionService', () => {
  let service: TransactionService;
  let prismaService: PrismaService;
  let kycService: KycService;
  let txQueue: any;

  const mockPrismaService = {
    transaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
    },
  };

  const mockKycService = {
    normalizeAmountToUsd: jest.fn(),
    assertWithinDailyLimit: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockKycService.normalizeAmountToUsd.mockResolvedValue(100.0);
    mockKycService.assertWithinDailyLimit.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: KycService,
          useValue: mockKycService,
        },
        {
          provide: getQueueToken('transactions'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
    prismaService = module.get<PrismaService>(PrismaService);
    kycService = module.get<KycService>(KycService);
    txQueue = module.get(getQueueToken('transactions'));
  });

  describe('sendTransfer', () => {
    it('should create transaction record', async () => {
      const sendTransferDto = {
        destinationPublicKey: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        amount: '100.00',
        assetCode: 'XLM',
        memo: 'Transfer memo',
      };

      const createdTransaction = {
        id: 'tx-1',
        userId: 'user-1',
        walletId: 'wallet-1',
        destination: sendTransferDto.destinationPublicKey,
        amount: sendTransferDto.amount,
        assetCode: sendTransferDto.assetCode,
        assetIssuer: null,
        memo: sendTransferDto.memo,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        publicKey: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      });

      mockPrismaService.transaction.create.mockResolvedValue(
        createdTransaction,
      );

      const result = await service.sendTransfer('user-1', sendTransferDto);

      expect(mockPrismaService.transaction.create).toHaveBeenCalled();
      expect(result).toEqual({ txId: 'tx-1', status: 'PENDING' });
    });

    it('should throw error if wallet does not exist', async () => {
      const sendTransferDto = {
        destinationPublicKey: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        amount: '100.00',
        assetCode: 'XLM',
        memo: 'Transfer',
      };

      mockPrismaService.wallet.findUnique.mockResolvedValue(null);

      await expect(service.sendTransfer('user-1', sendTransferDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getTransactionsByWallet', () => {
    it('should return latest 50 transactions for wallet', async () => {
      const walletId = 'wallet-1';
      const transactions = Array.from({ length: 25 }, (_, i) => ({
        id: `tx-${i}`,
        userId: 'user-1',
        walletId: walletId,
        destination: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        amount: String((i + 1) * 10),
        assetCode: 'XLM',
        status: i % 2 === 0 ? 'SUCCESS' : 'PENDING',
        createdAt: new Date(Date.now() - i * 1000 * 60),
        updatedAt: new Date(Date.now() - i * 1000 * 60),
      }));

      mockPrismaService.transaction.findMany.mockResolvedValue(transactions);

      const result = await service.getTransactionsByWallet(walletId);

      expect(mockPrismaService.transaction.findMany).toHaveBeenCalledWith({
        where: { walletId: walletId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      expect(result).toEqual(transactions);
    });

    it('should return empty array if wallet has no transactions', async () => {
      const walletId = 'wallet-no-transactions';

      mockPrismaService.transaction.findMany.mockResolvedValue([]);

      const result = await service.getTransactionsByWallet(walletId);

      expect(result).toEqual([]);
    });
  });

  describe('getTransaction', () => {
    it('should return transaction by id', async () => {
      const transactionId = 'tx-1';
      const transaction = {
        id: transactionId,
        userId: 'user-1',
        walletId: 'wallet-1',
        destination: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        amount: '100.0',
        status: 'SUCCESS',
        createdAt: new Date(),
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(transaction);

      const result = await service.getTransaction(transactionId);

      expect(mockPrismaService.transaction.findUnique).toHaveBeenCalledWith({
        where: { id: transactionId },
      });
      expect(result).toEqual(transaction);
    });

    it('should throw NotFoundException if transaction not found', async () => {
      const transactionId = 'nonexistent-tx';

      mockPrismaService.transaction.findUnique.mockResolvedValue(null);

      await expect(service.getTransaction(transactionId)).rejects.toThrow(
        NotFoundException,
      );
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

  describe('updateRiskScore', () => {
    it('should update riskScore and flagged, and status to REVIEW if flagged is true', async () => {
      const tx = { id: 'tx-123', status: 'PENDING', flagged: false };
      const prismaMock = {
        transaction: {
          findUnique: jest.fn().mockResolvedValue(tx),
          update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...tx, ...data })),
        },
      };
      const service = new TransactionService(
        {} as any,
        prismaMock as any,
        {} as any,
      );

      const result = await service.updateRiskScore('tx-123', 0.8, true);

      expect(prismaMock.transaction.findUnique).toHaveBeenCalledWith({ where: { id: 'tx-123' } });
      expect(prismaMock.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-123' },
        data: { riskScore: 0.8, flagged: true, status: 'REVIEW' },
      });
      expect(result.status).toBe('REVIEW');
    });

    it('should throw NotFoundException if transaction does not exist', async () => {
      const prismaMock = {
        transaction: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      };
      const service = new TransactionService(
        {} as any,
        prismaMock as any,
        {} as any,
      );

      await expect(service.updateRiskScore('nonexistent', 0.2, false)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

function buildService(options: { txRows: any[]; total: number }) {
  const prismaMock = {
    transaction: {
      findMany: jest.fn().mockResolvedValue(options.txRows),
      count: jest.fn().mockResolvedValue(options.total),
    },
  };
  const service = new TransactionService(
    {} as any,
    prismaMock as any,
    {} as any,
  );
  return { service, prisma: prismaMock };
}