import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { KycService } from '../kyc/kyc.service';
import { TRANSACTION_QUEUE_OPTIONS } from './transaction-retry.config';

export const HISTORY_MAX_LIMIT = 100;
export const HISTORY_DEFAULT_LIMIT = 25;

export interface GetHistoryOptions {
  /** Maximum number of records to return. Capped at HISTORY_MAX_LIMIT (100). */
  limit?: number;
  /** Opaque cursor string — the `id` of the last transaction on the previous page. */
  cursor?: string;
  /** Filter by transaction status (e.g. "PENDING", "SUCCESS", "FAILED", "RETRYING"). */
  status?: string;
  /** Filter by asset code (e.g. "USDC", "XLM", "NGN"). */
  currency?: string;
  /** Filter by date range: "7d" = last 7 days, "30d" = last 30 days. */
  dateRange?: string;
}

export interface PaginatedHistory {
  data: Awaited<ReturnType<PrismaService['transaction']['findMany']>>;
  nextCursor: string | null;
  total: number;
}

export interface SendTransferDto {
  destinationPublicKey: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
}

@Injectable()
export class TransactionService {
  constructor(
    @InjectQueue('transactions') private txQueue: Queue,
    private prisma: PrismaService,
    private kycService: KycService,
  ) {}

  async sendTransfer(userId: string, dto: SendTransferDto) {
    const amountUsd = await this.kycService.normalizeAmountToUsd(dto.amount, dto.assetCode);
    await this.kycService.assertWithinDailyLimit(userId, amountUsd);

    // Resolve the wallet FK – every transfer must originate from the user's wallet.
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found for user');

    const tx = await this.prisma.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        destination: dto.destinationPublicKey,
        amount: dto.amount,
        assetCode: dto.assetCode,
        assetIssuer: dto.assetIssuer ?? null,
        memo: dto.memo ?? null,
        status: 'PENDING',
      },
    });

    await this.txQueue.add('process', { txId: tx.id, userId, ...dto }, TRANSACTION_QUEUE_OPTIONS);

    return { txId: tx.id, status: 'PENDING' };
  }

  async sendPayment(userId: string, dto: SendTransferDto) {
    return this.sendTransfer(userId, dto);
  }

  async getHistory(userId: string, options: GetHistoryOptions = {}): Promise<PaginatedHistory> {
    const rawLimit = options.limit ?? HISTORY_DEFAULT_LIMIT;

    if (rawLimit > HISTORY_MAX_LIMIT) {
      throw new BadRequestException(
        `limit must not exceed ${HISTORY_MAX_LIMIT}. Received: ${rawLimit}`,
      );
    }

    const limit = Math.max(1, rawLimit);
    const cursor = options.cursor;

    // Build the `where` clause from optional filter parameters.
    const where: Record<string, unknown> = { userId };

    if (options.status) {
      where['status'] = options.status;
    }

    if (options.currency) {
      where['assetCode'] = options.currency;
    }

    if (options.dateRange) {
      const now = new Date();
      const days = options.dateRange === '7d' ? 7 : 30;
      where['createdAt'] = { gte: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) };
    }

    // Total count respects the active filters.
    const total = await this.prisma.transaction.count({ where });

    // Fetch one extra record beyond the requested limit to determine whether a
    // next page exists without a separate query.
    const rows = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1, // skip the cursor row itself
          }
        : {}),
    });

    const hasNextPage = rows.length > limit;
    const data = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage ? data[data.length - 1].id : null;

    return { data, nextCursor, total };
  }

  async getTransactionsByWallet(walletId: string) {
    return this.prisma.transaction.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getTransaction(txId: string, userId?: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    
    if (userId && tx && tx.userId !== userId) {
      throw new NotFoundException('Transaction not found');
    }
    
    return tx;
  }

  async updateTransactionStatus(
    txId: string,
    status: 'PENDING' | 'RETRYING' | 'SUCCESS' | 'FAILED',
    stellarTxHash?: string,
  ) {
    const updated = await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        status,
        ...(stellarTxHash ? { stellarTxHash } : {}),
      },
    });

    if (status === 'SUCCESS') {
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
      await redis.del(`wallet_balances:${updated.userId}`);
      redis.disconnect();
    }

    return updated;
  }
}
