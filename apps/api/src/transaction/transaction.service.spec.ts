import { NotFoundException } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { TRANSACTION_QUEUE_OPTIONS } from './transaction-retry.config';

const mockWallet = { id: 'wallet-456', userId: 'user-123', publicKey: 'GPUBKEY' };

describe('TransactionService', () => {
  it('enqueues transfers with bounded exponential retry options', async () => {
    const txQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue(mockWallet),
      },
      transaction: {
        create: jest.fn().mockResolvedValue({ id: 'tx-123' }),
      },
    };
    const service = new TransactionService(txQueue as any, prisma as any);

    await expect(
      service.sendTransfer('user-123', {
        destinationPublicKey: 'GDESTINATION',
        amount: '10',
        assetCode: 'XLM',
        memo: 'invoice',
      }),
    ).resolves.toEqual({ txId: 'tx-123', status: 'PENDING' });

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
      {
        txId: 'tx-123',
        userId: 'user-123',
        destinationPublicKey: 'GDESTINATION',
        amount: '10',
        assetCode: 'XLM',
        memo: 'invoice',
      },
      TRANSACTION_QUEUE_OPTIONS,
    );
  });

  it('throws NotFoundException when the user has no wallet', async () => {
    const txQueue = { add: jest.fn() };
    const prisma = {
      wallet: { findUnique: jest.fn().mockResolvedValue(null) },
      transaction: { create: jest.fn() },
    };
    const service = new TransactionService(txQueue as any, prisma as any);

    await expect(
      service.sendTransfer('user-no-wallet', {
        destinationPublicKey: 'GDESTINATION',
        amount: '10',
        assetCode: 'XLM',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });
});
