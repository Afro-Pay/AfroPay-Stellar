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
