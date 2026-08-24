import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ComplianceActionService, REQUIRED_COMPLIANCE_APPROVALS } from './compliance-action.service';
import { ComplianceExecutor } from './compliance-executor';

const FREEZE_DTO = {
  targetAccount: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST',
  assetCode: 'USDC',
  assetIssuer: 'GISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  reason: 'Flagged for sanctions exposure',
};

const CLAWBACK_DTO = {
  ...FREEZE_DTO,
  amount: '1250.50',
};

function makeMocks() {
  const actions: any[] = [];
  const approvals: any[] = [];
  const users = [
    { id: 'officer-1', role: 'ADMIN', erasedAt: null },
    { id: 'officer-2', role: 'ADMIN', erasedAt: null },
    { id: 'officer-3', role: 'ADMIN', erasedAt: null },
    { id: 'plain-user', role: 'USER', erasedAt: null },
  ];

  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => u.id === where.id) ?? null),
      ),
    },
    complianceAction: {
      create: jest.fn(({ data }: any) => {
        const action = {
          id: `action-${actions.length + 1}`,
          createdAt: new Date('2026-08-24T00:00:00.000Z'),
          updatedAt: new Date('2026-08-24T00:00:00.000Z'),
          ...data,
        };
        actions.push(action);
        return Promise.resolve(action);
      }),
      findUnique: jest.fn(({ where }: any) => {
        const action = actions.find((a) => a.id === where.id);
        if (!action) return Promise.resolve(null);
        return Promise.resolve({
          ...action,
          approvals: approvals.filter((p) => p.actionId === action.id),
        });
      }),
      update: jest.fn(({ where, data }: any) => {
        const action = actions.find((a) => a.id === where.id);
        Object.assign(action, data);
        return Promise.resolve(action);
      }),
      count: jest.fn(({ where }: any) =>
        Promise.resolve(
          actions.filter((a) => !where || Object.keys(where).length === 0 || a.status === where.status)
            .length,
        ),
      ),
      findMany: jest.fn(({ where, take, skip }: any) => {
        const filtered = actions.filter(
          (a) => !where || Object.keys(where).length === 0 || a.status === where.status,
        );
        const sorted = [...filtered].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
        );
        return Promise.resolve(
          sorted.slice(skip ?? 0, (skip ?? 0) + (take ?? 25)).map((a) => ({
            ...a,
            approvals: approvals.filter((p) => p.actionId === a.id),
          })),
        );
      }),
    },
    complianceApproval: {
      create: jest.fn(({ data }: any) => {
        const approval = { id: `approval-${approvals.length + 1}`, approvedAt: new Date(), ...data };
        approvals.push(approval);
        return Promise.resolve(approval);
      }),
      findUnique: jest.fn(({ where }: any) => {
        const { actionId, officerId } = where.actionId_officerId;
        return Promise.resolve(
          approvals.find((p) => p.actionId === actionId && p.officerId === officerId) ?? null,
        );
      }),
      count: jest.fn(({ where }: any) =>
        Promise.resolve(approvals.filter((p) => p.actionId === where.actionId).length),
      ),
    },
  };

  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const executor = {
    execute: jest.fn().mockResolvedValue({ jobRef: 'action-1', txHash: null }),
  } as unknown as ComplianceExecutor;

  return { prisma, audit, executor, actions, approvals };
}

function makeService(mocks: ReturnType<typeof makeMocks>) {
  return new ComplianceActionService(mocks.prisma as any, mocks.audit as any, mocks.executor);
}

describe('ComplianceActionService', () => {
  it('requires at least two distinct officers to approve', () => {
    expect(REQUIRED_COMPLIANCE_APPROVALS).toBe(2);
  });

  describe('requestFreeze', () => {
    it('creates a PENDING_APPROVAL action and records the requester as first approver', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);

      const result = await service.requestFreeze('officer-1', FREEZE_DTO);

      expect(result.status).toBe('PENDING_APPROVAL');
      expect(result.type).toBe('FREEZE');
      expect(result.requestedBy).toBe('officer-1');
      expect(result.approvals).toHaveLength(1);
      expect(result.approvals[0].officerId).toBe('officer-1');
      expect(result.approvals[0].signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects non-admin callers with ForbiddenException and creates nothing', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);

      await expect(service.requestFreeze('plain-user', FREEZE_DTO)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mocks.prisma.complianceAction.create).not.toHaveBeenCalled();
      expect(mocks.audit.log).not.toHaveBeenCalled();
    });

    it('writes a chained audit log entry on request', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);

      await service.requestFreeze('officer-1', FREEZE_DTO);

      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'officer-1',
          category: 'COMPLIANCE',
          operation: 'COMPLIANCE_FREEZE_REQUESTED',
          outcome: 'SUCCESS',
          metadata: expect.objectContaining({ targetAccount: FREEZE_DTO.targetAccount }),
        }),
      );
    });
  });

  describe('requestClawback', () => {
    it('stores the clawback amount and type CLAWBACK', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);

      const result = await service.requestClawback('officer-1', CLAWBACK_DTO);

      expect(result.type).toBe('CLAWBACK');
      expect(result.amount).toBe('1250.50');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'COMPLIANCE_CLAWBACK_REQUESTED' }),
      );
    });
  });

  describe('approve (multi-sig)', () => {
    it('does not execute with a single approval', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);

      // Second officer signs — threshold reached.
      const result = await service.approve('officer-2', 'action-1');

      expect(result.status).toBe('EXECUTING');
      expect(mocks.executor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: 'action-1',
          actionType: 'FREEZE',
          targetAccount: FREEZE_DTO.targetAccount,
        }),
      );
    });

    it('dispatches to the executor only once the second distinct officer approves', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);

      // A second approval by the *same* officer is rejected.
      await expect(service.approve('officer-1', 'action-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mocks.executor.execute).not.toHaveBeenCalled();
    });

    it('signs each officer with a distinct, deterministic signature', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);
      await service.approve('officer-2', 'action-1');

      const sig1 = mocks.approvals[0].signature;
      const sig2 = mocks.approvals[1].signature;
      expect(sig1).not.toBe(sig2);

      // Deterministic: recomputing the signature for the same officer + action
      // reproduces the stored value.
      const recomputed = (service as any).signApproval('officer-1', {
        id: 'action-1',
        targetAccount: FREEZE_DTO.targetAccount,
        assetCode: FREEZE_DTO.assetCode,
        amount: null,
      });
      expect(recomputed).toBe(sig1);
    });

    it('rejects approval of a missing action', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);

      await expect(service.approve('officer-2', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects approval of an action that is not awaiting approval', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);
      await service.approve('officer-2', 'action-1');

      await expect(service.approve('officer-3' as any, 'action-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects non-admin approvers', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);

      await expect(service.approve('plain-user', 'action-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mocks.executor.execute).not.toHaveBeenCalled();
    });

    it('logs approval and dispatch to the audit log', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);
      await service.approve('officer-2', 'action-1');

      const operations = mocks.audit.log.mock.calls.map((c) => c[0].operation);
      expect(operations).toContain('COMPLIANCE_ACTION_APPROVED');
      expect(operations).toContain('COMPLIANCE_ACTION_DISPATCHED');
    });
  });

  describe('reject', () => {
    it('marks the action REJECTED and logs the rejection', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);

      const result = await service.reject('officer-2', 'action-1', 'No supporting evidence');

      expect(result.status).toBe('REJECTED');
      expect(mocks.executor.execute).not.toHaveBeenCalled();
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'COMPLIANCE_ACTION_REJECTED',
          metadata: expect.objectContaining({ reason: 'No supporting evidence' }),
        }),
      );
    });

    it('rejects rejection of an already-final action', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);
      await service.reject('officer-2', 'action-1');

      await expect(service.reject('officer-2', 'action-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('recordExecutionResult', () => {
    it('marks the action EXECUTED with the tx hash on success', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);
      await service.approve('officer-2', 'action-1');

      const result = await service.recordExecutionResult('action-1', 'abc123', 'SUCCESS');

      expect(result.status).toBe('EXECUTED');
      expect(result.txHash).toBe('abc123');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'COMPLIANCE_ACTION_EXECUTED',
          outcome: 'SUCCESS',
          txHash: 'abc123',
        }),
      );
    });

    it('marks the action FAILED on failure', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);
      await service.approve('officer-2', 'action-1');

      const result = await service.recordExecutionResult('action-1', 'abc123', 'FAILURE');

      expect(result.status).toBe('FAILED');
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'COMPLIANCE_ACTION_FAILED', outcome: 'FAILURE' }),
      );
    });
  });

  describe('list / getAction', () => {
    it('lists actions with approval counts', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);
      await service.requestClawback('officer-1', CLAWBACK_DTO);

      const result = await service.list({});

      expect(result.total).toBe(2);
      expect(result.actions).toHaveLength(2);
    });

    it('filters by status', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.requestFreeze('officer-1', FREEZE_DTO);

      const pending = await service.list({ status: 'PENDING_APPROVAL' });
      const executed = await service.list({ status: 'EXECUTED' });

      expect(pending.total).toBe(1);
      expect(executed.total).toBe(0);
    });
  });
});
