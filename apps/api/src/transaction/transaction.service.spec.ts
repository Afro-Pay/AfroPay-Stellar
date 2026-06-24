import { TransactionService } from './transaction.service';
import { TRANSACTION_QUEUE_OPTIONS } from './transaction-retry.config';

describe('TransactionService', () => {
  it('enqueues transfers with bounded exponential retry options', async () => {
    const txQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
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
});
