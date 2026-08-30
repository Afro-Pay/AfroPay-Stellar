import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Payload published to the Rust worker's `compliance_jobs` Redis list.
 * Deliberately contains no secret material — the worker loads the signing
 * (issuer/compliance treasury) key from its own environment.
 */
export interface ComplianceJobPayload {
  actionId: string;
  actionType: 'FREEZE' | 'CLAWBACK';
  targetAccount: string;
  assetCode: string;
  assetIssuer: string | null;
  amount: string | null;
  network: 'testnet' | 'mainnet';
}

export interface ComplianceExecutionResult {
  /** Reference the worker can use to correlate the job (the action id). */
  jobRef: string;
  /** Stellar tx hash — null until the worker reports the on-chain result. */
  txHash: string | null;
}

/**
 * Abstraction over where compliance jobs get executed. The default
 * implementation dispatches to the Rust worker; tests substitute a mock.
 */
export abstract class ComplianceExecutor {
  abstract execute(job: ComplianceJobPayload): Promise<ComplianceExecutionResult>;
}

/**
 * Dispatches approved compliance actions to the Rust worker by pushing a JSON
 * job onto the `compliance_jobs` Redis list (BLPOP'd by the worker), mirroring
 * the existing `stellar_jobs` pattern.
 */
@Injectable()
export class RedisComplianceExecutor extends ComplianceExecutor {
  private readonly queueName: string;

  constructor() {
    super();
    this.queueName = process.env.COMPLIANCE_QUEUE_NAME || 'compliance_jobs';
  }

  async execute(job: ComplianceJobPayload): Promise<ComplianceExecutionResult> {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    try {
      await redis.rpush(this.queueName, JSON.stringify(job));
    } finally {
      redis.disconnect();
    }
    return { jobRef: job.actionId, txHash: null };
  }
}
