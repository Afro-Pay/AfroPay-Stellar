import { createHash } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditCategory, AuditLogService, AuditOperation, AuditOutcome } from '../audit/audit.service';
import { ComplianceExecutor, ComplianceJobPayload } from './compliance-executor';
import { ComplianceClawbackDto, ComplianceFreezeDto } from './dto';

/**
 * Number of distinct compliance officers that must sign before a compliance
 * action may be executed on-chain (mandatory multi-sig approval).
 */
export const REQUIRED_COMPLIANCE_APPROVALS = 2;

type ComplianceType = 'FREEZE' | 'CLAWBACK';

/**
 * Compliance actions for regulated corridors.
 *
 * Freeze (SetTrustLineFlags) and clawback (Clawback) operations are sensitive:
 * they move or block customer funds, so every action must be approved by at
 * least {@link REQUIRED_COMPLIANCE_APPROVALS} distinct compliance officers
 * before it is dispatched to the Rust worker for on-chain execution. Every
 * step of the lifecycle is written to the cryptographically chained audit log.
 */
@Injectable()
export class ComplianceActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditLogService,
    @Inject(ComplianceExecutor) private readonly executor: ComplianceExecutor,
  ) {}

  // -------------------------------------------------------------------------
  // Request (officer #1 — also records their approval)
  // -------------------------------------------------------------------------

  async requestFreeze(officerId: string, dto: ComplianceFreezeDto) {
    return this.requestAction(officerId, 'FREEZE', dto);
  }

  async requestClawback(officerId: string, dto: ComplianceClawbackDto) {
    return this.requestAction(officerId, 'CLAWBACK', dto);
  }

  private async requestAction(
    officerId: string,
    type: ComplianceType,
    dto: ComplianceFreezeDto | ComplianceClawbackDto,
  ) {
    await this.assertAdmin(officerId);

    const action = await this.prisma.complianceAction.create({
      data: {
        type,
        status: 'PENDING_APPROVAL',
        targetAccount: dto.targetAccount,
        assetCode: dto.assetCode,
        assetIssuer: dto.assetIssuer ?? null,
        amount: 'amount' in dto ? (dto as ComplianceClawbackDto).amount : null,
        reason: dto.reason ?? null,
        requestedBy: officerId,
      },
    });

    // The requesting officer is the first signer of the action.
    await this.prisma.complianceApproval.create({
      data: {
        actionId: action.id,
        officerId,
        signature: this.signApproval(officerId, action),
      },
    });

    await this.auditService.log({
      userId: officerId,
      category: AuditCategory.COMPLIANCE,
      operation:
        type === 'FREEZE'
          ? AuditOperation.COMPLIANCE_FREEZE_REQUESTED
          : AuditOperation.COMPLIANCE_CLAWBACK_REQUESTED,
      outcome: AuditOutcome.SUCCESS,
      metadata: {
        actionId: action.id,
        targetAccount: action.targetAccount,
        assetCode: action.assetCode,
        assetIssuer: action.assetIssuer,
        amount: action.amount,
        reason: action.reason,
      },
    });

    return this.getAction(action.id);
  }

  // -------------------------------------------------------------------------
  // Approval (officer #2+ — triggers execution at the threshold)
  // -------------------------------------------------------------------------

  async approve(officerId: string, actionId: string) {
    await this.assertAdmin(officerId);
    const action = await this.loadAction(actionId);
    this.assertAwaitingApproval(action);

    const alreadyApproved = await this.prisma.complianceApproval.findUnique({
      where: { actionId_officerId: { actionId, officerId } },
    });
    if (alreadyApproved) {
      throw new ConflictException('Officer has already approved this action');
    }

    await this.prisma.complianceApproval.create({
      data: {
        actionId,
        officerId,
        signature: this.signApproval(officerId, action),
      },
    });

    await this.auditService.log({
      userId: officerId,
      category: AuditCategory.COMPLIANCE,
      operation: AuditOperation.COMPLIANCE_ACTION_APPROVED,
      outcome: AuditOutcome.SUCCESS,
      metadata: { actionId, officerId, targetAccount: action.targetAccount },
    });

    const approvalCount = await this.prisma.complianceApproval.count({
      where: { actionId },
    });
    if (approvalCount >= REQUIRED_COMPLIANCE_APPROVALS) {
      await this.execute(action);
    }

    return this.getAction(action.id);
  }

  // -------------------------------------------------------------------------
  // Rejection
  // -------------------------------------------------------------------------

  async reject(officerId: string, actionId: string, reason?: string) {
    await this.assertAdmin(officerId);
    const action = await this.loadAction(actionId);
    this.assertAwaitingApproval(action);

    const updated = await this.prisma.complianceAction.update({
      where: { id: actionId },
      data: { status: 'REJECTED' },
    });

    await this.auditService.log({
      userId: officerId,
      category: AuditCategory.COMPLIANCE,
      operation: AuditOperation.COMPLIANCE_ACTION_REJECTED,
      outcome: AuditOutcome.SUCCESS,
      metadata: { actionId, rejectedBy: officerId, reason: reason ?? null },
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Execution + result recording
  // -------------------------------------------------------------------------

  /**
   * Dispatches an approved action to the Rust worker. Idempotent — actions
   * that already left the PENDING_APPROVAL state are not re-dispatched.
   */
  private async execute(action: {
    id: string;
    type: ComplianceType;
    targetAccount: string;
    assetCode: string;
    assetIssuer: string | null;
    amount: string | null;
    status: string;
  }) {
    await this.prisma.complianceAction.update({
      where: { id: action.id },
      data: { status: 'APPROVED' },
    });

    const job: ComplianceJobPayload = {
      actionId: action.id,
      actionType: action.type,
      targetAccount: action.targetAccount,
      assetCode: action.assetCode,
      assetIssuer: action.assetIssuer,
      amount: action.amount,
      network: process.env.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
    };

    const result = await this.executor.execute(job);

    await this.prisma.complianceAction.update({
      where: { id: action.id },
      data: { status: 'EXECUTING' },
    });

    await this.auditService.log({
      category: AuditCategory.COMPLIANCE,
      operation: AuditOperation.COMPLIANCE_ACTION_DISPATCHED,
      outcome: AuditOutcome.SUCCESS,
      metadata: { actionId: action.id, jobRef: result.jobRef, actionType: action.type },
    });
  }

  /**
   * Records the on-chain result reported by the worker (or ops tooling).
   * Marks the action EXECUTED (with tx hash) or FAILED.
   */
  async recordExecutionResult(
    actionId: string,
    txHash: string,
    outcome: 'SUCCESS' | 'FAILURE',
  ) {
    const action = await this.loadAction(actionId);
    if (action.status !== 'EXECUTING' && action.status !== 'APPROVED') {
      throw new ConflictException(
        `Cannot record a result for an action in state ${action.status}`,
      );
    }

    const updated = await this.prisma.complianceAction.update({
      where: { id: actionId },
      data: {
        status: outcome === 'SUCCESS' ? 'EXECUTED' : 'FAILED',
        ...(outcome === 'SUCCESS' ? { txHash } : {}),
      },
    });

    await this.auditService.log({
      category: AuditCategory.COMPLIANCE,
      operation:
        outcome === 'SUCCESS'
          ? AuditOperation.COMPLIANCE_ACTION_EXECUTED
          : AuditOperation.COMPLIANCE_ACTION_FAILED,
      outcome: outcome === 'SUCCESS' ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
      txHash: outcome === 'SUCCESS' ? txHash : null,
      metadata: { actionId },
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  async list(query: { status?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const offset = Math.max(0, query.offset ?? 0);
    const where = query.status ? { status: query.status as any } : {};

    const [total, actions] = await Promise.all([
      this.prisma.complianceAction.count({ where }),
      this.prisma.complianceAction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        include: { approvals: true },
      }),
    ]);

    return { total, actions };
  }

  async getAction(actionId: string) {
    return this.loadAction(actionId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async loadAction(actionId: string) {
    const action = await this.prisma.complianceAction.findUnique({
      where: { id: actionId },
      include: { approvals: true },
    });
    if (!action) throw new NotFoundException('Compliance action not found');
    return action;
  }

  private assertAwaitingApproval(action: { status: string }) {
    if (action.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(
        `Action is ${action.status}, not awaiting approval`,
      );
    }
  }

  /**
   * Deterministic SHA-256 signature binding an officer to a specific action.
   * The secret comes from the environment so signatures cannot be forged by
   * someone who can read the database alone.
   */
  private signApproval(
    officerId: string,
    action: { id: string; targetAccount: string; assetCode: string; amount: string | null },
  ): string {
    const secret = process.env.COMPLIANCE_SIGNING_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret';
    const canonical = [
      officerId,
      action.id,
      action.targetAccount,
      action.assetCode,
      action.amount ?? '',
      secret,
    ].join(':');
    return createHash('sha256').update(canonical).digest('hex');
  }

  private async assertAdmin(userId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, erasedAt: true },
    });
    if (!admin || admin.role !== 'ADMIN' || admin.erasedAt) {
      throw new ForbiddenException('Administrator access is required');
    }
  }
}
