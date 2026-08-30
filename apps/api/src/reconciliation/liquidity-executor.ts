import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

export interface LiquidityRebalanceJob {
  rebalanceId: string;
  corridor: string;
  fromAsset: string;
  toAsset: string;
  sourceAmount: string;
  destinationMinAmount: string;
  treasuryAccount: string;
  destinationAccount: string;
  fromAssetIssuer: string;
  toAssetIssuer: string;
  network: 'testnet' | 'mainnet';
}

export interface LiquidityExecutionResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export abstract class LiquidityExecutor {
  abstract execute(job: LiquidityRebalanceJob): Promise<{ jobRef: string }>;
}

@Injectable()
export class RedisLiquidityExecutor extends LiquidityExecutor {
  private readonly queueName = process.env.LIQUIDITY_QUEUE_NAME || 'liquidity_rebalance_jobs';

  async execute(job: LiquidityRebalanceJob): Promise<{ jobRef: string }> {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    try {
      await redis.rpush(this.queueName, JSON.stringify(job));
    } finally {
      redis.disconnect();
    }
    return { jobRef: job.rebalanceId };
  }
}
