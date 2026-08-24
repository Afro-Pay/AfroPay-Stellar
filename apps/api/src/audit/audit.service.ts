import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export enum AuditCategory {
  WALLET = 'WALLET',
  TRANSACTION = 'TRANSACTION',
  AUTH = 'AUTH',
  COMPLIANCE = 'COMPLIANCE',
  KYC = 'KYC',
}

export enum AuditOperation {
  WALLET_CREATED = 'WALLET_CREATED',
  WALLET_EXPORTED = 'WALLET_EXPORTED',
  WALLET_IMPORTED = 'WALLET_IMPORTED',
  TX_SUBMITTED = 'TX_SUBMITTED',
  TX_SUCCESS = 'TX_SUCCESS',
  TX_FAILED = 'TX_FAILED',
  TX_RETRYING = 'TX_RETRYING',
  COMPLIANCE_FREEZE_REQUESTED = 'COMPLIANCE_FREEZE_REQUESTED',
  COMPLIANCE_CLAWBACK_REQUESTED = 'COMPLIANCE_CLAWBACK_REQUESTED',
  COMPLIANCE_ACTION_APPROVED = 'COMPLIANCE_ACTION_APPROVED',
  COMPLIANCE_ACTION_REJECTED = 'COMPLIANCE_ACTION_REJECTED',
  COMPLIANCE_ACTION_DISPATCHED = 'COMPLIANCE_ACTION_DISPATCHED',
  COMPLIANCE_ACTION_EXECUTED = 'COMPLIANCE_ACTION_EXECUTED',
  COMPLIANCE_ACTION_FAILED = 'COMPLIANCE_ACTION_FAILED',
}

export enum AuditOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

export interface AuditLogOptions {
  userId?: string;
  category?: string;
  operation?: string;
  outcome?: string;
  walletPublicKey?: string;
  amount?: string;
  assetCode?: string;
  destination?: string;
  txHash?: string;
  metadata?: any;
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
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an audit event to the database (append-only). Accepts either a
   * structured options object or the legacy positional form:
   * `log(userId, action, metadata)`.
   *
   * Failures are swallowed (fire-and-forget) so audit issues never break the
   * main flow.
   */
  async log(
    userIdOrOptions: string | null | AuditLogOptions,
    action?: string,
    metadata?: Record<string, any>,
    _ipAddress?: string,
    _userAgent?: string,
    _correlationId?: string,
  ): Promise<void> {
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

      let created;
      if (typeof userIdOrOptions === 'object' && userIdOrOptions !== null) {
        const opts = userIdOrOptions;
        created = await this.prisma.auditLog.create({
          data: {
            userId: opts.userId ?? null,
            category: opts.category ?? 'GENERAL',
            operation: opts.operation ?? 'ACTION',
            outcome: opts.outcome ?? 'SUCCESS',
            walletPublicKey: opts.walletPublicKey ?? null,
            amount: opts.amount ?? null,
            assetCode: opts.assetCode ?? null,
            destination: opts.destination ?? null,
            txHash: opts.txHash ?? null,
            metadata: opts.metadata ?? null,
            previousHash,
          },
        });
      } else {
        const userId: string | null =
          typeof userIdOrOptions === 'string' ? userIdOrOptions : null;
        created = await this.prisma.auditLog.create({
          data: {
            userId,
            category: 'GENERAL',
            operation: action ?? 'ACTION',
            outcome: 'SUCCESS',
            metadata: metadata ?? null,
            previousHash,
          },
        });
      }

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
    } catch {
      // Don't let audit failures break the main flow
    }
  }

  /**
   * Query audit logs with filtering and pagination
   */
  async query(params: {
    userId?: string;
    category?: string;
    operation?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }) {
    const rawLimit = params.limit ?? 50;
    const limit = Math.min(200, Math.max(1, rawLimit));
    const skip = Math.max(0, params.offset ?? 0);

    const where: any = {
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.category ? { category: params.category } : {}),
      ...(params.operation ? { operation: params.operation } : {}),
      ...((params.from || params.to)
        ? {
            createdAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
    };

    const [total, entries] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
    ]);

    return { total, entries };
  }

  async getUserAuditLogs(userId: string, limit: number = 100): Promise<any[]> {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getActionAuditLogs(action: string, limit: number = 100): Promise<any[]> {
    return this.prisma.auditLog.findMany({
      where: { operation: action },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getRecentAuditLogs(days: number = 7): Promise<any[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return this.prisma.auditLog.findMany({
      where: {
        createdAt: {
          gte: cutoff,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
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

export { AuditService as AuditLogService };
