import { Injectable, Optional } from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { AuditCategory, AuditLogService, AuditOutcome } from '../audit/audit.service';
import { Logger } from 'nestjs-pino';
import { FraudService } from './fraud.service';
import { assertTransactionAmountIntegrity } from './transaction-integrity';
import { RedisLockService } from '../common/lock/lock.service';

/** riskScore >= this threshold → reject outright (FAILED). */
const FRAUD_BLOCK_THRESHOLD = 0.8;

/** riskScore >= this threshold → hold for manual review (PENDING_REVIEW). */
const FRAUD_REVIEW_THRESHOLD = 0.5;

/**
 * Shape of data placed on the 'transactions' queue by TransactionService.
 * The transaction record already exists in the DB when this job runs;
 * the processor loads it by txId rather than creating a second record.
 */
export interface TransactionJobData {
  txId: string;
  userId: string;
  destinationPublicKey: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
}

@Processor('transactions')
@Injectable()
export class TransactionProcessor {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditLogService,
    private logger: Logger,
    private fraudService: FraudService,
    @Optional() private lockService?: RedisLockService,
  ) {}

  /**
   * BullMQ worker entry-point. Invoked once per job on the 'transactions' queue.
   *
   * Idempotency at the processor level:
   * - BullMQ deduplicates jobs by `jobId` (`send:{userId}:{idempotencyKey}`),
   *   so a duplicate POST that races past the Redis + DB guards still collapses
   *   to a single job execution here.
   * - The processor loads the existing Transaction row (created by
   *   TransactionService.sendTransfer) instead of creating a new one, so no
   *   duplicate DB records are ever produced.
   * - If the row is already in a terminal state (SUCCESS / FAILED /
   *   PENDING_REVIEW) we skip re-processing and return early — handles the
   *   edge case of a job being retried after the transaction already settled.
   */
  @Process('process')
  async handleSendTransaction(job: Job<TransactionJobData>) {
    const { txId, userId, destinationPublicKey, amount, assetCode, memo } = job.data;

    // Load the pre-created transaction record (created by TransactionService).
    const transaction = await this.prisma.transaction.findUnique({ where: { id: txId } });

    if (!transaction) {
      // Should never happen — log and fail the job without retrying.
      this.logger.error({ event: 'transaction_job_missing', txId, jobId: job.id });
      throw new Error(`Transaction ${txId} not found for job ${job.id}`);
    }

    // Guard: skip re-processing if the transaction already reached a terminal
    // state (e.g. job retried after SUCCESS/FAILED, or concurrent duplicate job
    // that slipped through before BullMQ deduplication kicked in).
    if (['SUCCESS', 'FAILED', 'PENDING_REVIEW'].includes(transaction.status)) {
      this.logger.log({
        event: 'transaction_job_skipped_terminal',
        txId,
        status: transaction.status,
        jobId: job.id,
      });
      return transaction;
    }

    const lockService = this.lockService ?? new RedisLockService();
    return lockService.withLock(
      `lock:escrow:${transaction.id}`,
      () => this.processTransaction(userId, transaction, amount, assetCode, destinationPublicKey, memo),
    );
  }

  /**
   * Core processing logic — shared between the BullMQ handler and direct calls
   * in tests. Runs fraud checks then submits on-chain.
   */
  async processTransaction(
    userId: string,
    transaction: { id: string; walletId: string; amount: string; destination?: string; [key: string]: any },
    amount: string,
    assetCode: string,
    toAddress: string,
    memo?: string,
  ) {
    // Fail closed if the stored value differs from the amount that passed the
    // request/simulation checks. Never score or submit a mutated transaction.
    assertTransactionAmountIntegrity(amount, transaction.amount);

    // Audit: Transaction initiated
    await this.auditService.log({
      userId,
      category: AuditCategory.TRANSACTION,
      operation: 'TRANSACTION_INITIATE',
      outcome: AuditOutcome.SUCCESS,
      metadata: { transactionId: transaction.id, toAddress, amount, assetCode },
    });

    this.logger.log({
      event: 'transaction_initiated',
      userId,
      transactionId: transaction.id,
      toAddress,
      amount,
      assetCode,
    });

    // -------------------------------------------------------------------------
    // Fraud check — must complete before any on-chain submission.
    // -------------------------------------------------------------------------
    const fraudResult = await this.runFraudCheck(userId, transaction, amount, assetCode, toAddress);
    if (fraudResult.blocked) {
      return fraudResult.updatedTx!;
    }

    // -------------------------------------------------------------------------
    // On-chain submission
    // -------------------------------------------------------------------------
    try {
      const result = await this.processOnChain(transaction);

      const updated = await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: 'SUCCESS',
          stellarTxHash: result.hash,
          ...(fraudResult.riskScore !== undefined ? { riskScore: fraudResult.riskScore } : {}),
          ...(fraudResult.flagged !== undefined ? { flagged: fraudResult.flagged } : {}),
        },
      });

      await this.auditService.log({
        userId,
        category: AuditCategory.TRANSACTION,
        operation: 'TRANSACTION_COMPLETE',
        outcome: AuditOutcome.SUCCESS,
        txHash: result.hash,
        metadata: { transactionId: transaction.id, toAddress, amount },
      });

      this.logger.log({
        event: 'transaction_completed',
        userId,
        transactionId: transaction.id,
        txHash: result.hash,
      });

      return updated;
    } catch (error) {
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED' },
      });

      await this.auditService.log({
        userId,
        category: AuditCategory.TRANSACTION,
        operation: 'TRANSACTION_FAILED',
        outcome: AuditOutcome.FAILURE,
        metadata: { transactionId: transaction.id, toAddress, amount, error: error.message },
      });

      this.logger.error({
        event: 'transaction_failed',
        userId,
        transactionId: transaction.id,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Calls the fraud scoring service and applies the three-tier policy:
   *
   * | riskScore         | action                              |
   * |-------------------|-------------------------------------|
   * | >= 0.8            | FAILED — blocked, not submitted     |
   * | >= 0.5 and < 0.8  | PENDING_REVIEW — held for review    |
   * | < 0.5             | proceed to on-chain submission      |
   *
   * The riskScore and flagged fields are always persisted regardless of tier.
   *
   * Returns `{ blocked: true, updatedTx }` when the transaction should not
   * proceed to Stellar, or `{ blocked: false }` when it is safe to submit.
   */
  private async runFraudCheck(
    userId: string,
    transaction: { id: string; [key: string]: any },
    amount: string,
    assetCode: string,
    destination: string,
  ): Promise<{ blocked: boolean; updatedTx?: any; riskScore?: number; flagged?: boolean }> {
    let riskScore: number;
    let flagged: boolean;
    let reasons: string[];

    try {
      const fraudResponse = await this.fraudService.score({
        tx_id: transaction.id,
        user_id: userId,
        amount: parseFloat(amount),
        asset_code: assetCode,
        destination,
      });

      riskScore = fraudResponse.risk_score;
      flagged = fraudResponse.flagged;
      reasons = fraudResponse.reasons;
    } catch (err) {
      // Fail-closed: if the fraud service is unreachable we do not allow the
      // transaction to proceed — better to block than to bypass fraud checks.
      this.logger.error({
        event: 'fraud_service_error',
        transactionId: transaction.id,
        error: (err as Error).message,
      });

      const updatedTx = await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED', riskScore: null, flagged: false },
      });

      await this.auditService.log({
        userId,
        category: AuditCategory.TRANSACTION,
        operation: 'TRANSACTION_FAILED',
        outcome: AuditOutcome.FAILURE,
        metadata: {
          transactionId: transaction.id,
          reason: 'Fraud service unavailable',
          error: (err as Error).message,
        },
      });

      return { blocked: true, updatedTx };
    }

    // --- Tier 1: block (riskScore >= 0.8) ---
    if (riskScore >= FRAUD_BLOCK_THRESHOLD) {
      this.logger.warn({
        event: 'transaction_blocked_high_risk',
        transactionId: transaction.id,
        riskScore,
        reasons,
      });

      const updatedTx = await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'FAILED', riskScore, flagged: true },
      });

      await this.auditService.log({
        userId,
        category: AuditCategory.TRANSACTION,
        operation: 'TRANSACTION_BLOCKED',
        outcome: AuditOutcome.FAILURE,
        metadata: {
          transactionId: transaction.id,
          riskScore,
          reasons,
          reason: 'High fraud risk score — transaction blocked',
        },
      });

      return { blocked: true, updatedTx };
    }

    // --- Tier 2: hold for review (0.5 <= riskScore < 0.8) ---
    if (riskScore >= FRAUD_REVIEW_THRESHOLD) {
      this.logger.warn({
        event: 'transaction_pending_review',
        transactionId: transaction.id,
        riskScore,
        reasons,
      });

      const updatedTx = await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'PENDING_REVIEW', riskScore, flagged: true },
      });

      await this.auditService.log({
        userId,
        category: AuditCategory.TRANSACTION,
        operation: 'TRANSACTION_PENDING_REVIEW',
        outcome: AuditOutcome.SUCCESS,
        metadata: {
          transactionId: transaction.id,
          riskScore,
          reasons,
          reason: 'Medium fraud risk score — held for manual review',
        },
      });

      return { blocked: true, updatedTx };
    }

    // --- Tier 3: low risk — persist score and allow submission ---
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: { riskScore, flagged },
    });

    this.logger.log({
      event: 'transaction_fraud_check_passed',
      transactionId: transaction.id,
      riskScore,
    });

    return { blocked: false, riskScore, flagged };
  }

  private async processOnChain(transaction: any): Promise<{ hash: string }> {
    // In production this interacts with Stellar/Soroban.
    return { hash: '0x' + Math.random().toString(16).substring(2) };
  }
}
