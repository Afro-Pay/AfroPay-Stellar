import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Logger } from 'nestjs-pino';
import { FraudService } from './fraud.service';
import { assertTransactionAmountIntegrity } from './transaction-integrity';

/** riskScore >= this threshold → reject outright (FAILED). */
const FRAUD_BLOCK_THRESHOLD = 0.8;

/** riskScore >= this threshold → hold for manual review (PENDING_REVIEW). */
const FRAUD_REVIEW_THRESHOLD = 0.5;

@Injectable()
export class TransactionProcessor {
  constructor(
    private prisma: PrismaClient,
    private auditService: AuditService,
    private logger: Logger,
    private fraudService: FraudService,
  ) {}

  async sendTransaction(
    userId: string,
    walletId: string,
    fromAddress: string,
    toAddress: string,
    amount: string,
    assetCode: string,
    memo?: string,
  ) {
    // Create transaction record
    const transaction = await this.prisma.transaction.create({
      data: {
        walletId,
        fromAddress,
        toAddress,
        amount,
        assetCode,
        type: 'send',
        status: 'PENDING',
        memo,
      },
    });

    // Fail closed if the stored value differs from the amount that passed the
    // request/simulation checks. Never score or submit a mutated transaction.
    assertTransactionAmountIntegrity(amount, transaction.amount);

    // Audit: Transaction initiated
    await this.auditService.log(userId, 'TRANSACTION_INITIATE', {
      transactionId: transaction.id,
      fromAddress,
      toAddress,
      amount,
      assetCode,
    });

    this.logger.info({
      event: 'transaction_initiated',
      userId,
      transactionId: transaction.id,
      fromAddress,
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
          txHash: result.hash,
        },
      });

      await this.auditService.log(userId, 'TRANSACTION_COMPLETE', {
        transactionId: transaction.id,
        txHash: result.hash,
        fromAddress,
        toAddress,
        amount,
      });

      this.logger.info({
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

      await this.auditService.log(userId, 'TRANSACTION_FAILED', {
        transactionId: transaction.id,
        fromAddress,
        toAddress,
        amount,
        error: error.message,
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
  ): Promise<{ blocked: boolean; updatedTx?: any }> {
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

      await this.auditService.log(userId, 'TRANSACTION_FAILED', {
        transactionId: transaction.id,
        reason: 'Fraud service unavailable',
        error: (err as Error).message,
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

      await this.auditService.log(userId, 'TRANSACTION_BLOCKED', {
        transactionId: transaction.id,
        riskScore,
        reasons,
        reason: 'High fraud risk score — transaction blocked',
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

      await this.auditService.log(userId, 'TRANSACTION_PENDING_REVIEW', {
        transactionId: transaction.id,
        riskScore,
        reasons,
        reason: 'Medium fraud risk score — held for manual review',
      });

      return { blocked: true, updatedTx };
    }

    // --- Tier 3: low risk — persist score and allow submission ---
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: { riskScore, flagged },
    });

    this.logger.info({
      event: 'transaction_fraud_check_passed',
      transactionId: transaction.id,
      riskScore,
    });

    return { blocked: false };
  }

  private async processOnChain(transaction: any): Promise<{ hash: string }> {
    // In production this interacts with Stellar/Soroban.
    return { hash: '0x' + Math.random().toString(16).substring(2) };
  }
}
