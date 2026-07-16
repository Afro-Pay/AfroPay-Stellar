import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionService } from './transaction.service';

describe('TransactionService', () => {
  let service: TransactionService;
  let prismaService: PrismaService;

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

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('sendTransfer', () => {
    it('should create transaction record', async () => {
      const sendTransferDto = {
        fromWalletId: 'wallet-1',
        toAddress: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        amount: '100.00',
        assetCode: 'XLM',
        memo: 'Transfer memo',
      };

      const createdTransaction = {
        id: 'tx-1',
        ...sendTransferDto,
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

      const result = await service.sendTransfer(sendTransferDto);

      expect(mockPrismaService.transaction.create).toHaveBeenCalled();
      expect(result).toEqual(createdTransaction);
    });

    it('should throw error if wallet does not exist', async () => {
      const sendTransferDto = {
        fromWalletId: 'nonexistent-wallet',
        toAddress: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        amount: '100.00',
        assetCode: 'XLM',
        memo: 'Transfer',
      };

      mockPrismaService.wallet.findUnique.mockResolvedValue(null);

      await expect(service.sendTransfer(sendTransferDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getTransactionHistory', () => {
    it('should return latest 50 transactions for wallet', async () => {
      const walletId = 'wallet-1';
      const transactions = Array.from({ length: 25 }, (_, i) => ({
        id: `tx-${i}`,
        fromWalletId: walletId,
        toAddress: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        amount: (i + 1) * 10,
        assetCode: 'XLM',
        status: i % 2 === 0 ? 'SUCCESS' : 'PENDING',
        createdAt: new Date(Date.now() - i * 1000 * 60),
        updatedAt: new Date(Date.now() - i * 1000 * 60),
      }));

      mockPrismaService.transaction.findMany.mockResolvedValue(transactions);

      const result = await service.getTransactionHistory(walletId);

      expect(mockPrismaService.transaction.findMany).toHaveBeenCalledWith({
        where: { fromWalletId: walletId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      expect(result).toEqual(transactions);
    });

    it('should return empty array if wallet has no transactions', async () => {
      const walletId = 'wallet-no-transactions';

      mockPrismaService.transaction.findMany.mockResolvedValue([]);

      const result = await service.getTransactionHistory(walletId);

      expect(result).toEqual([]);
    });
  });

  describe('getTransaction', () => {
    it('should return transaction by id', async () => {
      const transactionId = 'tx-1';
      const transaction = {
        id: transactionId,
        fromWalletId: 'wallet-1',
        toAddress: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        amount: 100.0,
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
});