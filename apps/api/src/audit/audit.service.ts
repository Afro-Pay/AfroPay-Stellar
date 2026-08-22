import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export enum AuditCategory {
  WALLET = 'WALLET',
  TRANSACTION = 'TRANSACTION',
  AUTH = 'AUTH',
}

export enum AuditOperation {
  WALLET_CREATED = 'WALLET_CREATED',
  WALLET_EXPORTED = 'WALLET_EXPORTED',
  WALLET_IMPORTED = 'WALLET_IMPORTED',
  TX_SUBMITTED = 'TX_SUBMITTED',
  TX_SUCCESS = 'TX_SUCCESS',
  TX_FAILED = 'TX_FAILED',
  TX_RETRYING = 'TX_RETRYING',
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

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an audit event to the database (append-only)
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
      if (typeof userIdOrOptions === 'object' && userIdOrOptions !== null) {
        const opts = userIdOrOptions;
        await this.prisma.auditLog.create({
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
          },
        });
      } else {
        const userId: string | null = typeof userIdOrOptions === 'string' ? userIdOrOptions : null;
        await this.prisma.auditLog.create({
          data: {
            userId,
            category: 'GENERAL',
            operation: action ?? 'ACTION',
            outcome: 'SUCCESS',
            metadata: metadata ?? null,
          },
        });
      }
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
}

export { AuditService as AuditLogService };
