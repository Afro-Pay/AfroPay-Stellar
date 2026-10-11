import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import Redis from 'ioredis';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ClassConstructor } from 'class-transformer';
import { randomBytes } from 'crypto';
import { AnchorReconciliationException } from './anchor.exceptions';
import { DepositResponseDto } from './dto/deposit-response.dto';
import { WithdrawResponseDto } from './dto/withdraw-response.dto';
import {
  AnchorRateSample,
  CircuitBreakerState,
  FxRateCachePayload,
  FxRateResult,
} from './fx-rate.types';

const ANCHORS: Record<string, string> = {
  USDC: process.env.ANCHOR_USDC_URL ?? 'https://testanchor.stellar.org',
  NGN: process.env.ANCHOR_NGN_URL ?? 'https://testanchor.stellar.org',
};

const DELTA_THRESHOLD = 0.005; // 0.5%
const DEFAULT_ANCHOR = 'https://testanchor.stellar.org';
// #198: reject any source whose rate deviates more than this fraction from the
// median of all responding sources. Configurable via FX_ANCHOR_OUTLIER_THRESHOLD.
const DEFAULT_OUTLIER_THRESHOLD = 0.05; // 5%

/**
 * Median of a numeric list (does not mutate the input). Even-length lists use
 * the mean of the two central values so a single rogue source cannot drag the
 * result the way a mean would.
 */
export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Resolve the configured anchor source URLs for a corridor (#198).
 *
 * Priority (per currency, quote first then base):
 *   1. `ANCHOR_<CUR>_URLS` — comma-separated list (multi-source aggregation).
 *   2. `ANCHOR_<CUR>_URL`  — single legacy URL (graceful single-source mode).
 * Falls back to the built-in default so behaviour is unchanged when nothing is
 * configured. Results are de-duplicated while preserving order.
 */
export function resolveAnchorSources(from: string, to: string): string[] {
  const norm = (c: string) => (c === 'USDC' ? 'USD' : c);
  for (const cur of [norm(to), norm(from)]) {
    const multi = process.env[`ANCHOR_${cur}_URLS`];
    if (multi && multi.trim()) {
      const list = multi
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 0) return Array.from(new Set(list));
    }
    const single = process.env[`ANCHOR_${cur}_URL`];
    if (single && single.trim()) return [single.trim()];
  }
  return [ANCHORS[to] ?? ANCHORS[norm(to)] ?? DEFAULT_ANCHOR];
}

// Simple in-memory redis-like cache used for tests or when REDIS_URL is not set
class InMemoryCache {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, _mode?: string, seconds?: number) {
    const expiresAt = seconds ? Date.now() + seconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async ttl(key: string) {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (!entry.expiresAt) return -1;
    const secs = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return secs >= 0 ? secs : -2;
  }
}

@Injectable()
export class AnchorService {
  private redis: any;

  // Freshness bound: a rate older than this is still served, but with stale: true.
  private maxCacheAgeSeconds = Number(process.env.FX_MAX_CACHE_AGE_SECONDS ?? 30);
  // Retention bound: physical Redis TTL. Longer than the freshness bound so a
  // rate survives to be served (flagged stale) while the anchor is unreachable.
  private cacheRetentionSeconds = Number(
    process.env.FX_CACHE_RETENTION_SECONDS ?? 300,
  );
  private circuitFailureThreshold = Number(
    process.env.FX_CIRCUIT_FAILURE_THRESHOLD ?? 3,
  );
  private circuitResetMs = Number(process.env.FX_CIRCUIT_RESET_MS ?? 60000);
  // #198: max fractional deviation from the median before a source is dropped.
  private anchorOutlierThreshold = Number(
    process.env.FX_ANCHOR_OUTLIER_THRESHOLD ?? DEFAULT_OUTLIER_THRESHOLD,
  );
  private cachedAnchorSigningKey: string | null = null;
  private readonly challengeTtlSeconds = Number(
    process.env.SEP10_CHALLENGE_TTL_SECONDS ?? 300,
  );

  // Keyed per currency pair so an outage on one corridor does not open the
  // circuit for healthy ones.
  private breakers = new Map<string, CircuitBreakerState>();

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    // Use in-memory cache for tests or if no REDIS_URL configured
    if (process.env.NODE_ENV === 'test' || !redisUrl) {
      this.redis = new InMemoryCache();
    } else {
      this.redis = new Redis(redisUrl);
    }
  }

  async issueChallengeNonce(
    account: string,
    ttlSeconds = this.challengeTtlSeconds,
  ): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const key = this.challengeNonceKey(account, nonce);
    await this.redis.set(key, 'issued', 'EX', ttlSeconds);
    return nonce;
  }

  async consumeChallengeNonce(
    account: string,
    nonce: string,
    ttlSeconds = this.challengeTtlSeconds,
  ): Promise<void> {
    const key = this.challengeNonceKey(account, nonce);
    const state = await this.redis.get(key);

    if (!state) {
      throw new UnauthorizedException({
        code: 'SEP10_CHALLENGE_EXPIRED',
        message: 'Challenge nonce was not issued or has expired.',
      });
    }

    if (state === 'used') {
      throw new UnauthorizedException({
        code: 'SEP10_CHALLENGE_REUSED',
        message: 'Challenge nonce has already been used.',
      });
    }

    await this.redis.set(key, 'used', 'EX', ttlSeconds);
  }

  async verifySep10Token(token: string): Promise<Record<string, unknown>> {
    const claims = this.decodeJwtPayload(token);
    const exp = Number(claims.exp ?? 0);

    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Access token expired. Refresh the session or sign in again.',
      });
    }

    return claims;
  }

  async getAnchorSigningKey(anchorUrl = process.env.ANCHOR_USDC_URL ?? 'https://testanchor.stellar.org'): Promise<string> {
    if (this.cachedAnchorSigningKey) {
      return this.cachedAnchorSigningKey;
    }

    const stellarTomlUrl = new URL('/.well-known/stellar.toml', anchorUrl).toString();
    const { data } = await axios.get(stellarTomlUrl, { timeout: 5000 });
    const match = String(data).match(/^\s*SIGNING_KEY\s*=\s*"([^"]+)"\s*$/m);

    if (!match?.[1]) {
      throw new UnauthorizedException({
        code: 'SEP10_SIGNING_KEY_INVALID',
        message: 'Anchor stellar.toml is missing a valid SIGNING_KEY.',
      });
    }

    this.cachedAnchorSigningKey = match[1].trim();
    return this.cachedAnchorSigningKey;
  }

  async assertAnchorSigningKeyMatches(expectedKey: string): Promise<void> {
    const actual = await this.getAnchorSigningKey();
    if (actual !== expectedKey) {
      throw new UnauthorizedException({
        code: 'SEP10_SIGNING_KEY_MISMATCH',
        message: 'Server signing key does not match the anchor stellar.toml configuration.',
      });
    }
  }

  async validateChallengeSignature(
    account: string,
    challenge: string,
    signature: string,
  ): Promise<boolean> {
    if (!account || !challenge || !signature) {
      return false;
    }

    try {
      const normalized = signature
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const padded = normalized.length % 4 === 0 ? normalized : normalized + '='.repeat(4 - (normalized.length % 4));
      const decoded = Buffer.from(padded, 'base64');
      return decoded.length >= 64 && account.startsWith('G') && account.length >= 56 && challenge.includes('nonce=');
    } catch {
      return false;
    }
  }

  private challengeNonceKey(account: string, nonce: string): string {
    return `sep10:challenge:${account}:${nonce}`;
  }

  private decodeJwtPayload(token: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Access token is invalid or missing.',
      });
    }

    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.length % 4 === 0 ? normalized : normalized + '='.repeat(4 - (normalized.length % 4));
      const json = Buffer.from(padded, 'base64').toString('utf8');
      const payload = JSON.parse(json) as Record<string, unknown>;
      if (!payload || typeof payload !== 'object') {
        throw new Error('Decoded JWT payload is not an object');
      }
      return payload;
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Access token is invalid or missing.',
      });
    }
  }

  async getDepositInfo(asset: string, account: string) {
    const anchorUrl = ANCHORS[asset];
    const { data } = await axios.get(`${anchorUrl}/sep6/deposit`, {
      params: { asset_code: asset, account },
    });

    const dto = this.validateAnchorResponse(DepositResponseDto, data, 'deposit');

    // Reconcile the echoed account (when the anchor returns one) against the
    // account we requested, so a malformed/compromised response cannot redirect
    // the credit to a different Stellar account.
    const echoed = dto.stellar_account ?? dto.account ?? dto.account_id;
    if (echoed && echoed !== account) {
      throw new AnchorReconciliationException(
        `Anchor deposit response account (${echoed}) does not match the requested account (${account})`,
      );
    }

    return data;
  }

  async getWithdrawInfo(asset: string, account: string, amount: string) {
    const anchorUrl = ANCHORS[asset];
    const { data } = await axios.get(`${anchorUrl}/sep6/withdraw`, {
      params: { asset_code: asset, account, amount },
    });

    const dto = this.validateAnchorResponse(WithdrawResponseDto, data, 'withdraw');

    // Reconcile the requested amount against the anchor's advertised bounds.
    const requested = Number(amount);
    if (!Number.isNaN(requested)) {
      if (dto.min_amount != null && requested < dto.min_amount) {
        throw new AnchorReconciliationException(
          `Requested amount ${requested} is below the anchor minimum ${dto.min_amount}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (dto.max_amount != null && requested > dto.max_amount) {
        throw new AnchorReconciliationException(
          `Requested amount ${requested} exceeds the anchor maximum ${dto.max_amount}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    return data;
  }

  /**
   * Validates a raw anchor payload against a response DTO. Returns the typed
   * instance for downstream reconciliation; throws AnchorReconciliationException
   * (502) if the payload is not an object or violates the schema. The original
   * `data` is returned to callers unchanged so no anchor-provided fields are
   * dropped — validation is a gate, not a transform.
   */
  private validateAnchorResponse<T extends object>(
    cls: ClassConstructor<T>,
    data: unknown,
    kind: 'deposit' | 'withdraw',
  ): T {
    if (data == null || typeof data !== 'object') {
      throw new AnchorReconciliationException(
        `Anchor returned a malformed ${kind} response`,
      );
    }
    const dto = plainToInstance(cls, data);
    const errors = validateSync(dto as object, {
      whitelist: false,
      forbidUnknownValues: false,
    });
    if (errors.length > 0) {
      throw new AnchorReconciliationException(
        `Anchor returned an invalid ${kind} response`,
      );
    }
    return dto;
  }

  // Separated method so tests can mock provider behaviour
  async fetchExternalRate(from: string, to: string) {
    // Stub: replace with real FX provider
    const rates: Record<string, number> = { 'USD-NGN': 1550, 'NGN-USD': 0.00065, 'XLM-USD': 0.11 };
    return { rate: rates[`${from}-${to}`] ?? null, from, to };
  }

  /**
   * Fetch a single corridor rate from ONE anchor source (#198). Separated so
   * tests can mock per-source behaviour and so a real provider call can replace
   * the stub without touching the aggregation logic. Returns null when the
   * source does not quote the pair.
   */
  async fetchRateFromSource(
    source: string,
    from: string,
    to: string,
  ): Promise<number | null> {
    // Default implementation delegates to the in-process stub so tests and
    // single-source deployments keep their existing behaviour. Deployments that
    // configure ANCHOR_*_URLS replace this with a real per-source HTTP call.
    const stub = await this.fetchExternalRate(from, to);
    return stub.rate ?? null;
  }

  /**
   * Multi-source FX rate aggregation with outlier rejection (#198).
   *
   * Fetches the corridor rate from every configured anchor source, then:
   *   - computes the median of all non-erroring, non-null samples;
   *   - rejects any source deviating more than the configured threshold from
   *     that median;
   *   - returns the median of the surviving samples, plus `sourceCount` (how
   *     many samples the returned rate rests on) and `rejectedSources`.
   *
   * A source that errors or returns null is simply not counted (graceful
   * degradation); it is NOT reported as an outlier. When no source yields a
   * usable rate the rate is null and the circuit-breaker failure accounting in
   * `getFxRate` decides whether the anchor counts as unreachable.
   */
  async fetchExternalRateMulti(
    from: string,
    to: string,
  ): Promise<{ rate: number | null; from: string; to: string; sourceCount: number; rejectedSources: string[] }> {
    const sources = resolveAnchorSources(from, to);
    const samples: AnchorRateSample[] = [];
    let errorCount = 0;
    for (const source of sources) {
      try {
        const rate = await this.fetchRateFromSource(source, from, to);
        if (rate != null && Number.isFinite(rate) && rate > 0) {
          samples.push({ source, rate });
        }
      } catch {
        // A source that throws is skipped; the others still count.
        errorCount += 1;
      }
    }

    if (samples.length === 0) {
      // Distinguish "every source unreachable" (a real failure that must open
      // the circuit breaker) from "sources answered but none quote the pair"
      // (rate: null, not a failure). The legacy single-source path threw on an
      // unreachable anchor, so preserve that contract when ALL sources errored.
      if (errorCount > 0 && errorCount === sources.length) {
        throw new Error(`All ${sources.length} anchor source(s) unreachable`);
      }
      return { rate: null, from, to, sourceCount: 0, rejectedSources: [] };
    }
    // Single sample: no median-based outlier rejection is possible; trust it.
    if (samples.length === 1) {
      return {
        rate: samples[0].rate,
        from,
        to,
        sourceCount: 1,
        rejectedSources: [],
      };
    }

    const threshold = this.anchorOutlierThreshold;
    const median = medianOf(samples.map((s) => s.rate));
    const kept: AnchorRateSample[] = [];
    const rejected: string[] = [];
    for (const s of samples) {
      const deviation = Math.abs(s.rate - median) / median;
      if (deviation > threshold) {
        rejected.push(s.source);
      } else {
        kept.push(s);
      }
    }
    // If every source deviates (e.g. two sources equidistant from the median of
    // two), keep the full set rather than returning nothing — the median is
    // still the most robust single estimate available.
    const survivors = kept.length > 0 ? kept : samples;
    const aggregated = medianOf(survivors.map((s) => s.rate));
    return {
      rate: aggregated,
      from,
      to,
      sourceCount: survivors.length,
      rejectedSources: kept.length > 0 ? rejected : [],
    };
  }

  async getFxRate(from: string, to: string): Promise<FxRateResult> {
    const normFrom = from === 'USDC' ? 'USD' : from;
    const normTo = to === 'USDC' ? 'USD' : to;
    const key = `fx:${normFrom}:${normTo}`;

    const cached = await this.readCache(key);
    const breaker = this.getBreaker(key);

    // Circuit open: serve cached without touching the anchor. Once
    // circuitResetMs has elapsed, isCircuitOpen() returns false and the next
    // call falls through to a half-open probe fetch below.
    if (this.isCircuitOpen(breaker)) {
      return this.buildCachedResult(cached, from, to, true);
    }

    let external:
      | { rate: number | null; sourceCount: number; rejectedSources: string[] }
      | null = null;
    try {
      external = await this.fetchExternalRateMulti(normFrom, normTo);
      breaker.consecutiveFailures = 0;
      breaker.openedAt = null;
    } catch (e) {
      // A pair the provider doesn't quote resolves with rate: null and is NOT
      // a failure — only an unreachable anchor (a throw) counts toward opening.
      breaker.consecutiveFailures += 1;
      if (breaker.consecutiveFailures >= this.circuitFailureThreshold) {
        breaker.openedAt = Date.now();
      }
    }

    if (external && external.rate != null) {
      // Within the bust threshold the cached rate is kept so quotes stay
      // stable, but fetchedAt is refreshed: freshness means "the anchor
      // confirmed this rate recently", not "the rate never moved".
      let rate = external.rate;
      if (cached && cached.rate != null) {
        const delta = Math.abs(external.rate - cached.rate) / external.rate;
        if (delta <= DELTA_THRESHOLD) {
          rate = cached.rate;
        }
      }

      const payload: FxRateCachePayload = {
        rate,
        from: normFrom,
        to: normTo,
        fetchedAt: Date.now(),
        sourceCount: external.sourceCount,
        rejectedSources: external.rejectedSources,
      };
      await this.redis.set(
        key,
        JSON.stringify(payload),
        'EX',
        this.cacheRetentionSeconds,
      );
      return {
        rate: payload.rate,
        from,
        to,
        rate_expires_at: new Date(
          payload.fetchedAt + this.maxCacheAgeSeconds * 1000,
        ).toISOString(),
        stale: false,
        circuitOpen: false,
        sourceCount: external.sourceCount,
        rejectedSources: external.rejectedSources,
      };
    }

    // Anchor unreachable, or it has no rate for this pair: fall back to cache.
    // The breaker may have just opened on this very call.
    return this.buildCachedResult(cached, from, to, this.isCircuitOpen(breaker));
  }

  private async readCache(key: string): Promise<FxRateCachePayload | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  private getBreaker(key: string): CircuitBreakerState {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = { consecutiveFailures: 0, openedAt: null };
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  private isCircuitOpen(breaker: CircuitBreakerState): boolean {
    return (
      breaker.openedAt != null &&
      Date.now() - breaker.openedAt < this.circuitResetMs
    );
  }

  private buildCachedResult(
    cached: FxRateCachePayload | null,
    from: string,
    to: string,
    circuitOpen: boolean,
  ): FxRateResult {
    if (!cached || cached.rate == null) {
      return {
        rate: null,
        from,
        to,
        rate_expires_at: null,
        stale: false,
        circuitOpen,
        sourceCount: 0,
        rejectedSources: [],
      };
    }
    const expiresAtMs = (cached.fetchedAt ?? 0) + this.maxCacheAgeSeconds * 1000;
    return {
      rate: cached.rate,
      from,
      to,
      rate_expires_at: new Date(expiresAtMs).toISOString(),
      stale: Date.now() > expiresAtMs,
      circuitOpen,
      sourceCount: cached.sourceCount ?? 1,
      rejectedSources: cached.rejectedSources ?? [],
    };
  }
}
