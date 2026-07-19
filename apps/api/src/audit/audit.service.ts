import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Event type constants — use these throughout the codebase instead of raw
// strings so that log queries remain consistent.
// ---------------------------------------------------------------------------
export const AuditCategory = {
  WALLET: 'WALLET',
  TRANSACTION: 'TRANSACTION',
  AUTH: 'AUTH',
} as const;

export const AuditOperation = {
  // Wallet operations
  WALLET_CREATED: 'WALLET_CREATED',
  WALLET_EXPORTED: 'WALLET_EXPORTED',
  WALLET_IMPORTED: 'WALLET_IMPORTED',
  // Transaction operations
  TX_SUBMITTED: 'TX_SUBMITTED',
  TX_SUCCESS: 'TX_SUCCESS',
  TX_FAILED: 'TX_FAILED',
  TX_RETRYING: 'TX_RETRYING',
  // Auth operations
  AUTH_REGISTER: 'AUTH_REGISTER',
  AUTH_LOGIN: 'AUTH_LOGIN',
  AUTH_LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
} as const;

export const AuditOutcome = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const;

export type AuditCategoryType = (typeof AuditCategory)[keyof typeof AuditCategory];
export type AuditOperationType = (typeof AuditOperation)[keyof typeof AuditOperation];
export type AuditOutcomeType = (typeof AuditOutcome)[keyof typeof AuditOutcome];

// ---------------------------------------------------------------------------
// DTO for creating a log entry.
// ---------------------------------------------------------------------------
export interface CreateAuditLogDto {
  userId?: string;
  category: AuditCategoryType;
  operation: AuditOperationType;
  outcome: AuditOutcomeType;
  walletPublicKey?: string;
  amount?: string;
  assetCode?: string;
  destination?: string;
  txHash?: string;
  /** Additional freeform context; must be JSON-serialisable. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Query DTO for filtering audit logs (used by the review endpoint).
// ---------------------------------------------------------------------------
export interface AuditLogQueryDto {
  userId?: string;
  category?: string;
  operation?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a structured audit log entry.
   *
   * This method is intentionally fire-and-forget from the perspective of
   * callers: it catches its own errors so that audit failures never break
   * business logic.  Errors are still surfaced to the application logger for
   * operational visibility.
   */
  async log(dto: CreateAuditLogDto): Promise<void> {
    // Emit a structured JSON line to stdout for log-aggregation pipelines
    // (CloudWatch, Datadog, ELK, etc.) even before the DB write completes.
    this.logger.log(
      JSON.stringify({
        event: 'AUDIT',
        timestamp: new Date().toISOString(),
        ...dto,
      }),
    );

    try {
      await this.prisma.auditLog.create({
        data: {
          userId: dto.userId ?? null,
          category: dto.category,
          operation: dto.operation,
          outcome: dto.outcome,
          walletPublicKey: dto.walletPublicKey ?? null,
          amount: dto.amount ?? null,
          assetCode: dto.assetCode ?? null,
          destination: dto.destination ?? null,
          txHash: dto.txHash ?? null,
          metadata: dto.metadata ?? undefined,
        },
      });
    } catch (err: any) {
      // Do NOT rethrow — audit logging must never break the happy path.
      this.logger.error(`Failed to persist audit log entry: ${err.message}`, err.stack);
    }
  }

  /**
   * Retrieve audit log entries for security review / compliance investigation.
   * Results are ordered newest-first and limited to 200 rows per call.
   */
  async query(filters: AuditLogQueryDto) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;

    const where: Record<string, unknown> = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.category) where.category = filters.category;
    if (filters.operation) where.operation = filters.operation;

    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }

    const [total, entries] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
    ]);

    return { total, limit, offset, entries };
  }
}
