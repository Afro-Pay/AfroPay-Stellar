import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { PrismaService } from '../prisma/prisma.service';
import { KycService } from '../kyc/kyc.service';
import { TransactionService } from './transaction.service';

describe('TransactionService', () => {
  let service: TransactionService;

  const mockPrismaService = {
    transaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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
      expect(result).toEqual({ txId: 'tx-1', status: 'PENDING', idempotentReplay: false });
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

  describe('idempotency', () => {
    const dto = {
      destinationPublicKey: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
      amount: '50.00',
      assetCode: 'USDC',
      memo: 'invoice-42',
    };
    const KEY = '3f6d1e2a-9c4b-4b2e-8a1d-2b7c9e0f1a23';

    beforeEach(() => {
      mockPrismaService.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        publicKey: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      });
    });

    it('first request creates a record and enqueues one deterministic job', async () => {
      mockPrismaService.transaction.create.mockResolvedValue({ id: 'tx-1', status: 'PENDING' });

      const result = await service.sendTransfer('user-1', dto, KEY);

      expect(result).toEqual({ txId: 'tx-1', status: 'PENDING', idempotentReplay: false });
      expect(mockPrismaService.transaction.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ idempotencyKey: KEY }) }),
      );
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({ txId: 'tx-1' }),
        expect.objectContaining({ jobId: `send:user-1:${KEY}` }),
      );
    });

    it('duplicate with the same key replays the cached response — no new record or job', async () => {
      mockPrismaService.transaction.create.mockResolvedValue({ id: 'tx-1', status: 'PENDING' });

      const first = await service.sendTransfer('user-1', dto, KEY);
      const second = await service.sendTransfer('user-1', dto, KEY);

      expect(first).toEqual({ txId: 'tx-1', status: 'PENDING', idempotentReplay: false });
      expect(second).toEqual({ txId: 'tx-1', status: 'PENDING', idempotentReplay: true });
      // create and enqueue happened exactly once, on the first request.
      expect(mockPrismaService.transaction.create).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });

    it('different key creates a separate record', async () => {
      mockPrismaService.transaction.create
        .mockResolvedValueOnce({ id: 'tx-1', status: 'PENDING' })
        .mockResolvedValueOnce({ id: 'tx-2', status: 'PENDING' });

      const first = await service.sendTransfer('user-1', dto, KEY);
      const second = await service.sendTransfer(
        'user-1',
        dto,
        '00000000-0000-4000-8000-000000000000',
      );

      expect(first.txId).toBe('tx-1');
      expect(second.txId).toBe('tx-2');
      expect(second.idempotentReplay).toBe(false);
      expect(mockPrismaService.transaction.create).toHaveBeenCalledTimes(2);
    });

    it('concurrent duplicate that loses the unique-constraint race replays the winner', async () => {
      // Cache miss (e.g. a second replica): the row was already reserved, so the
      // insert hits the (userId, idempotencyKey) unique violation (P2002).
      mockPrismaService.transaction.create.mockRejectedValue({ code: 'P2002' });
      mockPrismaService.transaction.findFirst.mockResolvedValue({
        id: 'tx-winner',
        status: 'PENDING',
      });

      const result = await service.sendTransfer('user-1', dto, KEY);

      expect(result).toEqual({ txId: 'tx-winner', status: 'PENDING', idempotentReplay: true });
      expect(mockPrismaService.transaction.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.transaction.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', idempotencyKey: KEY },
      });
      // Re-enqueue reuses the deterministic jobId, so BullMQ dedups it.
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({ txId: 'tx-winner' }),
        expect.objectContaining({ jobId: `send:user-1:${KEY}` }),
      );
    });

    it('without a key, behaves as a normal (non-idempotent) send', async () => {
      mockPrismaService.transaction.create.mockResolvedValue({ id: 'tx-1', status: 'PENDING' });

      const result = await service.sendTransfer('user-1', dto);

      expect(result).toEqual({ txId: 'tx-1', status: 'PENDING', idempotentReplay: false });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({ txId: 'tx-1' }),
        expect.not.objectContaining({ jobId: expect.anything() }),
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
