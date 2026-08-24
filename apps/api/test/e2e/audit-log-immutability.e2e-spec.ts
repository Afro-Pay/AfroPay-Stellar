/**
 * E2E: AuditLog append-only enforcement
 *
 * Verifies the database-level trigger added by the
 * `audit_log_immutable_trigger` migration — the same guarantee described on
 * the AuditLog model ("Each row is immutable by convention") but now backed
 * by a PL/pgSQL trigger instead of relying on application code alone.
 *
 * Runs against the real Postgres instance the E2E job starts (see
 * .github/workflows/ci.yml), after `prisma migrate deploy` has applied this
 * migration.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createApp } from './helpers';

describe('AuditLog immutability trigger', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createRow() {
    return prisma.auditLog.create({
      data: {
        category: 'AUTH',
        operation: 'LOGIN',
        outcome: 'SUCCESS',
        metadata: { note: 'immutability-test' },
      },
    });
  }

  it('rejects a direct UPDATE against an existing row', async () => {
    const row = await createRow();

    await expect(
      prisma.auditLog.update({
        where: { id: row.id },
        data: { outcome: 'FAILURE' },
      }),
    ).rejects.toThrow(/immutable/i);

    const reloaded = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(reloaded.outcome).toBe('SUCCESS');
  });

  it('rejects a direct DELETE against an existing row', async () => {
    const row = await createRow();

    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/immutable/i);

    const reloaded = await prisma.auditLog.findUnique({ where: { id: row.id } });
    expect(reloaded).not.toBeNull();
  });

  it('permits UPDATE only inside the anonymization-scoped transaction used by erasure', async () => {
    const row = await createRow();

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL audit_log.allow_anonymization = 'on'`);
      await tx.auditLog.update({
        where: { id: row.id },
        data: { userId: null, metadata: { redacted: true } },
      });
    });

    const reloaded = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(reloaded.metadata).toEqual({ redacted: true });

    // The opt-in is transaction-scoped (SET LOCAL) — it does not leak into
    // later, unrelated transactions.
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { outcome: 'FAILURE' } }),
    ).rejects.toThrow(/immutable/i);
  });

  it('still rejects DELETE even inside an anonymization-scoped transaction', async () => {
    const row = await createRow();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL audit_log.allow_anonymization = 'on'`);
        await tx.auditLog.delete({ where: { id: row.id } });
      }),
    ).rejects.toThrow(/immutable/i);
  });
});
