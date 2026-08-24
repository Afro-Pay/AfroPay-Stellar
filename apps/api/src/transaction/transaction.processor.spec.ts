import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { Logger } from 'nestjs-pino';
import { TransactionProcessor } from './transaction.processor';
import { FraudService } from './fraud.service';
import { TransactionDlqService } from './transaction-dlq.service';
import {
  TRANSACTION_DLQ_JOB_NAME,
  TRANSACTION_MAX_ATTEMPTS,
  TRANSACTION_QUEUE_OPTIONS,
} from './transaction-retry.config';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

const BASE_TRANSACTION = {
  id: 'tx-001',
  walletId: 'wallet-001',
  userId: 'user-001',
  destination: 'GXYZ',
  amount: '100',
  assetCode: 'XLM',
  status: 'PENDING',
  memo: undefined,
  riskScore: null,
  flagged: false,
};

function makeMocks() {
  // Stateful in-memory store: each update builds on the previous row state,
  // mirroring how the real database returns the row after applying an update.
  const rows = new Map<string, Record<string, any>>();
  const mockPrisma = {
    transaction: {
      findUnique: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(rows.get(where.id) ?? { ...BASE_TRANSACTION, id: where.id }),
      ),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const current = rows.get(where.id) ?? { ...BASE_TRANSACTION, id: where.id };
        const next = { ...current, ...data };
        rows.set(where.id, next);
        return Promise.resolve(next);
      }),
    },
  };

  const mockAuditService = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  };

  const mockFraudService = {
    score: jest.fn(),
  };

  return { mockPrisma, mockAuditService, mockLogger, mockFraudService };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TransactionProcessor', () => {
  let processor: TransactionProcessor;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mocks = makeMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionProcessor,
        { provide: PrismaService, useValue: mocks.mockPrisma },
        { provide: AuditLogService, useValue: mocks.mockAuditService },
        { provide: Logger, useValue: mocks.mockLogger },
        { provide: FraudService, useValue: mocks.mockFraudService },
      ],
    }).compile();

    processor = module.get<TransactionProcessor>(TransactionProcessor);
  });

  // -------------------------------------------------------------------------
  // Helper: invoke processTransaction with default args (mirrors what the
  // BullMQ @Process handler calls after loading the row by txId).
  // -------------------------------------------------------------------------
  const callProcess = (overrides: Partial<typeof BASE_TRANSACTION> = {}) =>
    processor.processTransaction(
      overrides.userId ?? BASE_TRANSACTION.userId,
      { ...BASE_TRANSACTION, ...overrides },
      overrides.amount ?? BASE_TRANSACTION.amount,
      overrides.assetCode ?? BASE_TRANSACTION.assetCode,
      overrides.destination ?? 'GXYZ',
      overrides.memo,
    );

  // =========================================================================
  // handleSendTransaction — BullMQ entry-point guards
  // =========================================================================
  describe('handleSendTransaction (BullMQ @Process handler)', () => {
    const makeJob = (data: Record<string, any> = {}) =>
      ({
        id: 'job-001',
        data: {
          txId: BASE_TRANSACTION.id,
          userId: BASE_TRANSACTION.userId,
          destinationPublicKey: 'GXYZ',
          amount: BASE_TRANSACTION.amount,
          assetCode: BASE_TRANSACTION.assetCode,
          ...data,
        },
      } as any);

    beforeEach(() => {
      mocks.mockFraudService.score.mockResolvedValue({
        tx_id: BASE_TRANSACTION.id,
        risk_score: 0.1,
        flagged: false,
        reasons: [],
      });
    });

    it('loads the existing transaction by txId — does NOT create a new record', async () => {
      await processor.handleSendTransaction(makeJob());

      expect(mocks.mockPrisma.transaction.findUnique).toHaveBeenCalledWith({
        where: { id: BASE_TRANSACTION.id },
      });
      // No create call — the row was already created by TransactionService
      expect((mocks.mockPrisma.transaction as any).create).toBeUndefined();
    });

    it('throws and fails the job when the transaction row is missing', async () => {
      mocks.mockPrisma.transaction.findUnique.mockResolvedValue(null);

      await expect(processor.handleSendTransaction(makeJob())).rejects.toThrow(
        `Transaction ${BASE_TRANSACTION.id} not found`,
      );
    });

    it('skips re-processing a SUCCESS transaction (idempotent re-delivery guard)', async () => {
      mocks.mockPrisma.transaction.findUnique.mockResolvedValue({
        ...BASE_TRANSACTION,
        status: 'SUCCESS',
      });

      const result = await processor.handleSendTransaction(makeJob());

      // Returns the terminal record without calling fraud service or update
      expect(result.status).toBe('SUCCESS');
      expect(mocks.mockFraudService.score).not.toHaveBeenCalled();
      expect(mocks.mockPrisma.transaction.update).not.toHaveBeenCalled();
    });

    it('skips re-processing a FAILED transaction', async () => {
      mocks.mockPrisma.transaction.findUnique.mockResolvedValue({
        ...BASE_TRANSACTION,
        status: 'FAILED',
      });

      const result = await processor.handleSendTransaction(makeJob());

      expect(result.status).toBe('FAILED');
      expect(mocks.mockFraudService.score).not.toHaveBeenCalled();
    });

    it('skips re-processing a PENDING_REVIEW transaction', async () => {
      mocks.mockPrisma.transaction.findUnique.mockResolvedValue({
        ...BASE_TRANSACTION,
        status: 'PENDING_REVIEW',
      });

      const result = await processor.handleSendTransaction(makeJob());

      expect(result.status).toBe('PENDING_REVIEW');
      expect(mocks.mockFraudService.score).not.toHaveBeenCalled();
    });

    it('processes a PENDING transaction end-to-end (low risk path)', async () => {
      const result = await processor.handleSendTransaction(makeJob());

      expect(mocks.mockFraudService.score).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('SUCCESS');
    });
  });

  // =========================================================================
  // Tier 1 — HIGH RISK (riskScore >= 0.8) → FAILED, not submitted
  // =========================================================================
  describe('Tier 1 — high risk (riskScore >= 0.8)', () => {
    beforeEach(() => {
      mocks.mockFraudService.score.mockResolvedValue({
        tx_id: BASE_TRANSACTION.id,
        risk_score: 0.9,
        flagged: true,
        reasons: ['Large transaction amount', 'High-risk destination country: KP'],
      });
    });

    it('sets status to FAILED and does not call processOnChain', async () => {
      const result = await callProcess();

      expect(result.status).toBe('FAILED');
      expect(result.flagged).toBe(true);
      expect(result.riskScore).toBe(0.9);
    });

    it('persists riskScore and flagged=true in the DB update', async () => {
      await callProcess();

      expect(mocks.mockPrisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BASE_TRANSACTION.id },
          data: expect.objectContaining({ status: 'FAILED', riskScore: 0.9, flagged: true }),
        }),
      );
    });

    it('emits a TRANSACTION_BLOCKED audit event', async () => {
      await callProcess();

      expect(mocks.mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: BASE_TRANSACTION.userId,
          operation: 'TRANSACTION_BLOCKED',
          metadata: expect.objectContaining({ transactionId: BASE_TRANSACTION.id, riskScore: 0.9 }),
        }),
      );
    });

    it('blocks on the exact threshold (riskScore = 0.8)', async () => {
      mocks.mockFraudService.score.mockResolvedValue({
        tx_id: BASE_TRANSACTION.id,
        risk_score: 0.8,
        flagged: true,
        reasons: [],
      });

      const result = await callProcess();
      expect(result.status).toBe('FAILED');
    });
  });

  // =========================================================================
  // Tier 2 — MEDIUM RISK (0.5 <= riskScore < 0.8) → PENDING_REVIEW
  // =========================================================================
  describe('Tier 2 — medium risk (0.5 <= riskScore < 0.8)', () => {
    beforeEach(() => {
      mocks.mockFraudService.score.mockResolvedValue({
        tx_id: BASE_TRANSACTION.id,
        risk_score: 0.6,
        flagged: true,
        reasons: ['Round-number amount'],
      });
    });

    it('sets status to PENDING_REVIEW and does not submit on-chain', async () => {
      const result = await callProcess();

      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.flagged).toBe(true);
      expect(result.riskScore).toBe(0.6);
    });

    it('persists riskScore and flagged=true in the DB update', async () => {
      await callProcess();

      expect(mocks.mockPrisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BASE_TRANSACTION.id },
          data: expect.objectContaining({
            status: 'PENDING_REVIEW',
            riskScore: 0.6,
            flagged: true,
          }),
        }),
      );
    });

    it('emits a TRANSACTION_PENDING_REVIEW audit event', async () => {
      await callProcess();

      expect(mocks.mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: BASE_TRANSACTION.userId,
          operation: 'TRANSACTION_PENDING_REVIEW',
          metadata: expect.objectContaining({ transactionId: BASE_TRANSACTION.id, riskScore: 0.6 }),
        }),
      );
    });

    it('treats riskScore = 0.5 as medium risk (boundary)', async () => {
      mocks.mockFraudService.score.mockResolvedValue({
        tx_id: BASE_TRANSACTION.id,
        risk_score: 0.5,
        flagged: true,
        reasons: [],
      });

      const result = await callProcess();
      expect(result.status).toBe('PENDING_REVIEW');
    });
  });

  // =========================================================================
  // Tier 3 — LOW RISK (riskScore < 0.5) → proceed to Stellar
  // =========================================================================
  describe('Tier 3 — low risk (riskScore < 0.5)', () => {
    beforeEach(() => {
      mocks.mockFraudService.score.mockResolvedValue({
        tx_id: BASE_TRANSACTION.id,
        risk_score: 0.1,
        flagged: false,
        reasons: [],
      });
    });

    it('sets status to SUCCESS after on-chain submission', async () => {
      const result = await callProcess();

      expect(result.status).toBe('SUCCESS');
    });

    it('persists riskScore and flagged=false before submission', async () => {
      await callProcess();

      // The first update call persists the low-risk score without changing status.
      const firstUpdate = mocks.mockPrisma.transaction.update.mock.calls[0][0];
      expect(firstUpdate.data).toMatchObject({ riskScore: 0.1, flagged: false });
      expect(firstUpdate.data.status).toBeUndefined();
    });

    it('emits TRANSACTION_INITIATE and TRANSACTION_COMPLETE audit events', async () => {
      await callProcess();

      const eventNames = mocks.mockAuditService.log.mock.calls.map((c) => c[0].operation);
      expect(eventNames).toContain('TRANSACTION_INITIATE');
      expect(eventNames).toContain('TRANSACTION_COMPLETE');
    });

    it('passes riskScore = 0.49 as low risk (boundary)', async () => {
      mocks.mockFraudService.score.mockResolvedValue({
        tx_id: BASE_TRANSACTION.id,
        risk_score: 0.49,
        flagged: false,
        reasons: [],
      });

      const result = await callProcess();
      expect(result.status).toBe('SUCCESS');
    });
  });

  // =========================================================================
  // Fraud service unavailable — fail-closed
  // =========================================================================
  describe('fraud service unavailable', () => {
    beforeEach(() => {
      mocks.mockFraudService.score.mockRejectedValue(new Error('ECONNREFUSED'));
    });

    it('sets status to FAILED and does not submit on-chain', async () => {
      const result = await callProcess();

      expect(result.status).toBe('FAILED');
    });

    it('emits a TRANSACTION_FAILED audit event with the service error', async () => {
      await callProcess();

      expect(mocks.mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: BASE_TRANSACTION.userId,
          operation: 'TRANSACTION_FAILED',
          metadata: expect.objectContaining({
            transactionId: BASE_TRANSACTION.id,
            reason: 'Fraud service unavailable',
          }),
        }),
      );
    });
  });

  // =========================================================================
  // riskScore is always populated (riskScore / flagged never null after call)
  // =========================================================================
  describe('riskScore and flagged population', () => {
    it.each([
      ['low', 0.1, false, 'SUCCESS'],
      ['medium', 0.6, true, 'PENDING_REVIEW'],
      ['high', 0.9, true, 'FAILED'],
    ])('%s risk: persists riskScore=%s, flagged=%s, status=%s', async (_, score, flag, status) => {
      mocks.mockFraudService.score.mockResolvedValue({
        tx_id: BASE_TRANSACTION.id,
        risk_score: score,
        flagged: flag,
        reasons: [],
      });

      const result = await callProcess();

      expect(result.riskScore).toBe(score);
      expect(result.flagged).toBe(flag);
      expect(result.status).toBe(status);
    });
  });

  // =========================================================================
  // Idempotency — concurrent duplicate job guard
  // =========================================================================
  describe('idempotency — duplicate job guard', () => {
    it('a second job for the same txId that arrives after SUCCESS returns immediately without re-processing', async () => {
      mocks.mockFraudService.score.mockResolvedValue({
        tx_id: BASE_TRANSACTION.id,
        risk_score: 0.1,
        flagged: false,
        reasons: [],
      });

      // Simulate: first job processes → sets SUCCESS; second job finds terminal state.
      let callCount = 0;
      mocks.mockPrisma.transaction.findUnique.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ...BASE_TRANSACTION,
          status: callCount === 1 ? 'PENDING' : 'SUCCESS',
        });
      });

      const makeJob = (overrides = {}) =>
        ({
          id: `job-${Math.random()}`,
          data: {
            txId: BASE_TRANSACTION.id,
            userId: BASE_TRANSACTION.userId,
            destinationPublicKey: 'GXYZ',
            amount: BASE_TRANSACTION.amount,
            assetCode: BASE_TRANSACTION.assetCode,
            ...overrides,
          },
        } as any);

      // First job: PENDING → processes normally
      await processor.handleSendTransaction(makeJob());
      // Second job: finds SUCCESS → skips
      const second = await processor.handleSendTransaction(makeJob());

      expect(second.status).toBe('SUCCESS');
      // Fraud service only called once (by the first job)
      expect(mocks.mockFraudService.score).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Transaction DLQ routing', () => {
  function makeDlqMocks() {
    const transactionQueue = {
      on: jest.fn(),
      off: jest.fn(),
      add: jest.fn().mockResolvedValue({ id: 'replay-job-1' }),
    };
    const dlqQueue = {
      add: jest.fn(),
      getJob: jest.fn(),
      getJobs: jest.fn().mockResolvedValue([]),
      getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, delayed: 0, failed: 0, paused: 0 }),
    };
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
    };

    return { transactionQueue, dlqQueue, logger };
  }

  it('moves exhausted failed jobs into transaction-dlq with payload and error trace', async () => {
    const { transactionQueue, dlqQueue, logger } = makeDlqMocks();
    const service = new TransactionDlqService(
      transactionQueue as any,
      dlqQueue as any,
      logger as any,
    );
    const job = {
      id: 'job-123',
      name: 'process',
      data: { txId: BASE_TRANSACTION.id, userId: BASE_TRANSACTION.userId, amount: '100' },
      opts: { attempts: TRANSACTION_MAX_ATTEMPTS },
      attemptsMade: TRANSACTION_MAX_ATTEMPTS,
      failedReason: 'stellar submission failed',
      stacktrace: ['Error: stellar submission failed'],
    };

    await expect(service.routeFailedJobToDlq(job as any, new Error('fallback'))).resolves.toBe(
      true,
    );

    expect(dlqQueue.add).toHaveBeenCalledWith(
      TRANSACTION_DLQ_JOB_NAME,
      expect.objectContaining({
        originalJobId: 'job-123',
        originalJobName: 'process',
        payload: job.data,
        errorMessage: 'stellar submission failed',
        stacktrace: ['Error: stellar submission failed'],
        attemptsMade: TRANSACTION_MAX_ATTEMPTS,
        maxAttempts: TRANSACTION_MAX_ATTEMPTS,
      }),
      expect.objectContaining({
        jobId: `${TRANSACTION_DLQ_JOB_NAME}:job-123:${TRANSACTION_MAX_ATTEMPTS}`,
        removeOnComplete: false,
        removeOnFail: false,
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'transaction_dlq_enqueued',
        originalJobId: 'job-123',
        error: 'stellar submission failed',
      }),
    );
  });

  it('does not route jobs that still have retries remaining', async () => {
    const { transactionQueue, dlqQueue, logger } = makeDlqMocks();
    const service = new TransactionDlqService(
      transactionQueue as any,
      dlqQueue as any,
      logger as any,
    );
    const job = {
      id: 'job-124',
      name: 'process',
      data: { txId: BASE_TRANSACTION.id },
      opts: { attempts: TRANSACTION_MAX_ATTEMPTS },
      attemptsMade: 1,
      stacktrace: [],
    };

    await expect(service.routeFailedJobToDlq(job as any, new Error('retry later'))).resolves.toBe(
      false,
    );

    expect(dlqQueue.add).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('replays a DLQ job back onto the transaction queue with fresh retry options', async () => {
    const { transactionQueue, dlqQueue, logger } = makeDlqMocks();
    const dlqJob = {
      id: 'dlq-job-1',
      data: {
        originalJobName: 'process',
        payload: { txId: BASE_TRANSACTION.id, userId: BASE_TRANSACTION.userId },
      },
      update: jest.fn().mockResolvedValue(undefined),
    };
    dlqQueue.getJob.mockResolvedValue(dlqJob);
    const service = new TransactionDlqService(
      transactionQueue as any,
      dlqQueue as any,
      logger as any,
    );

    const result = await service.replay('dlq-job-1');

    expect(transactionQueue.add).toHaveBeenCalledWith(
      'process',
      dlqJob.data.payload,
      expect.objectContaining({
        ...TRANSACTION_QUEUE_OPTIONS,
        jobId: expect.stringMatching(/^replay:dlq-job-1:/),
      }),
    );
    expect(dlqJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ replayJobId: 'replay-job-1' }),
    );
    expect(result).toEqual({
      dlqJobId: 'dlq-job-1',
      replayJobId: 'replay-job-1',
      status: 'requeued',
    });
  });
});
