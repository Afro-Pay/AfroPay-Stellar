import { Injectable } from '@nestjs/common';

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
  simulate(scenario: TransferSimulationScenario): TransferSimulationResult {
    const amount = Number(scenario.sourceAmount);
    const rates = { ...DEFAULT_RATES, ...(scenario.rates ?? {}) };
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

    const path = this.resolvePath(scenario.sourceAsset, scenario.destinationAsset, rates);
    if (!path) {
      issues.push({
        code: 'NO_PATH',
        message: `No simulated path exists from ${scenario.sourceAsset} to ${scenario.destinationAsset}.`,
      });
    }

    if (issues.length > 0 || !path) {
      return {
        status: 'blocked',
        path: path ?? [scenario.sourceAsset, scenario.destinationAsset],
        sourceAmount: scenario.sourceAmount,
        estimatedDestinationAmount: null,
        minimumDestinationAmount: null,
        effectiveRate: null,
        issues,
      };
    }

    const effectiveRate = this.effectiveRate(path, rates);
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
    };
  }

  simulateBatch(scenarios: TransferSimulationScenario[]): TransferSimulationResult[] {
    return scenarios.map((scenario) => this.simulate(scenario));
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
