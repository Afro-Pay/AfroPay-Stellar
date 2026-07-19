import { Test, TestingModule } from '@nestjs/testing';
import {
  AuditLogService,
  AuditCategory,
  AuditOperation,
  AuditOutcome,
} from './audit.service';

// ---------------------------------------------------------------------------
// Minimal PrismaService mock — isolates AuditLogService from the database.
// ---------------------------------------------------------------------------
const mockCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
const mockCount = jest.fn().mockResolvedValue(2);
const mockFindMany = jest.fn().mockResolvedValue([
  { id: 'audit-1', operation: 'WALLET_CREATED', createdAt: new Date() },
  { id: 'audit-2', operation: 'TX_SUBMITTED', createdAt: new Date() },
]);

const mockPrisma = {
  auditLog: {
    create: mockCreate,
    count: mockCount,
    findMany: mockFindMany,
  },
};

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: 'PrismaService', useValue: mockPrisma },
      ],
    })
      .overrideProvider('PrismaService')
      .useValue(mockPrisma)
      .compile();

    // Manually construct with mock because NestJS DI token is PrismaService class.
    service = new AuditLogService(mockPrisma as any);
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

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0][0].data;
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

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0][0].data;
    expect(payload.amount).toBe('100');
    expect(payload.assetCode).toBe('XLM');
    expect(payload.destination).toBe('GDEST456');
  });

  it('does NOT throw when the DB write fails (fire-and-forget safety)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB is down'));

    await expect(
      service.log({
        userId: 'user-abc',
        category: AuditCategory.WALLET,
        operation: AuditOperation.WALLET_EXPORTED,
        outcome: AuditOutcome.SUCCESS,
      }),
    ).resolves.not.toThrow();
  });

  it('includes timestamp in the log entry (createdAt is set by Prisma default)', async () => {
    await service.log({
      category: AuditCategory.TRANSACTION,
      operation: AuditOperation.TX_FAILED,
      outcome: AuditOutcome.FAILURE,
      metadata: { txId: 'tx-99', error: 'Timeout' },
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0][0].data;
    // createdAt is managed by Prisma @default(now()) — we just confirm metadata passed through
    expect(payload.metadata).toEqual({ txId: 'tx-99', error: 'Timeout' });
  });

  // -------------------------------------------------------------------------
  // query()
  // -------------------------------------------------------------------------

  it('returns paginated results with total count', async () => {
    const result = await service.query({ userId: 'user-abc', limit: 10, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-abc' }),
        take: 10,
        skip: 0,
      }),
    );
  });

  it('caps limit at 200 regardless of caller input', async () => {
    await service.query({ limit: 9999 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it('filters by category and operation when provided', async () => {
    await service.query({ category: 'WALLET', operation: 'WALLET_CREATED' });
    expect(mockFindMany).toHaveBeenCalledWith(
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
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: from, lte: to },
        }),
      }),
    );
  });
});
