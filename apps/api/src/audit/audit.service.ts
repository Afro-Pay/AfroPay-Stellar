import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Logger } from 'nestjs-pino';

@Injectable()
export class AuditService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger,
  ) {}

  /**
   * Log an audit event to the database (append-only)
   */
  async log(
    userId: string | null,
    action: string,
    metadata: Record<string, any>,
    ipAddress?: string,
    userAgent?: string,
    correlationId?: string,
  ): Promise<void> {
    try {
      // Write to audit_logs table (append-only)
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          metadata,
          ipAddress,
          userAgent,
          correlationId: correlationId || 'unknown',
        },
      });

      // Also log to structured log
      this.logger.info({
        event: 'audit',
        action,
        userId,
        metadata,
        ipAddress,
        correlationId,
      });
    } catch (error) {
      // Don't let audit failures break the main flow
      this.logger.error({
        event: 'audit_failed',
        error: error.message,
        action,
        userId,
      });
    }
  }

  /**
   * Get audit history for a user (read-only)
   */
  async getUserAuditLogs(userId: string, limit: number = 100): Promise<any[]> {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get audit history for a specific action
   */
  async getActionAuditLogs(action: string, limit: number = 100): Promise<any[]> {
    return this.prisma.auditLog.findMany({
      where: { action },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get recent audit logs (admin use)
   */
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
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }
}
