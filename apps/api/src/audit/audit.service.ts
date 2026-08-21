import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Logger } from 'nestjs-pino';

/** High-level event category — mirrors the doc comment on the AuditLog model. */
export enum AuditCategory {
  WALLET = 'WALLET',
  TRANSACTION = 'TRANSACTION',
  AUTH = 'AUTH',
}

/** Specific operation being recorded. */
export enum AuditOperation {
  WALLET_CREATED = 'WALLET_CREATED',
  WALLET_EXPORTED = 'WALLET_EXPORTED',
  WALLET_IMPORTED = 'WALLET_IMPORTED',
  TX_SUBMITTED = 'TX_SUBMITTED',
  TX_SUCCESS = 'TX_SUCCESS',
  TX_FAILED = 'TX_FAILED',
  TX_RETRYING = 'TX_RETRYING',
  TX_BLOCKED = 'TX_BLOCKED',
  TX_PENDING_REVIEW = 'TX_PENDING_REVIEW',
  REGISTER = 'REGISTER',
  LOGIN = 'LOGIN',
  LOGIN_FAILED = 'LOGIN_FAILED',
}

/** Outcome of the operation. */
export enum AuditOutcome {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

export interface AuditLogEntry {
  userId?: string | null;
  category: AuditCategory | string;
  operation: AuditOperation | string;
  outcome: AuditOutcome | string;
  walletPublicKey?: string;
  amount?: string;
  assetCode?: string;
  destination?: string;
  txHash?: string;
  metadata?: Record<string, any>;
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

const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;
const EXPORT_PAGE_SIZE = 500;

function buildWhere(filters: Pick<AuditLogQuery, 'userId' | 'category' | 'operation' | 'from' | 'to'>) {
  const where: Record<string, any> = {};
  if (filters.userId) where.userId = filters.userId;
  if (filters.category) where.category = filters.category;
  if (filters.operation) where.operation = filters.operation;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  return where;
}

/**
 * Append-only audit trail for security-relevant events (wallet, transaction,
 * auth). Rows are never mutated once written — enforced in the app by only
 * exposing `log`/`query`/`exportNdjson` here, and at the database level by a
 * trigger (see prisma/migrations/*_audit_log_immutable_trigger).
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly logger?: Logger,
  ) {}

  /**
   * Record an audit event. Never throws — a failure to write the audit trail
   * must not break the operation being audited.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          category: entry.category,
          operation: entry.operation,
          outcome: entry.outcome,
          walletPublicKey: entry.walletPublicKey,
          amount: entry.amount,
          assetCode: entry.assetCode,
          destination: entry.destination,
          txHash: entry.txHash,
          metadata: entry.metadata,
        },
      });
    } catch (error) {
      this.logger?.error?.({
        event: 'audit_write_failed',
        error: (error as Error).message,
        category: entry.category,
        operation: entry.operation,
      });
    }
  }

  /** Paginated, filtered read access for the /audit/logs endpoint. */
  async query(filters: AuditLogQuery): Promise<{ entries: any[]; total: number }> {
    const take = Math.min(filters.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const skip = filters.offset ?? 0;
    const where = buildWhere(filters);

    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { entries, total };
  }

  /**
   * Streams every row matching the given filters as NDJSON lines (one JSON
   * object per line, oldest first), for the compliance export endpoint.
   * Pages through the table with a keyset cursor instead of loading the full
   * result set into memory.
   */
  async *exportNdjson(
    filters: Pick<AuditLogQuery, 'userId' | 'category' | 'operation' | 'from' | 'to'>,
    pageSize: number = EXPORT_PAGE_SIZE,
  ): AsyncGenerator<string> {
    const where = buildWhere(filters);
    let cursor: string | undefined;

    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (rows.length === 0) break;

      for (const row of rows) {
        yield JSON.stringify(row) + '\n';
      }

      cursor = rows[rows.length - 1].id;
      if (rows.length < pageSize) break;
    }
  }
}
