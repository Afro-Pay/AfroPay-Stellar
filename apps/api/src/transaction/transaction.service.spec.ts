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
