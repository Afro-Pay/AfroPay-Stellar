import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Logger } from 'nestjs-pino';

@Injectable()
export class TransactionProcessor {
  constructor(
    private prisma: PrismaClient,
    private auditService: AuditService,
    private logger: Logger,
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
        status: 'pending',
        memo,
      },
    });

    // Audit: Transaction initiated
    await this.auditService.log(
      userId,
      'TRANSACTION_INITIATE',
      {
        transactionId: transaction.id,
        fromAddress,
        toAddress,
        amount,
        assetCode,
      },
    );

    this.logger.info({
      event: 'transaction_initiated',
      userId,
      transactionId: transaction.id,
      fromAddress,
      toAddress,
      amount,
      assetCode,
    });

    try {
      // Process the transaction (simplified)
      const result = await this.processOnChain(transaction);

      // Update transaction status
      const updated = await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: 'completed',
          txHash: result.hash,
        },
      });

      // Audit: Transaction completed
      await this.auditService.log(
        userId,
        'TRANSACTION_COMPLETE',
        {
          transactionId: transaction.id,
          txHash: result.hash,
          fromAddress,
          toAddress,
          amount,
        },
      );

      this.logger.info({
        event: 'transaction_completed',
        userId,
        transactionId: transaction.id,
        txHash: result.hash,
      });

      return updated;
    } catch (error) {
      // Update transaction as failed
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'failed' },
      });

      // Audit: Transaction failed
      await this.auditService.log(
        userId,
        'TRANSACTION_FAILED',
        {
          transactionId: transaction.id,
          fromAddress,
          toAddress,
          amount,
          error: error.message,
        },
      );

      this.logger.error({
        event: 'transaction_failed',
        userId,
        transactionId: transaction.id,
        error: error.message,
      });

      throw error;
    }
  }

  private async processOnChain(transaction: any): Promise<{ hash: string }> {
    // Simulate on-chain processing
    // In production, this would interact with Stellar/Soroban
    return { hash: '0x' + Math.random().toString(16).substring(2) };
  }
}
