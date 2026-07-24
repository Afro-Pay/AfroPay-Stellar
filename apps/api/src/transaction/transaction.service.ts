import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { JobOptions, Queue } from 'bull';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { KycService } from '../kyc/kyc.service';
import { TRANSACTION_QUEUE_OPTIONS } from './transaction-retry.config';

export const HISTORY_MAX_LIMIT = 100;
export const HISTORY_DEFAULT_LIMIT = 25;

/** TTL for the cached send response, per the issue spec (24 hours). */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Postgres unique-violation code surfaced by Prisma. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * Minimal Redis-like store with TTL, used for unit tests or when REDIS_URL is
 * not configured. Mirrors the fallback in AnchorService so the send path stays
 * testable without a live Redis.
 */
class InMemoryTtlStore {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, _mode?: string, seconds?: number) {
    const expiresAt = seconds ? Date.now() + seconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }
}

export interface GetHistoryOptions {
  /** Maximum number of records to return. Capped at HISTORY_MAX_LIMIT (100). */
  limit?: number;
  /** Opaque cursor string — the `id` of the last transaction on the previous page. */
  cursor?: string;
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

export interface SendTransferResponse {
  txId: string;
  status: string;
}

export interface SendTransferResult extends SendTransferResponse {
  /**
   * True when this response replays a prior request with the same idempotency
   * key rather than creating a new transfer. The controller uses it to return
   * HTTP 200 (replay) instead of 201 (created); the value is not sent to the
   * client, so a replayed body is byte-identical to the original.
   */
  idempotentReplay: boolean;
}

@Injectable()
export class TransactionService {
  // Typed as `any` to bridge the ioredis client and the in-memory fallback,
  // matching the established pattern in AnchorService.
  private idempotencyCache: any;

  constructor(
    @InjectQueue('transactions') private txQueue: Queue,
    private prisma: PrismaService,
    private kycService: KycService,
  ) {
    const redisUrl = process.env.REDIS_URL;
    this.idempotencyCache =
      process.env.NODE_ENV === 'test' || !redisUrl
        ? new InMemoryTtlStore()
        : new Redis(redisUrl);
  }

  /**
   * Idempotent transfer submission.
   *
   * When `idempotencyKey` is supplied, a retried POST /transactions/send can
   * neither create a second Transaction row nor enqueue a second job:
   * 1. Fast path — a cached response for the key is returned immediately.
   * 2. Reservation — the row is created with the key; the unique constraint on
   *    `(userId, idempotencyKey)` makes a concurrent duplicate lose the race
   *    with a P2002 violation *before* anything is enqueued.
   * 3. Queue dedup — the job carries a deterministic `jobId` derived from the
   *    key, so even a job that slips past the DB collapses to one.
   */
  async sendTransfer(
    userId: string,
    dto: SendTransferDto,
    idempotencyKey?: string,
  ): Promise<SendTransferResult> {
    if (idempotencyKey) {
      const replay = await this.readCachedResponse(userId, idempotencyKey);
      if (replay) return { ...replay, idempotentReplay: true };
    }

    const amountUsd = await this.kycService.normalizeAmountToUsd(dto.amount, dto.assetCode);
    await this.kycService.assertWithinDailyLimit(userId, amountUsd);

    // Resolve the wallet FK – every transfer must originate from the user's wallet.
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found for user');

    let tx;
    try {
      tx = await this.prisma.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          destination: dto.destinationPublicKey,
          amount: dto.amount,
          assetCode: dto.assetCode,
          assetIssuer: dto.assetIssuer ?? null,
          memo: dto.memo ?? null,
          idempotencyKey: idempotencyKey ?? null,
          status: 'PENDING',
        },
      });
    } catch (err) {
      // A concurrent request with the same key won the unique-constraint race.
      // Return its transaction instead of creating a duplicate.
      if (idempotencyKey && this.isUniqueViolation(err)) {
        return this.replayFromDb(userId, idempotencyKey, dto);
      }
      throw err;
    }

    await this.enqueueJob(tx.id, userId, dto, idempotencyKey);

    const response: SendTransferResponse = { txId: tx.id, status: tx.status };
    if (idempotencyKey) {
      await this.writeCachedResponse(userId, idempotencyKey, response);
    }
    return { ...response, idempotentReplay: false };
  }

  async sendPayment(userId: string, dto: SendTransferDto, idempotencyKey?: string) {
    return this.sendTransfer(userId, dto, idempotencyKey);
  }

  private idempotencyCacheKey(userId: string, key: string): string {
    return `idempotency:${userId}:${key}`;
  }

  private async readCachedResponse(
    userId: string,
    key: string,
  ): Promise<SendTransferResponse | null> {
    const raw = await this.idempotencyCache.get(this.idempotencyCacheKey(userId, key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SendTransferResponse;
    } catch {
      return null;
    }
  }

  private async writeCachedResponse(
    userId: string,
    key: string,
    response: SendTransferResponse,
  ): Promise<void> {
    await this.idempotencyCache.set(
      this.idempotencyCacheKey(userId, key),
      JSON.stringify(response),
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
    );
  }

  private async replayFromDb(
    userId: string,
    idempotencyKey: string,
    dto: SendTransferDto,
  ): Promise<SendTransferResult> {
    const existing = await this.prisma.transaction.findFirst({
      where: { userId, idempotencyKey },
    });
    if (!existing) {
      // The row that caused the violation is gone — nothing coherent to replay.
      throw new BadRequestException('Idempotency key conflict could not be resolved');
    }
    // Crash-window safety: if the winning request died before enqueueing, this
    // re-adds the job. The deterministic jobId makes an already-queued job a
    // no-op, so this never produces a duplicate.
    await this.enqueueJob(existing.id, userId, dto, idempotencyKey);
    const response: SendTransferResponse = { txId: existing.id, status: existing.status };
    await this.writeCachedResponse(userId, idempotencyKey, response);
    return { ...response, idempotentReplay: true };
  }

  private async enqueueJob(
    txId: string,
    userId: string,
    dto: SendTransferDto,
    idempotencyKey?: string,
  ): Promise<void> {
    const options: JobOptions = { ...TRANSACTION_QUEUE_OPTIONS };
    if (idempotencyKey) {
      // Deterministic jobId → BullMQ collapses duplicate enqueues for the same
      // (user, key) into a single job.
      options.jobId = `send:${userId}:${idempotencyKey}`;
    }
    await this.txQueue.add('process', { txId, userId, ...dto }, options);
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === PRISMA_UNIQUE_VIOLATION
    );
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

    // Total count for the user — used for "X of N" UI labels.
    const total = await this.prisma.transaction.count({ where: { userId } });

    // Fetch one extra record beyond the requested limit to determine whether a
    // next page exists without a separate query.
    const rows = await this.prisma.transaction.findMany({
      where: { userId },
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
    
    if (!tx || (userId && tx.userId !== userId)) {
      throw new NotFoundException('Transaction not found');
    }
    
    return tx;
  }

  async updateRiskScore(txId: string, riskScore: number, flagged: boolean) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    const data: any = {
      riskScore,
      flagged,
    };

    if (flagged && (tx.status === 'PENDING' || tx.status === 'RETRYING')) {
      data.status = 'REVIEW';
    }

    return this.prisma.transaction.update({
      where: { id: txId },
      data,
    });
  }

  async updateTransactionStatus(
    txId: string,
    status: 'PENDING' | 'RETRYING' | 'SUCCESS' | 'FAILED' | 'REVIEW',
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
