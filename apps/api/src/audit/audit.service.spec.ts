import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { PrismaClient } from '@prisma/client';
import {
  AuditCategory,
  AuditLogService,
  AuditOperation,
  AuditOutcome,
} from './audit.service';

// ---------------------------------------------------------------------------
// Minimal Prisma mock — isolates AuditLogService from the database.
// ---------------------------------------------------------------------------
const makePrismaMock = () => {
  const rows: any[] = [];
  const mockCreate = jest.fn().mockImplementation(({ data }) => {
    const row = {
      id: `audit-${rows.length + 1}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      ...data,
    };
    rows.push(row);
    return Promise.resolve(row);
  });
  const mockUpdate = jest.fn().mockImplementation(({ where, data }) => {
    const row = rows.find((r) => r.id === where.id);
    Object.assign(row, data);
    return Promise.resolve(row);
  });
  const mockFindFirst = jest.fn().mockImplementation(() => {
    const sorted = [...rows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
    );
    return Promise.resolve(sorted[0] ?? null);
  });
  const mockCount = jest.fn().mockResolvedValue(2);
  const mockFindMany = jest.fn().mockResolvedValue([
    { id: 'audit-1', operation: 'WALLET_CREATED', createdAt: new Date() },
    { id: 'audit-2', operation: 'TX_SUBMITTED', createdAt: new Date() },
  ]);

  return {
    rows,
    mocks: {
      auditLog: {
        create: mockCreate,
        update: mockUpdate,
        findFirst: mockFindFirst,
        count: mockCount,
        findMany: mockFindMany,
      },
    },
  };
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prismaMock: ReturnType<typeof makePrismaMock>['mocks'];

  beforeEach(async () => {
    jest.clearAllMocks();
    const { mocks } = makePrismaMock();
    prismaMock = mocks;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaClient, useValue: prismaMock },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  // -------------------------------------------------------------------------
  // log()
  // -------------------------------------------------------------------------

  it('persists a WALLET_CREATED event with the correct fields', async () => {
    await service.log({
      userId: 'user-abc',
      category: AuditCategory.WALLET,
      operation: AuditOperation.WALLET_CREATED,
      outcome: AuditOutcome.SUCCESS,
      walletPublicKey: 'GABC123',
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const payload = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(payload.userId).toBe('user-abc');
    expect(payload.category).toBe('WALLET');
    expect(payload.operation).toBe('WALLET_CREATED');
    expect(payload.outcome).toBe('SUCCESS');
    expect(payload.walletPublicKey).toBe('GABC123');
  });

  it('persists a TX_SUBMITTED event with amount and destination', async () => {
    await service.log({
      userId: 'user-xyz',
      category: AuditCategory.TRANSACTION,
      operation: AuditOperation.TX_SUBMITTED,
      outcome: AuditOutcome.SUCCESS,
      amount: '100',
      assetCode: 'XLM',
      destination: 'GDEST456',
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const payload = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(payload.amount).toBe('100');
    expect(payload.assetCode).toBe('XLM');
    expect(payload.destination).toBe('GDEST456');
  });

  it('does NOT throw when the DB write fails (fire-and-forget safety)', async () => {
    prismaMock.auditLog.create.mockRejectedValueOnce(new Error('DB is down'));

    await expect(
      service.log({
        userId: 'user-abc',
        category: AuditCategory.WALLET,
        operation: AuditOperation.WALLET_EXPORTED,
        outcome: AuditOutcome.SUCCESS,
      }),
    ).resolves.not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Cryptographic hash chain
  // -------------------------------------------------------------------------

  it('seals every entry with a hash and links it to the previous entry', async () => {
    await service.log({
      userId: 'user-1',
      category: AuditCategory.COMPLIANCE,
      operation: AuditOperation.COMPLIANCE_FREEZE_REQUESTED,
      outcome: AuditOutcome.SUCCESS,
      metadata: { actionId: 'action-1' },
    });
    await service.log({
      userId: 'user-2',
      category: AuditCategory.COMPLIANCE,
      operation: AuditOperation.COMPLIANCE_ACTION_APPROVED,
      outcome: AuditOutcome.SUCCESS,
      metadata: { actionId: 'action-1' },
    });

    const first = prismaMock.auditLog.create.mock.calls[0][0].data;
    const second = prismaMock.auditLog.create.mock.calls[1][0].data;

    // First entry: no parent, sealed with a 64-char hex hash.
    expect(first.previousHash).toBeNull();
    const firstHash = prismaMock.auditLog.update.mock.calls[0][0].data.hash;
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);

    // Second entry links to the first entry's hash.
    expect(second.previousHash).toBe(firstHash);
    const secondHash = prismaMock.auditLog.update.mock.calls[1][0].data.hash;
    expect(secondHash).toMatch(/^[0-9a-f]{64}$/);
    expect(secondHash).not.toBe(firstHash);
  });

  it('produces a deterministic hash for identical payloads (tamper-evidence)', async () => {
    // Two services with isolated stores both compute the same hash for the
    // same canonical payload when starting from the same (empty) chain.
    const first = makePrismaMock();
    const second = makePrismaMock();
    const svcA = new AuditLogService(first.mocks as any, mockLogger as any);
    const svcB = new AuditLogService(second.mocks as any, mockLogger as any);

    await svcA.log({
      userId: 'u',
      category: AuditCategory.AUTH,
      operation: 'LOGIN',
      outcome: AuditOutcome.SUCCESS,
    });
    await svcB.log({
      userId: 'u',
      category: AuditCategory.AUTH,
      operation: 'LOGIN',
      outcome: AuditOutcome.SUCCESS,
    });

    const hashA = first.mocks.auditLog.update.mock.calls[0][0].data.hash;
    const hashB = second.mocks.auditLog.update.mock.calls[0][0].data.hash;
    expect(hashA).toBe(hashB);
  });

  // -------------------------------------------------------------------------
  // query()
  // -------------------------------------------------------------------------

  it('returns paginated results with total count', async () => {
    const result = await service.query({ userId: 'user-abc', limit: 10, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-abc' }),
        take: 10,
        skip: 0,
      }),
    );
  });

  it('caps limit at 200 regardless of caller input', async () => {
    await service.query({ limit: 9999 });
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it('filters by category and operation when provided', async () => {
    await service.query({ category: 'WALLET', operation: 'WALLET_CREATED' });
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'WALLET',
          operation: 'WALLET_CREATED',
        }),
      }),
    );
  });

  it('adds createdAt range filter when from/to are provided', async () => {
    const from = new Date('2024-01-01');
    const to = new Date('2024-12-31');
    await service.query({ from, to });
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: from, lte: to },
        }),
      }),
    );
  });
});
