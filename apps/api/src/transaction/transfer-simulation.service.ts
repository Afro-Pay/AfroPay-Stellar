import { Injectable } from '@nestjs/common';
import { AnchorService } from '../anchor/anchor.service';

export type SimulatedAssetCode = 'XLM' | 'USDC' | 'NGN';
export type SimulationStatus = 'ok' | 'blocked';

export interface TransferSimulationScenario {
  sourceAsset: SimulatedAssetCode;
  destinationAsset: SimulatedAssetCode;
  sourceAmount: string;
  destinationTrustlines: SimulatedAssetCode[];
  rates?: Record<string, number>;
  maxSlippageBps?: number;
}

export interface TransferSimulationIssue {
  code: string;
  message: string;
}

export interface TransferSimulationResult {
  status: SimulationStatus;
  path: SimulatedAssetCode[];
  sourceAmount: string;
  estimatedDestinationAmount: string | null;
  minimumDestinationAmount: string | null;
  effectiveRate: number | null;
  issues: TransferSimulationIssue[];
  rateExpiresAt: string | null;
  rateFresh: boolean;
}

const DEFAULT_RATES: Record<string, number> = {
  'XLM:USDC': 0.11,
  'USDC:XLM': 9.090909,
  'USDC:NGN': 1550,
  'NGN:USDC': 0.00064516,
};

function rateKey(from: SimulatedAssetCode, to: SimulatedAssetCode): string {
  return `${from}:${to}`;
}

function decimalString(value: number): string {
  return value.toFixed(7).replace(/\.?0+$/, '');
}

@Injectable()
export class TransferSimulationService {
  constructor(private readonly anchorService: AnchorService) {}

  async simulate(scenario: TransferSimulationScenario): Promise<TransferSimulationResult> {
    const amount = Number(scenario.sourceAmount);
    const staticRates = { ...DEFAULT_RATES, ...(scenario.rates ?? {}) };
    const issues: TransferSimulationIssue[] = [];

    if (!Number.isFinite(amount) || amount <= 0) {
      issues.push({
        code: 'INVALID_AMOUNT',
        message: 'Source amount must be a positive number.',
      });
    }

    if (scenario.destinationAsset !== 'XLM' && !scenario.destinationTrustlines.includes(scenario.destinationAsset)) {
      issues.push({
        code: 'MISSING_DESTINATION_TRUSTLINE',
        message: `Destination account must trust ${scenario.destinationAsset} before receiving it.`,
      });
    }

    const path = this.resolvePath(scenario.sourceAsset, scenario.destinationAsset, staticRates);
    if (!path) {
      issues.push({
        code: 'NO_PATH',
        message: `No simulated path exists from ${scenario.sourceAsset} to ${scenario.destinationAsset}.`,
      });
    }

    let rateFresh = true;
    const expiresAts: (string | null)[] = [];
    const resolvedRates: Record<string, number> = {};

    if (path) {
      for (let i = 0; i < path.length - 1; i++) {
        const from = path[i];
        const to = path[i + 1];
        const key = rateKey(from, to);
        const staticDefaultRate = DEFAULT_RATES[key];
        const fallbackRate = staticRates[key];

        let fetchedRate: number | null = null;
        let rateExpiresAtStr: string | null = null;

        try {
          const result = await this.anchorService.getFxRate(from, to);
          if (result && typeof result.rate === 'number') {
            fetchedRate = result.rate;
            rateExpiresAtStr = result.rate_expires_at ?? null;
          }
        } catch (e) {
          // ignore, fall back
        }

        if (fetchedRate !== null) {
          resolvedRates[key] = fetchedRate;
          expiresAts.push(rateExpiresAtStr);

          if (staticDefaultRate !== undefined) {
            const divergence = Math.abs(fetchedRate - staticDefaultRate) / staticDefaultRate;
            if (divergence > 0.05) {
              issues.push({
                code: 'STALE_RATE',
                message: `Live rate for ${from}:${to} deviates from the static default by more than 5%.`,
              });
            }
          }
        } else {
          resolvedRates[key] = fallbackRate;
          rateFresh = false;
          expiresAts.push(null);
        }
      }
    }

    let rateExpiresAt: string | null = null;
    if (rateFresh && expiresAts.length > 0) {
      let minExpiresAt: Date | null = null;
      let hasNullExpiry = false;
      for (const exp of expiresAts) {
        if (exp === null) {
          hasNullExpiry = true;
        } else {
          const date = new Date(exp);
          if (!minExpiresAt || date < minExpiresAt) {
            minExpiresAt = date;
          }
        }
      }
      rateExpiresAt = (hasNullExpiry || !minExpiresAt) ? null : minExpiresAt.toISOString();
    } else {
      rateExpiresAt = null;
    }

    const hasBlockingIssues = issues.some((issue) =>
      ['INVALID_AMOUNT', 'MISSING_DESTINATION_TRUSTLINE', 'NO_PATH'].includes(issue.code),
    );

    if (hasBlockingIssues || !path) {
      return {
        status: 'blocked',
        path: path ?? [scenario.sourceAsset, scenario.destinationAsset],
        sourceAmount: scenario.sourceAmount,
        estimatedDestinationAmount: null,
        minimumDestinationAmount: null,
        effectiveRate: null,
        issues,
        rateExpiresAt,
        rateFresh,
      };
    }

    const effectiveRate = this.effectiveRate(path, resolvedRates);
    const estimatedDestinationAmount = amount * effectiveRate;
    const slippageBps = scenario.maxSlippageBps ?? 50;
    const minimumDestinationAmount = estimatedDestinationAmount * (1 - slippageBps / 10_000);

    return {
      status: 'ok',
      path,
      sourceAmount: scenario.sourceAmount,
      estimatedDestinationAmount: decimalString(estimatedDestinationAmount),
      minimumDestinationAmount: decimalString(minimumDestinationAmount),
      effectiveRate,
      issues,
      rateExpiresAt,
      rateFresh,
    };
  }

  async simulateBatch(scenarios: TransferSimulationScenario[]): Promise<TransferSimulationResult[]> {
    return Promise.all(scenarios.map((scenario) => this.simulate(scenario)));
  }

  private resolvePath(
    sourceAsset: SimulatedAssetCode,
    destinationAsset: SimulatedAssetCode,
    rates: Record<string, number>,
  ): SimulatedAssetCode[] | null {
    if (sourceAsset === destinationAsset) {
      return [sourceAsset];
    }

    if (rates[rateKey(sourceAsset, destinationAsset)]) {
      return [sourceAsset, destinationAsset];
    }

    const viaUsdc: SimulatedAssetCode[] = [sourceAsset, 'USDC', destinationAsset];
    if (
      sourceAsset !== 'USDC' &&
      destinationAsset !== 'USDC' &&
      rates[rateKey(sourceAsset, 'USDC')] &&
      rates[rateKey('USDC', destinationAsset)]
    ) {
      return viaUsdc;
    }

    return null;
  }

  private effectiveRate(path: SimulatedAssetCode[], rates: Record<string, number>): number {
    return path.slice(1).reduce((rate, asset, index) => {
      return rate * (rates[rateKey(path[index], asset)] ?? 1);
    }, 1);
  }
}
