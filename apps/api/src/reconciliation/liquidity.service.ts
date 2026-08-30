import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { RedisLockService } from '../common/lock/lock.service';
import {
  LiquidityExecutionResult,
  LiquidityExecutor,
  LiquidityRebalanceJob,
} from './liquidity-executor';

export const LIQUIDITY_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const LIQUIDITY_THRESHOLD_RATIO = 0.2;
export const LIQUIDITY_DEFAULT_MAX_DAILY_REBALANCES = 3;
export const LIQUIDITY_DEFAULT_MAX_DAILY_AMOUNT = 100_000;

export interface ReserveSnapshot {
  corridor: string;
  reserveAsset: string;
  reserveAmount: number;
  source: string;
  observedAt: Date;
}

export interface ReserveMonitor {
  getReserve(corridor: string, reserveAsset: string): Promise<ReserveSnapshot>;
}

/**
 * Reads reserve balances from the mock off-ramp adapter and, when no mock
 * value exists, from a configured Stellar reserve account via Horizon.
 * Production bank/mobile-money adapters can replace this class behind the
 * ReserveMonitor interface without changing rebalancing decisions.
 */
@Injectable()
export class HybridReserveMonitor implements ReserveMonitor {
  async getReserve(corridor: string, reserveAsset: string): Promise<ReserveSnapshot> {
    const configured = this.readConfiguredReserves();
    const key = `${corridor}:${reserveAsset}`;
    const mockAmount = configured[key] ?? configured[reserveAsset];
    if (mockAmount !== undefined) {
      return {
        corridor,
        reserveAsset,
        reserveAmount: mockAmount,
        source: 'mock-offramp-api',
        observedAt: new Date(),
      };
    }

    const account = this.readReserveAccounts()[corridor];
    if (account) return this.readOnChainReserve(corridor, reserveAsset, account);

    return {
      corridor,
      reserveAsset,
      reserveAmount: 0,
      source: 'unconfigured-reserve',
      observedAt: new Date(),
    };
  }

  private async readOnChainReserve(
    corridor: string,
    reserveAsset: string,
    account: string,
  ): Promise<ReserveSnapshot> {
    const horizonUrl = process.env.STELLAR_HORIZON_URL;
    if (!horizonUrl) {
      return { corridor, reserveAsset, reserveAmount: 0, source: 'unavailable-horizon', observedAt: new Date() };
    }

    try {
      const response = await axios.get<{ balances?: Array<Record<string, string>> }>(
        `${horizonUrl.replace(/\/$/, '')}/accounts/${account}`,
        { timeout: 5_000 },
      );
      const balances = response.data.balances ?? [];
      const issuer = this.readIssuers()[reserveAsset];
      const balance = balances.find((entry) => {
        if (reserveAsset === 'XLM') return entry.asset_type === 'native';
        return entry.asset_code === reserveAsset && (!issuer || entry.asset_issuer === issuer);
      });
      const amount = Number(balance?.balance ?? 0);
      return {
        corridor,
        reserveAsset,
        reserveAmount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
        source: 'stellar-horizon',
        observedAt: new Date(),
      };
    } catch {
      return { corridor, reserveAsset, reserveAmount: 0, source: 'unavailable-horizon', observedAt: new Date() };
    }
  }

  private readConfiguredReserves(): Record<string, number> {
    try {
      const parsed = JSON.parse(process.env.LIQUIDITY_MOCK_RESERVES ?? '{}') as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0),
      ) as Record<string, number>;
    } catch {
      return {};
    }
  }

  private readReserveAccounts(): Record<string, string> {
    try {
      return JSON.parse(process.env.LIQUIDITY_RESERVE_ACCOUNTS ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }

  private readIssuers(): Record<string, string> {
    try {
      return JSON.parse(process.env.LIQUIDITY_ASSET_ISSUERS ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }
}

export function forecastWeeklyDemandFromVolumes(weeklyVolumes: number[]): number {
  const validVolumes = weeklyVolumes.filter((volume) => Number.isFinite(volume) && volume >= 0);
  if (validVolumes.length === 0) return 0;
  return validVolumes.reduce((sum, volume) => sum + volume, 0) / validVolumes.length;
}

export function calculateThresholdAmount(forecastedWeeklyDemand: number): number {
  return forecastedWeeklyDemand * LIQUIDITY_THRESHOLD_RATIO;
}

@Injectable()
export class LiquidityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiquidityService.name);
  private interval?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditLogService,
    private readonly lockService: RedisLockService,
    @Inject('LIQUIDITY_RESERVE_MONITOR') private readonly monitor: ReserveMonitor,
    private readonly executor: LiquidityExecutor,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test' && process.env.LIQUIDITY_REBALANCING_ENABLED !== 'false') {
      const intervalMs = this.getPositiveEnvNumber('LIQUIDITY_CHECK_INTERVAL_MS', LIQUIDITY_CHECK_INTERVAL_MS);
      this.interval = setInterval(() => {
        void this.runHourlyCheck().catch((error) => {
          this.logger.error(`Hourly liquidity check failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, intervalMs);
      this.interval.unref?.();
      void this.runHourlyCheck().catch((error) => {
        this.logger.error(`Initial liquidity check failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  async runHourlyCheck() {
    return this.lockService.withLock('afropay:liquidity:hourly-check', async () => {
      const corridors = this.getCorridors();
      const results = await Promise.all(corridors.map((corridor) => this.checkCorridor(corridor)));
      return { checkedAt: new Date(), results };
    });
  }

  async getHealth(limit = 100) {
    const observations = await this.prisma.liquidityObservation.findMany({
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(100, Math.max(1, limit)),
    });

    return observations.map((observation) => ({
      ...observation,
      reserveAmount: Number(observation.reserveAmount),
      forecastedWeeklyDemand: Number(observation.forecastedWeeklyDemand),
      thresholdAmount: Number(observation.thresholdAmount),
      health: this.getHealthLevel(
        Number(observation.reserveAmount),
        Number(observation.forecastedWeeklyDemand),
      ),
    }));
  }

  async listRebalances(limit = 100) {
    return this.prisma.liquidityRebalance.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(100, Math.max(1, limit)),
    });
  }

  async recordExecutionResult(
    rebalanceId: string,
    result: LiquidityExecutionResult,
  ) {
    const current = await this.prisma.liquidityRebalance.findUnique({ where: { id: rebalanceId } });
    if (!current) throw new NotFoundException('Liquidity rebalance not found');
    if (current.status === 'EXECUTED' && current.txHash === result.txHash) return current;
    if (current.status !== 'EXECUTING') {
      throw new ConflictException(`Cannot record a result for a rebalance in state ${current.status}`);
    }
    if (result.success && !result.txHash) {
      throw new BadRequestException('Successful liquidity execution requires a transaction hash');
    }

    const updated = await this.prisma.liquidityRebalance.update({
      where: { id: rebalanceId },
      data: result.success
        ? { status: 'EXECUTED', txHash: result.txHash, executedAt: new Date() }
        : { status: 'FAILED', failureReason: result.error },
    });

    await this.auditService.log({
      category: 'LIQUIDITY',
      operation: result.success ? 'LIQUIDITY_REBALANCE_EXECUTED' : 'LIQUIDITY_REBALANCE_FAILED',
      outcome: result.success ? 'SUCCESS' : 'FAILURE',
      txHash: result.txHash ?? undefined,
      metadata: { rebalanceId, error: result.error ?? null },
    });

    return updated;
  }

  private async checkCorridor(corridor: CorridorConfig) {
    const reserve = await this.monitor.getReserve(corridor.name, corridor.toAsset);
    const forecast = await this.forecastDemand(corridor.toAsset);
    const threshold = calculateThresholdAmount(forecast);

    await this.prisma.liquidityObservation.create({
      data: {
        corridor: corridor.name,
        reserveAsset: corridor.toAsset,
        reserveAmount: reserve.reserveAmount,
        forecastedWeeklyDemand: forecast,
        thresholdAmount: threshold,
        source: reserve.source,
        observedAt: reserve.observedAt,
      },
    });

    if (forecast <= 0 || reserve.reserveAmount >= threshold) {
      return { corridor: corridor.name, status: 'HEALTHY', reserveAmount: reserve.reserveAmount, forecast };
    }

    const guard = await this.checkRebalanceGuards(corridor.name, corridor.fromAsset, corridor.toAsset, threshold - reserve.reserveAmount);
    if ('reason' in guard) {
      await this.prisma.liquidityRebalance.create({
        data: {
          corridor: corridor.name,
          fromAsset: corridor.fromAsset,
          toAsset: corridor.toAsset,
          sourceAmount: 0,
          amount: 0,
          status: 'SKIPPED',
          reason: guard.reason,
        },
      });
      this.logger.warn(`Liquidity rebalance skipped for ${corridor.name}: ${guard.reason}`);
      return { corridor: corridor.name, status: 'SKIPPED', reason: guard.reason };
    }

    const configError = this.getExecutionConfigError(corridor);
    if (configError) {
      await this.prisma.liquidityRebalance.create({
        data: {
          corridor: corridor.name,
          fromAsset: corridor.fromAsset,
          toAsset: corridor.toAsset,
          sourceAmount: 0,
          amount: 0,
          status: 'SKIPPED',
          reason: configError,
        },
      });
      this.logger.warn(`Liquidity rebalance skipped for ${corridor.name}: ${configError}`);
      return { corridor: corridor.name, status: 'SKIPPED', reason: configError };
    }

    const rebalance = await this.prisma.liquidityRebalance.create({
      data: {
        corridor: corridor.name,
        fromAsset: corridor.fromAsset,
        toAsset: corridor.toAsset,
        sourceAmount: guard.sourceAmount,
        amount: guard.destinationAmount,
        status: 'PLANNED',
        reason: `Reserve ${reserve.reserveAmount} is below ${LIQUIDITY_THRESHOLD_RATIO * 100}% of forecast ${forecast}`,
      },
    });

    const job: LiquidityRebalanceJob = {
      rebalanceId: rebalance.id,
      corridor: corridor.name,
      fromAsset: corridor.fromAsset,
      toAsset: corridor.toAsset,
      sourceAmount: String(guard.sourceAmount),
      destinationMinAmount: String(guard.destinationAmount),
      treasuryAccount: process.env.LIQUIDITY_TREASURY_PUBLIC_KEY ?? '',
      destinationAccount: this.getReserveAccount(corridor.name) ?? '',
      fromAssetIssuer: this.getIssuer(corridor.fromAsset) ?? '',
      toAssetIssuer: this.getIssuer(corridor.toAsset) ?? '',
      network: process.env.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
    };

    try {
      // Mark before enqueueing so a fast worker callback cannot race this state transition.
      await this.prisma.liquidityRebalance.update({
        where: { id: rebalance.id },
        data: { status: 'EXECUTING' },
      });
      const execution = await this.executor.execute(job);
      await this.auditService.log({
        category: 'LIQUIDITY',
        operation: 'LIQUIDITY_REBALANCE_DISPATCHED',
        outcome: 'SUCCESS',
        metadata: { rebalanceId: rebalance.id, jobRef: execution.jobRef, corridor: corridor.name, sourceAmount: guard.sourceAmount, destinationAmount: guard.destinationAmount },
      });
      this.logger.log(`Liquidity rebalance dispatched for ${corridor.name}: ${guard.sourceAmount} ${corridor.fromAsset} -> ${guard.destinationAmount} ${corridor.toAsset}`);
      return { corridor: corridor.name, status: 'EXECUTING', rebalanceId: rebalance.id, sourceAmount: guard.sourceAmount, destinationAmount: guard.destinationAmount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.liquidityRebalance.update({
        where: { id: rebalance.id },
        data: { status: 'FAILED', failureReason: message },
      });
      await this.auditService.log({
        category: 'LIQUIDITY',
        operation: 'LIQUIDITY_REBALANCE_FAILED',
        outcome: 'FAILURE',
        metadata: { rebalanceId: rebalance.id, corridor: corridor.name, error: message },
      });
      throw error;
    }
  }

  private async forecastDemand(asset: string): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - 56);
    const transactions = await this.prisma.transaction.findMany({
      where: { assetCode: asset, createdAt: { gte: since } },
      select: { amount: true, createdAt: true },
    });

    const byWeek = new Map<string, number>();
    for (const transaction of transactions) {
      const week = this.weekKey(transaction.createdAt);
      byWeek.set(week, (byWeek.get(week) ?? 0) + Number(transaction.amount));
    }

    const configuredFallback = Number(process.env.LIQUIDITY_DEFAULT_WEEKLY_DEMAND ?? 0);
    return forecastWeeklyDemandFromVolumes(
      byWeek.size > 0 ? [...byWeek.values()] : [Number.isFinite(configuredFallback) ? configuredFallback : 0],
    );
  }

  private async checkRebalanceGuards(
    corridor: string,
    fromAsset: string,
    toAsset: string,
    requestedAmount: number,
  ): Promise<{ allowed: true; sourceAmount: number; destinationAmount: number } | { allowed: false; reason: string }> {
    const maxRebalances = this.getPositiveEnvNumber(
      'LIQUIDITY_MAX_DAILY_REBALANCES',
      LIQUIDITY_DEFAULT_MAX_DAILY_REBALANCES,
    );
    const maxDailyAmount = this.getPositiveEnvNumber(
      'LIQUIDITY_MAX_DAILY_AMOUNT',
      LIQUIDITY_DEFAULT_MAX_DAILY_AMOUNT,
    );
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [dailyCount, dailyVolume, latest] = await Promise.all([
      this.prisma.liquidityRebalance.count({
        where: { corridor, createdAt: { gte: startOfDay }, status: { not: 'SKIPPED' } },
      }),
      this.prisma.liquidityRebalance.aggregate({
        where: { corridor, createdAt: { gte: startOfDay }, status: { not: 'SKIPPED' } },
        _sum: { amount: true },
      }),
      this.prisma.liquidityRebalance.findFirst({
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          status: { not: 'SKIPPED' },
          OR: [
            { corridor },
            { fromAsset: toAsset, toAsset: fromAsset },
          ],
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (dailyCount >= maxRebalances) return { allowed: false, reason: 'Daily rebalance count limit reached' };
    if (latest && latest.fromAsset === toAsset && latest.toAsset === fromAsset) {
      return { allowed: false, reason: 'Opposite-direction rebalance blocked by 24-hour reconciler cooldown' };
    }

    const used = Number(dailyVolume._sum.amount ?? 0);
    const remaining = maxDailyAmount - used;
    const destinationAmount = Math.min(requestedAmount, remaining);
    if (destinationAmount <= 0) return { allowed: false, reason: 'Daily rebalance volume limit reached' };

    const rate = this.getPositiveEnvNumber(
      `LIQUIDITY_RATE_${fromAsset}_${toAsset}`,
      this.getPositiveEnvNumber('LIQUIDITY_DEFAULT_RATE', 1),
    );
    return {
      allowed: true,
      sourceAmount: Number((destinationAmount / rate).toFixed(7)),
      destinationAmount: Number(destinationAmount.toFixed(7)),
    };
  }

  private getCorridors(): CorridorConfig[] {
    const raw = process.env.LIQUIDITY_CORRIDORS ?? 'USDC:NGN,USDC:GHS';
    return raw.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const [fromAsset, toAsset] = entry.split(':').map((value) => value.trim().toUpperCase());
      return { name: `${fromAsset}:${toAsset}`, fromAsset, toAsset };
    }).filter((corridor) => corridor.fromAsset && corridor.toAsset);
  }

  private getExecutionConfigError(corridor: CorridorConfig): string | undefined {
    if (!process.env.LIQUIDITY_TREASURY_PUBLIC_KEY) return 'Treasury public key is not configured';
    if (!this.getReserveAccount(corridor.name)) return `Reserve account is not configured for ${corridor.name}`;
    if (corridor.fromAsset !== 'XLM' && !this.getIssuer(corridor.fromAsset)) return `Issuer is not configured for ${corridor.fromAsset}`;
    if (corridor.toAsset !== 'XLM' && !this.getIssuer(corridor.toAsset)) return `Issuer is not configured for ${corridor.toAsset}`;
    return undefined;
  }

  private getReserveAccount(corridor: string): string | undefined {
    try {
      const accounts = JSON.parse(process.env.LIQUIDITY_RESERVE_ACCOUNTS ?? '{}') as Record<string, string>;
      return accounts[corridor];
    } catch {
      return undefined;
    }
  }

  private getIssuer(asset: string): string | undefined {
    try {
      const issuers = JSON.parse(process.env.LIQUIDITY_ASSET_ISSUERS ?? '{}') as Record<string, string>;
      return issuers[asset];
    } catch {
      return undefined;
    }
  }

  private getPositiveEnvNumber(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private getHealthLevel(reserve: number, forecast: number): 'HEALTHY' | 'WATCH' | 'CRITICAL' {
    if (forecast <= 0 || reserve >= forecast * 0.5) return 'HEALTHY';
    if (reserve >= forecast * LIQUIDITY_THRESHOLD_RATIO) return 'WATCH';
    return 'CRITICAL';
  }

  private weekKey(date: Date): string {
    const weekStart = new Date(date);
    const day = weekStart.getUTCDay() || 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - day + 1);
    return weekStart.toISOString().slice(0, 10);
  }
}

type CorridorConfig = {
  name: string;
  fromAsset: string;
  toAsset: string;
};
