import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminComplianceService } from './admin.service';

describe('AdminComplianceService', () => {
  const originalUser = {
    id: 'user-1',
    email: 'person@example.com',
    password: 'hash',
    name: 'Person Name',
    role: 'USER',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    wallets: [{ id: 'wallet-1' }],
    kyc: { id: 'kyc-1' },
  };

  function makePrisma() {
    const tx = {
      $executeRawUnsafe: jest.fn(),
      user: { create: jest.fn(), delete: jest.fn() },
      wallet: { update: jest.fn() },
      kycRecord: { delete: jest.fn() },
      transaction: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'old-log', metadata: { email: 'person@example.com', transactionId: 'tx-1' } },
        ]),
        update: jest.fn(),
        create: jest.fn(),
      },
      anonymizationTombstone: { create: jest.fn() },
    };
    const prisma = {
      tx,
      user: { findUnique: jest.fn() },
      transaction: { findMany: jest.fn() },
      auditLog: { create: jest.fn(), findMany: jest.fn() },
      anonymizationTombstone: { findUnique: jest.fn() },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === 'admin-1') return Promise.resolve({ role: 'ADMIN', erasedAt: null });
      return Promise.resolve(null);
    });
    return prisma;
  }

  it('erases PII, pseudonymises retained transactions, and writes USER_ERASED', async () => {
    const prisma = makePrisma();
    prisma.anonymizationTombstone.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where.id === 'admin-1' ? { role: 'ADMIN', erasedAt: null } : originalUser,
    ));
    const service = new AdminComplianceService(prisma as any);

    const result = await service.eraseUser('user-1', 'admin-1');

    expect(result.status).toBe('erased');
    expect(result.pseudonymousUserId).not.toBe('user-1');
    expect(prisma.tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: result.pseudonymousUserId,
        email: expect.stringContaining('@anonymized.invalid'),
        password: expect.stringMatching(/^ERASED:/),
        name: null,
        role: 'USER',
      }),
    });
    expect(prisma.tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { userId: result.pseudonymousUserId },
    });
    expect(prisma.tx.kycRecord.delete).toHaveBeenCalledWith({ where: { id: 'kyc-1' } });
    expect(prisma.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      `SET LOCAL audit_log.allow_anonymization = 'on'`,
    );
    expect(prisma.tx.auditLog.update).toHaveBeenCalledWith({
      where: { id: 'old-log' },
      data: { userId: result.pseudonymousUserId, metadata: { transactionId: 'tx-1' } },
    });
    expect(prisma.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ operation: 'USER_ERASED', userId: result.pseudonymousUserId }),
    });
  });

  it('is idempotent when an anonymisation tombstone already exists', async () => {
    const prisma = makePrisma();
    prisma.anonymizationTombstone.findUnique.mockResolvedValue({
      pseudonymousUserId: 'anon-1',
      erasedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const service = new AdminComplianceService(prisma as any);

    const result = await service.eraseUser('user-1', 'admin-1');

    expect(result).toEqual(expect.objectContaining({ status: 'already_erased', pseudonymousUserId: 'anon-1' }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('exports every flagged transaction with risk scores and all subject audit logs', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where.id === 'admin-1' ? { role: 'ADMIN', erasedAt: null } : { id: 'user-1' },
    ));
    prisma.transaction.findMany.mockResolvedValue([
      { id: 'tx-1', flagged: true, riskScore: 0.82 },
      { id: 'tx-2', flagged: true, riskScore: 0.93 },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'log-1' }, { id: 'log-2' }]);
    const service = new AdminComplianceService(prisma as any);

    const result = await service.exportSar('user-1', 'admin-1');

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', flagged: true },
    }));
    expect(result.flaggedTransactions.map((tx) => tx.riskScore)).toEqual([0.82, 0.93]);
    expect(result.auditLogs).toHaveLength(2);
    expect(result.summary).toEqual({ flaggedTransactionCount: 2, auditLogCount: 2 });
  });

  it('rejects an export for an unknown user', async () => {
    const prisma = makePrisma();
    prisma.anonymizationTombstone.findUnique.mockResolvedValue(null);
    await expect(new AdminComplianceService(prisma as any).exportSar('missing', 'admin-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects service use by a non-admin actor', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ role: 'USER', erasedAt: null });
    await expect(new AdminComplianceService(prisma as any).exportSar('user-1', 'user-2'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
