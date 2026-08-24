import { createHash, randomBytes, randomUUID } from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CATEGORY = 'COMPLIANCE';
const PII_METADATA_KEYS = /^(email|name|fullName|phone|phoneNumber|dateOfBirth|dob|documentRef|documentNumber|ipAddress|userAgent)$/i;

function redactPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPii);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !PII_METADATA_KEYS.test(key))
        .map(([key, nested]) => [key, redactPii(nested)]),
    );
  }
  return value;
}

@Injectable()
export class AdminComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  private lookupHash(userId: string): string {
    return createHash('sha256').update(userId).digest('hex');
  }

  private async resolveUserId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (user) return user.id;

    const tombstone = await this.prisma.anonymizationTombstone.findUnique({
      where: { originalUserIdHash: this.lookupHash(userId) },
      select: { pseudonymousUserId: true },
    });
    return tombstone?.pseudonymousUserId ?? null;
  }

  async eraseUser(userId: string, adminUserId: string) {
    await this.assertAdmin(adminUserId);
    const originalUserIdHash = this.lookupHash(userId);
    await this.logAccess(adminUserId, 'USER_ERASURE_ACCESSED', originalUserIdHash);

    const existing = await this.prisma.anonymizationTombstone.findUnique({
      where: { originalUserIdHash },
    });
    if (existing) {
      return {
        status: 'already_erased',
        pseudonymousUserId: existing.pseudonymousUserId,
        erasedAt: existing.erasedAt,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallets: true, kyc: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const pseudonymousUserId = randomUUID();
    const erasedAt = new Date();
    const transactionCount = await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: pseudonymousUserId,
          email: `erased+${pseudonymousUserId}@anonymized.invalid`,
          password: `ERASED:${randomBytes(32).toString('hex')}`,
          name: null,
          role: 'USER',
          erasedAt,
          createdAt: user.createdAt,
        },
      });

      for (const wallet of user.wallets) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            userId: pseudonymousUserId,
            encryptedSecret: `ERASED:${randomBytes(32).toString('hex')}`,
            encryptedDek: null,
            kmsKeyId: null,
          },
        });
      }
      if (user.kyc) await tx.kycRecord.delete({ where: { id: user.kyc.id } });

      const moved = await tx.transaction.updateMany({
        where: { userId },
        data: { userId: pseudonymousUserId },
      });
      const subjectAuditLogs = await tx.auditLog.findMany({
        where: { userId },
        select: { id: true, metadata: true },
      });
      for (const log of subjectAuditLogs) {
        await tx.auditLog.update({
          where: { id: log.id },
          data: {
            userId: pseudonymousUserId,
            ...(log.metadata === null ? {} : { metadata: redactPii(log.metadata) as any }),
          },
        });
      }
      await tx.user.delete({ where: { id: userId } });
      await tx.anonymizationTombstone.create({
        data: { originalUserIdHash, pseudonymousUserId, erasedAt },
      });
      await tx.auditLog.create({
        data: {
          userId: pseudonymousUserId,
          category: CATEGORY,
          operation: 'USER_ERASED',
          outcome: 'SUCCESS',
          metadata: { administeredBy: adminUserId, retainedTransactionCount: moved.count },
        },
      });
      return moved.count;
    });

    return { status: 'erased', pseudonymousUserId, erasedAt, retainedTransactionCount: transactionCount };
  }

  async exportSar(userId: string, adminUserId: string) {
    await this.assertAdmin(adminUserId);
    const resolvedUserId = await this.resolveUserId(userId);
    if (!resolvedUserId) throw new NotFoundException('User not found');

    await this.logAccess(adminUserId, 'SAR_EXPORT_ACCESSED', this.lookupHash(userId));
    const [transactions, auditLogs] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId: resolvedUserId, flagged: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: { userId: resolvedUserId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      subject: { pseudonymousUserId: resolvedUserId },
      summary: { flaggedTransactionCount: transactions.length, auditLogCount: auditLogs.length },
      flaggedTransactions: transactions,
      auditLogs,
    };
  }

  private async logAccess(adminUserId: string, operation: string, targetLookupHash: string) {
    await this.prisma.auditLog.create({
      data: {
        userId: adminUserId,
        category: CATEGORY,
        operation,
        outcome: 'SUCCESS',
        metadata: { targetLookupHash },
      },
    });
  }

  private async assertAdmin(adminUserId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { role: true, erasedAt: true },
    });
    if (!admin || admin.role !== 'ADMIN' || admin.erasedAt) {
      throw new ForbiddenException('Administrator access is required');
    }
  }
}
