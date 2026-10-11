export type SupportedFiatCurrency = 'USD' | 'USDC' | 'NGN';
export type SupportedOnchainCurrency = 'XLM';

export type FxRatePair =
  | 'XLM-USD'
  | 'USD-NGN'
  | 'NGN-USD'
  | 'USDC-NGN'
  | 'XLM-NGN'
  | 'XLM-USDC'
  | 'USD-USDC'
  | 'NGN-USDC';

/** Shape of the payload stored in Redis under `fx:<from>:<to>`. */
export interface FxRateCachePayload {
  rate: number;
  from: string;
  to: string;
  /** Epoch ms of the last successful anchor fetch that produced/confirmed this rate. */
  fetchedAt: number;
  /**
   * Number of independent anchor sources that contributed to the stored rate.
   * Absent on payloads written before multi-anchor aggregation (#198).
   */
  sourceCount?: number;
  /** Sources excluded as outliers (> threshold from the median) on the last fetch. */
  rejectedSources?: string[];
}

/** Response shape returned by AnchorService.getFxRate. */
export interface FxRateResult {
  rate: number | null;
  from: string;
  to: string;
  /** ISO8601 instant at which the rate stops being fresh (fetchedAt + FX_MAX_CACHE_AGE_SECONDS). */
  rate_expires_at: string | null;
  /** True when the served rate is older than FX_MAX_CACHE_AGE_SECONDS. */
  stale: boolean;
  /** True when the rate was served while the anchor circuit breaker is open. */
  circuitOpen: boolean;
  /**
   * Number of anchor sources that contributed to this rate (#198). 0 when no
   * source produced a usable rate.
   */
  sourceCount: number;
  /**
   * Anchor sources rejected as outliers (> FX_ANCHOR_OUTLIER_THRESHOLD from the
   * median) during the fetch that produced this rate (#198).
   */
  rejectedSources: string[];
}

/**
 * Per-currency-pair circuit breaker state. Held in process memory: each API
 * replica tracks its own failure counts, so with N replicas the anchor may
 * receive up to N probe requests per reset window.
 */
export interface CircuitBreakerState {
  consecutiveFailures: number;
  /** Epoch ms when the circuit opened; null while closed. */
  openedAt: number | null;
}

/** One anchor source's response for a corridor, before aggregation (#198). */
export interface AnchorRateSample {
  source: string;
  rate: number;
}
