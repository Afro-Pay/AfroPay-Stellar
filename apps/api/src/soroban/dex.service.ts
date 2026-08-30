import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { Horizon, Asset } from 'stellar-sdk';
import { RpcClientService } from './rpc-client.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StellarAsset {
  code: string;
  /** Issuer account ID (G…). Empty string for native XLM. */
  issuer: string;
}

export interface PathHop {
  asset: StellarAsset;
  /** Effective exchange rate for this hop (output / input). */
  rate: number;
}

export interface PaymentPath {
  sourceAsset: StellarAsset;
  destinationAsset: StellarAsset;
  /** Intermediate assets in the path, excluding source and destination. */
  path: StellarAsset[];
  sourceAmount: string;
  destinationAmount: string;
  /** Effective overall exchange rate (destination / source). */
  effectiveRate: number;
  /** Estimated ledger fee in stroops. */
  estimatedFeeStroops: number;
  /** Path cost score — lower is better. Accounts for rate, fee, and hop count. */
  costScore: number;
}

export interface SlippageGuardResult {
  safe: boolean;
  actualRate: number;
  minRate: number;
  slippagePct: number;
}

export interface ArbitrageOpportunity {
  assetPair: [StellarAsset, StellarAsset];
  sdexRate: number;
  ammRate: number;
  spreadPct: number;
  direction: 'BUY_ON_SDEX_SELL_ON_AMM' | 'BUY_ON_AMM_SELL_ON_SDEX';
}

export interface FindPathsOptions {
  /** Maximum number of paths to return (default: 5). */
  maxPaths?: number;
  /** Maximum slippage percentage (default: 1.0). */
  maxSlippagePct?: number;
}

export interface LiquidityPoolReserves {
  reserveA: number;
  reserveB: number;
  fee: string;
  poolId: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_FEE_STROOPS = 100;
const DEFAULT_MAX_PATHS = 5;
/** Default maximum slippage: 1 %. */
const DEFAULT_MAX_SLIPPAGE_PCT = 1.0;
const ARBITRAGE_MIN_SPREAD_PCT = 0.5;

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * DexService — Dynamic liquidity routing via Stellar SDEX and Soroban AMMs.
 *
 * Responsibilities:
 * 1. Query Horizon for available strict-send / strict-receive payment paths.
 * 2. Score and rank paths using a Bellman-Ford–inspired cost model.
 * 3. Apply dynamic slippage protection before execution.
 * 4. Probe SDEX vs Soroban AMM rates to surface arbitrage opportunities.
 * 5. Estimate ledger fees as part of path cost calculations.
 */
@Injectable()
export class DexService {
  private readonly logger = new Logger(DexService.name);
  private readonly horizonUrl: string;

  constructor(@Optional() private readonly rpcClient?: RpcClientService) {
    this.horizonUrl =
      process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Find and rank the optimal payment paths from `sourceAsset` to
   * `destinationAsset` for a given `sourceAmount`.
   *
   * Uses Horizon's `/paths/strict-send` endpoint and applies a
   * Bellman-Ford–inspired cost model that factors in:
   * - Exchange rate (higher is better)
   * - Number of intermediate hops (fewer is better)
   * - Estimated ledger fee
   *
   * @returns Ranked list of payment paths (best first).
   * @throws BadRequestException if Horizon is unavailable or no paths found.
   */
  async findOptimalPaths(
    sourceAsset: StellarAsset,
    destinationAsset: StellarAsset,
    sourceAmount: string,
    options: FindPathsOptions = {},
  ): Promise<PaymentPath[]> {
    const startTime = Date.now();
    const maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
    const parsedAmount = parseFloat(sourceAmount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      throw new BadRequestException('sourceAmount must be a positive number');
    }

    const paths = await this.queryHorizonPaths(
      sourceAsset,
      destinationAsset,
      sourceAmount,
    );

    if (paths.length === 0) {
      this.logger.warn(
        `No paths found from ${sourceAsset.code} to ${destinationAsset.code}`,
      );
    }

    const ranked = this.rankPaths(paths);
    const result = ranked.slice(0, maxPaths);

    const elapsedMs = Date.now() - startTime;
    if (elapsedMs > 300) {
      this.logger.warn(
        `findOptimalPaths exceeded 300 ms budget (${elapsedMs} ms)`,
      );
    }

    this.logger.log(
      `Path routing completed in ${elapsedMs} ms — ${result.length} paths ranked`,
    );

    return result;
  }

  /**
   * Apply slippage protection before executing a path payment.
   *
   * Compares `quotedRate` (from an earlier `findOptimalPaths` call) against
   * `actualRate` (re-fetched at execution time). If the price has moved more
   * than `maxSlippagePct`, the execution is blocked.
   *
   * @returns SlippageGuardResult — check `.safe` before submitting.
   */
  checkSlippage(
    quotedRate: number,
    actualRate: number,
    maxSlippagePct: number = DEFAULT_MAX_SLIPPAGE_PCT,
  ): SlippageGuardResult {
    const minRate = quotedRate * (1 - maxSlippagePct / 100);
    const slippagePct =
      quotedRate > 0 ? ((quotedRate - actualRate) / quotedRate) * 100 : 0;

    return {
      safe: actualRate >= minRate,
      actualRate,
      minRate,
      slippagePct,
    };
  }

  /**
   * Compute the minimum destination amount that must be received for a
   * strict-send path payment to satisfy the slippage constraint.
   *
   * This value is used as the `dest_min` parameter in Stellar's
   * `PathPaymentStrictSend` operation — if the DEX cannot fill at least
   * `destMin`, the transaction fails atomically.
   */
  computeDestMin(
    sourceAmount: number,
    quotedRate: number,
    maxSlippagePct: number = DEFAULT_MAX_SLIPPAGE_PCT,
  ): number {
    const quotedDestination = sourceAmount * quotedRate;
    return quotedDestination * (1 - maxSlippagePct / 100);
  }

  /**
   * Estimate the total ledger fee for a path payment.
   *
   * A `PathPaymentStrictSend` counts as one operation, but each additional
   * hop may increase the effective fee. We apply a 50-stroop surcharge per
   * intermediate hop.
   */
  estimateFeeStroops(pathLength: number): number {
    return BASE_FEE_STROOPS + pathLength * 50;
  }

  /**
   * Re-fetch the current rate for a path at execution time.
   * Used immediately before submitting a path payment to detect slippage.
   */
  async fetchCurrentRate(
    sourceAsset: StellarAsset,
    destinationAsset: StellarAsset,
    sourceAmount: string,
  ): Promise<number> {
    const paths = await this.queryHorizonPaths(
      sourceAsset,
      destinationAsset,
      sourceAmount,
    );

    if (paths.length === 0) {
      throw new BadRequestException(
        `No current rate found for ${sourceAsset.code} → ${destinationAsset.code}`,
      );
    }

    // Return the best available rate.
    let best = 0;
    for (const p of paths) {
      if (p.effectiveRate > best) {
        best = p.effectiveRate;
      }
    }
    return best;
  }

  /**
   * Query Horizon liquidity pools for the reserves of an asset pair.
   * Returns the constant-product AMM rate (reserveB / reserveA).
   */
  async fetchAmmReserves(
    assetA: StellarAsset,
    assetB: StellarAsset,
  ): Promise<LiquidityPoolReserves | null> {
    try {
      const horizonServer = this.getHorizonServer();
      const assetAObj = this.toStellarAsset(assetA);
      const assetBObj = this.toStellarAsset(assetB);

      // Use Horizon to query liquidity pools for this pair.
      const pools = await (horizonServer.liquidityPools() as any)
        .forAssets(assetAObj, assetBObj)
        .call();

      const records: any[] = pools?.records ?? [];
      if (records.length === 0) {
        return null;
      }

      // Pick the largest pool by reserve_a.
      const best = records.reduce(
        (acc: any, pool: any) => {
          const resA = parseFloat(pool.reserves?.[0]?.amount ?? '0');
          return resA > acc.resA ? { pool, resA } : acc;
        },
        { pool: null, resA: -Infinity },
      );

      if (!best.pool) {
        return null;
      }

      const reserveA = parseFloat(best.pool.reserves?.[0]?.amount ?? '0');
      const reserveB = parseFloat(best.pool.reserves?.[1]?.amount ?? '0');

      return {
        reserveA,
        reserveB,
        fee: best.pool.fee_bp ? `${best.pool.fee_bp / 100}%` : '0.3%',
        poolId: best.pool.id ?? '',
      };
    } catch (error) {
      this.logger.debug(`Failed to fetch AMM reserves: ${error.message}`);
      return null;
    }
  }

  /**
   * Detect arbitrage opportunities between SDEX order books and Soroban AMM
   * pools for a given asset pair.
   *
   * Returns an ArbitrageOpportunity when the spread exceeds `minSpreadPct`,
   * or `null` when markets are efficient for this pair.
   */
  async detectArbitrage(
    assetA: StellarAsset,
    assetB: StellarAsset,
    probeAmount: string = '100',
    minSpreadPct: number = ARBITRAGE_MIN_SPREAD_PCT,
  ): Promise<ArbitrageOpportunity | null> {
    const [sdexPaths, ammReserves] = await Promise.all([
      this.queryHorizonPaths(assetA, assetB, probeAmount).catch(() => []),
      this.fetchAmmReserves(assetA, assetB).catch(() => null),
    ]);

    let sdexRate = 0;
    for (const p of sdexPaths) {
      if (p.effectiveRate > sdexRate) {
        sdexRate = p.effectiveRate;
      }
    }

    const ammRate =
      ammReserves && ammReserves.reserveA > 0
        ? ammReserves.reserveB / ammReserves.reserveA
        : 0;

    if (sdexRate <= 0 || ammRate <= 0) {
      return null;
    }

    const spreadPct =
      (Math.abs(sdexRate - ammRate) / Math.min(sdexRate, ammRate)) * 100;

    if (spreadPct < minSpreadPct) {
      return null;
    }

    const direction =
      sdexRate > ammRate
        ? ('BUY_ON_AMM_SELL_ON_SDEX' as const)
        : ('BUY_ON_SDEX_SELL_ON_AMM' as const);

    this.logger.log(
      `💹 Arbitrage opportunity: ${assetA.code}/${assetB.code} spread=${spreadPct.toFixed(2)}% direction=${direction}`,
    );

    return {
      assetPair: [assetA, assetB],
      sdexRate,
      ammRate,
      spreadPct,
      direction,
    };
  }

  /**
   * Execute a guarded path payment:
   * 1. Re-fetch the current rate.
   * 2. Apply slippage check.
   * 3. Return the execution parameters (the caller builds and submits the tx).
   *
   * @throws BadRequestException if slippage exceeds the threshold.
   */
  async prepareGuardedPathPayment(
    sourceAsset: StellarAsset,
    destinationAsset: StellarAsset,
    sourceAmount: string,
    quotedRate: number,
    maxSlippagePct: number = DEFAULT_MAX_SLIPPAGE_PCT,
  ): Promise<{
    path: PaymentPath;
    destMin: number;
    slippageCheck: SlippageGuardResult;
  }> {
    // Re-fetch paths to get the most current rate.
    const paths = await this.findOptimalPaths(
      sourceAsset,
      destinationAsset,
      sourceAmount,
    );

    if (paths.length === 0) {
      throw new BadRequestException(
        `No execution paths available for ${sourceAsset.code} → ${destinationAsset.code}`,
      );
    }

    const bestPath = paths[0];
    const actualRate = bestPath.effectiveRate;

    const slippageCheck = this.checkSlippage(
      quotedRate,
      actualRate,
      maxSlippagePct,
    );

    if (!slippageCheck.safe) {
      throw new BadRequestException(
        `Slippage exceeded: actual rate ${actualRate.toFixed(6)} is below minimum ${slippageCheck.minRate.toFixed(6)} ` +
          `(${slippageCheck.slippagePct.toFixed(2)}% vs ${maxSlippagePct}% limit). Transaction aborted.`,
      );
    }

    const destMin = this.computeDestMin(
      parseFloat(sourceAmount),
      quotedRate,
      maxSlippagePct,
    );

    return { path: bestPath, destMin, slippageCheck };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Query Horizon `/paths/strict-send` and map records to `PaymentPath`.
   */
  private async queryHorizonPaths(
    sourceAsset: StellarAsset,
    destinationAsset: StellarAsset,
    sourceAmount: string,
  ): Promise<PaymentPath[]> {
    try {
      const horizonServer = this.getHorizonServer();
      const srcAsset = this.toStellarAsset(sourceAsset);
      const dstAsset = this.toStellarAsset(destinationAsset);

      const response = await (horizonServer as any)
        .strictSendPaths(srcAsset, sourceAmount, [dstAsset])
        .call();

      const records: any[] = response?.records ?? [];

      return records
        .map((record) => this.mapHorizonRecord(record))
        .filter((p): p is PaymentPath => p !== null);
    } catch (error) {
      this.logger.error(`Horizon path query failed: ${error.message}`);
      throw new BadRequestException(
        `Failed to query Horizon for payment paths: ${error.message}`,
      );
    }
  }

  /**
   * Map a raw Horizon path record to a `PaymentPath` with cost scoring.
   */
  private mapHorizonRecord(record: any): PaymentPath | null {
    const srcAmount = parseFloat(record.source_amount);
    const dstAmount = parseFloat(record.destination_amount);

    if (isNaN(srcAmount) || srcAmount <= 0 || isNaN(dstAmount)) {
      return null;
    }

    const effectiveRate = dstAmount / srcAmount;
    const pathAssets: StellarAsset[] = (record.path ?? []).map(
      (hop: any) => this.mapHorizonAsset(hop),
    );

    const feeStroops = this.estimateFeeStroops(pathAssets.length);
    const feeXlm = feeStroops * 1e-7;
    const hopPenalty = pathAssets.length * 0.001;

    // Cost model: lower is better.
    // Penalise by inverse rate, number of hops, and normalised fee.
    const costScore =
      1 / Math.max(effectiveRate, 1e-12) +
      hopPenalty +
      feeXlm / Math.max(srcAmount, 1e-12);

    const sourceAsset = this.mapHorizonAsset({
      asset_type: record.source_asset_type,
      asset_code: record.source_asset_code,
      asset_issuer: record.source_asset_issuer,
    });

    const destinationAsset = this.mapHorizonAsset({
      asset_type: record.destination_asset_type,
      asset_code: record.destination_asset_code,
      asset_issuer: record.destination_asset_issuer,
    });

    return {
      sourceAsset,
      destinationAsset,
      path: pathAssets,
      sourceAmount: record.source_amount,
      destinationAmount: record.destination_amount,
      effectiveRate,
      estimatedFeeStroops: feeStroops,
      costScore,
    };
  }

  /**
   * Map a raw Horizon asset object to a `StellarAsset`.
   */
  private mapHorizonAsset(hop: any): StellarAsset {
    if (hop.asset_type === 'native') {
      return { code: 'XLM', issuer: '' };
    }
    return {
      code: hop.asset_code ?? '',
      issuer: hop.asset_issuer ?? '',
    };
  }

  /**
   * Rank paths using a Bellman-Ford–inspired graph traversal:
   * - Build an implicit directed graph where edges are weighted by -ln(rate).
   * - Shortest path = lowest cost = best effective rate.
   * - Sort by cost score (ascending).
   */
  private rankPaths(paths: PaymentPath[]): PaymentPath[] {
    if (paths.length <= 1) {
      return paths;
    }

    // Build a Bellman-Ford weight for each path: -ln(rate) + hop_penalty.
    // Lower weight = better path (highest rate, fewest hops).
    const annotated = paths.map((p) => {
      const rateWeight = -Math.log(Math.max(p.effectiveRate, 1e-12));
      const hopPenalty = p.path.length * 0.001;
      // Factor in fee cost normalised to source amount.
      const feeXlm = p.estimatedFeeStroops * 1e-7;
      const feeWeight = feeXlm / Math.max(parseFloat(p.sourceAmount), 1e-12);
      const bfWeight = rateWeight + hopPenalty + feeWeight;
      return { path: p, bfWeight };
    });

    // Sort: lowest Bellman-Ford weight first (= best rate path first).
    annotated.sort((a, b) => a.bfWeight - b.bfWeight);

    return annotated.map((a) => a.path);
  }

  /**
   * Convert a `StellarAsset` DTO to a stellar-sdk `Asset` instance.
   */
  private toStellarAsset(asset: StellarAsset): Asset {
    if (asset.code === 'XLM' && !asset.issuer) {
      return Asset.native();
    }
    return new Asset(asset.code, asset.issuer);
  }

  /**
   * Get a Horizon server via the RpcClientService (if available) or directly.
   */
  private getHorizonServer(): Horizon.Server {
    return new Horizon.Server(this.horizonUrl, { allowHttp: true });
  }
}
