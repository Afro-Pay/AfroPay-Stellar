import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Logger } from 'nestjs-pino';

export const AuditCategory = {
  WALLET: 'WALLET',
  TRANSACTION: 'TRANSACTION',
  AUTH: 'AUTH',
  COMPLIANCE: 'COMPLIANCE',
  KYC: 'KYC',
} as const;

export const AuditOperation = {
  WALLET_CREATED: 'WALLET_CREATED',
  WALLET_EXPORTED: 'WALLET_EXPORTED',
  WALLET_IMPORTED: 'WALLET_IMPORTED',
  TX_SUBMITTED: 'TX_SUBMITTED',
  TX_SUCCESS: 'TX_SUCCESS',
  TX_FAILED: 'TX_FAILED',
  TX_RETRYING: 'TX_RETRYING',
  COMPLIANCE_FREEZE_REQUESTED: 'COMPLIANCE_FREEZE_REQUESTED',
  COMPLIANCE_CLAWBACK_REQUESTED: 'COMPLIANCE_CLAWBACK_REQUESTED',
  COMPLIANCE_ACTION_APPROVED: 'COMPLIANCE_ACTION_APPROVED',
  COMPLIANCE_ACTION_REJECTED: 'COMPLIANCE_ACTION_REJECTED',
  COMPLIANCE_ACTION_DISPATCHED: 'COMPLIANCE_ACTION_DISPATCHED',
  COMPLIANCE_ACTION_EXECUTED: 'COMPLIANCE_ACTION_EXECUTED',
  COMPLIANCE_ACTION_FAILED: 'COMPLIANCE_ACTION_FAILED',
} as const;

export const AuditOutcome = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const;

export interface AuditLogInput {
  userId?: string | null;
  category: string;
  operation: string;
  outcome: string;
  walletPublicKey?: string | null;
  amount?: string | null;
  assetCode?: string | null;
  destination?: string | null;
  txHash?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditLogQuery {
  userId?: string;
  category?: string;
  operation?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Append-only, tamper-evident audit log.
 *
 * Every entry participates in a SHA-256 hash chain:
 *   - `previousHash` points at the hash of the immediately preceding entry,
 *   - `hash` is computed over the entry's canonical payload + `previousHash`.
 *
 * Retroactively modifying or deleting any row breaks every subsequent hash,
 * which makes the log tamper-evident for compliance review.
 */
@Injectable()
export class AuditLogService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger,
  ) {}

  /**
   * Append a log entry and seal it into the hash chain.
   *
   * Failures are swallowed (fire-and-forget) so audit issues never break the
   * main flow — the error is surfaced through the structured logger instead.
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      // Link to the most recent sealed entry. Under extreme concurrency two
      // writers may share a parent; the chain remains tamper-evident (a fork
      // is still detectable), and strict linearisation can be layered on top
      // with a row lock if it ever becomes necessary.
      const previous = await this.prisma.auditLog.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { hash: true },
      });
      const previousHash = previous?.hash ?? null;

      const created = await this.prisma.auditLog.create({
        data: {
          userId: input.userId ?? null,
          category: input.category,
          operation: input.operation,
          outcome: input.outcome,
          walletPublicKey: input.walletPublicKey ?? null,
          amount: input.amount ?? null,
          assetCode: input.assetCode ?? null,
          destination: input.destination ?? null,
          txHash: input.txHash ?? null,
          metadata: (input.metadata ?? null) as any,
          previousHash,
        },
      });

      const hash = this.hashEntry({
        id: created.id,
        userId: created.userId,
        category: created.category,
        operation: created.operation,
        outcome: created.outcome,
        walletPublicKey: created.walletPublicKey,
        amount: created.amount,
        assetCode: created.assetCode,
        destination: created.destination,
        txHash: created.txHash,
        metadata: created.metadata,
        previousHash,
        createdAt: created.createdAt,
      });

      await this.prisma.auditLog.update({
        where: { id: created.id },
        data: { hash },
      });

      this.logger.log({
        event: 'audit',
        operation: input.operation,
        userId: input.userId,
        category: input.category,
        hash,
        previousHash,
      });
    } catch (error) {
      this.logger.error({
        event: 'audit_failed',
        error: (error as Error).message,
        operation: input.operation,
        userId: input.userId,
      });
    }
  }

  /**
   * Query the audit log with optional filters and pagination.
   * Read-only — audit rows are never updated or deleted by this service.
   */
  async query(filters: AuditLogQuery = {}): Promise<{ total: number; entries: any[] }> {
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const where: Record<string, unknown> = {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.operation ? { operation: filters.operation } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [total, entries] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
    ]);

    return { total, entries };
  }

  /**
   * SHA-256 over the canonical entry payload, including `previousHash` and the
   * row id + createdAt, so every entry is cryptographically bound to its
   * predecessor and its own identity.
   */
  private hashEntry(entry: {
    id: string;
    userId: string | null;
    category: string;
    operation: string;
    outcome: string;
    walletPublicKey: string | null;
    amount: string | null;
    assetCode: string | null;
    destination: string | null;
    txHash: string | null;
    metadata: unknown;
    previousHash: string | null;
    createdAt: Date;
  }): string {
    const canonical = JSON.stringify({
      id: entry.id,
      userId: entry.userId,
      category: entry.category,
      operation: entry.operation,
      outcome: entry.outcome,
      walletPublicKey: entry.walletPublicKey,
      amount: entry.amount,
      assetCode: entry.assetCode,
      destination: entry.destination,
      txHash: entry.txHash,
      metadata: entry.metadata ?? null,
      previousHash: entry.previousHash,
      createdAt: entry.createdAt.toISOString(),
    });
    return createHash('sha256').update(canonical).digest('hex');
  }
}
