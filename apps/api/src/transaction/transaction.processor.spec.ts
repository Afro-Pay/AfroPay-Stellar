import { TransactionProcessor } from './transaction.processor';

function buildJob(attemptsMade: number, attempts = 3) {
  return {
    attemptsMade,
    opts: { attempts },
    data: {
      txId: 'tx-123',
      userId: 'user-123',
      destinationPublicKey: 'GDESTINATION',
      amount: '10',
      assetCode: 'XLM',
    },
  };
}

describe('TransactionProcessor failure tracking', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('records retrying status and failure reason before the final attempt', async () => {
    const failure = new Error('temporary Horizon timeout');
    const prisma = { transaction: { update: jest.fn().mockResolvedValue(undefined) } };
    const walletService = { getKeypair: jest.fn().mockRejectedValue(failure) };
    const processor = new TransactionProcessor(prisma as any, walletService as any);
    jest.spyOn((processor as any).logger, 'error').mockImplementation(() => undefined);

    await expect(processor.handleTransaction(buildJob(0) as any)).rejects.toThrow(failure);

    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-123' },
      data: {
        status: 'RETRYING',
        retryAttempts: 1,
        lastFailureReason: 'temporary Horizon timeout',
        failedAt: null,
      },
    });
  });

  it('marks the transaction failed and persists failedAt on the final attempt', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-23T05:00:00.000Z'));
    const failure = new Error('horizon transaction malformed');
    const prisma = { transaction: { update: jest.fn().mockResolvedValue(undefined) } };
    const walletService = { getKeypair: jest.fn().mockRejectedValue(failure) };
    const processor = new TransactionProcessor(prisma as any, walletService as any);
    jest.spyOn((processor as any).logger, 'error').mockImplementation(() => undefined);

    await expect(processor.handleTransaction(buildJob(2) as any)).rejects.toThrow(failure);

    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-123' },
      data: {
        status: 'FAILED',
        retryAttempts: 3,
        lastFailureReason: 'horizon transaction malformed',
        failedAt: new Date('2026-06-23T05:00:00.000Z'),
      },
    });
  });
});
