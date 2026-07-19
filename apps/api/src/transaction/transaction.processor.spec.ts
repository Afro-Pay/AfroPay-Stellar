import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { TransactionProcessor } from './transaction.processor';

describe('TransactionProcessor', () => {
  let processor: TransactionProcessor;
  let prismaService: PrismaService;

  const mockPrismaService = {
    transaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionProcessor,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: WalletService,
          useValue: {
            getKeypair: jest.fn(),
          },
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get<TransactionProcessor>(TransactionProcessor);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('processTransaction', () => {
    it('should successfully submit transaction and update status to SUCCESS', async () => {
      const transactionId = 'tx-1';
      const transaction = {
        id: transactionId,
        fromWalletId: 'wallet-1',
        toAddress: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        amount: 100.0,
        assetCode: 'XLM',
        memo: 'Test transfer',
        status: 'PENDING',
        retryCount: 0,
      };

      const txHash = 'abc123def456xyz789';

      mockPrismaService.transaction.findUnique.mockResolvedValue(transaction);
      mockPrismaService.transaction.update.mockResolvedValue({
        ...transaction,
        status: 'SUCCESS',
        txHash,
      });

      const result = await processor.processTransaction(transactionId);

      expect(mockPrismaService.transaction.findUnique).toHaveBeenCalledWith({
        where: { id: transactionId },
      });
      expect(mockPrismaService.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: transactionId },
        }),
      );
      expect(result.status).toBe('SUCCESS');
    });

    it('should update status to RETRYING on first failed attempt', async () => {
      const transactionId = 'tx-1';
      const transaction = {
        id: transactionId,
        status: 'PENDING',
        retryCount: 0,
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(transaction);
      mockPrismaService.transaction.update.mockResolvedValue({
        ...transaction,
        status: 'RETRYING',
        retryCount: 1,
      });

      const result = await processor.processTransaction(transactionId);

      expect(result.status).toBe('RETRYING');
    });

    it('should update status to FAILED on 3rd retry attempt', async () => {
      const transactionId = 'tx-1';
      const transaction = {
        id: transactionId,
        status: 'RETRYING',
        retryCount: 2,
      };

      mockPrismaService.transaction.findUnique.mockResolvedValue(transaction);
      mockPrismaService.transaction.update.mockResolvedValue({
        ...transaction,
        status: 'FAILED',
        retryCount: 3,
      });

      const result = await processor.processTransaction(transactionId);

      expect(result.status).toBe('FAILED');
    });

    it('should throw error if transaction not found', async () => {
      const transactionId = 'nonexistent-tx';

      mockPrismaService.transaction.findUnique.mockResolvedValue(null);

      await expect(processor.processTransaction(transactionId)).rejects.toThrow(
        'Transaction not found',
      );
    });
  });
});
