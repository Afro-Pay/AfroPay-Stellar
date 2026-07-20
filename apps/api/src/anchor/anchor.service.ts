import { HttpStatus, Injectable } from '@nestjs/common';
import axios from 'axios';
import Redis from 'ioredis';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ClassConstructor } from 'class-transformer';
import { AnchorReconciliationException } from './anchor.exceptions';
import { DepositResponseDto } from './dto/deposit-response.dto';
import { WithdrawResponseDto } from './dto/withdraw-response.dto';
import {
  CircuitBreakerState,
  FxRateCachePayload,
  FxRateResult,
} from './fx-rate.types';

const ANCHORS: Record<string, string> = {
  USDC: process.env.ANCHOR_USDC_URL ?? 'https://testanchor.stellar.org',
  NGN: process.env.ANCHOR_NGN_URL ?? 'https://testanchor.stellar.org',
};

const DELTA_THRESHOLD = 0.005; // 0.5%

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

    let external: { rate: number | null } | null = null;
    try {
      external = await this.fetchExternalRate(normFrom, normTo);
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
      return { rate: null, from, to, rate_expires_at: null, stale: false, circuitOpen };
    }
    const expiresAtMs = (cached.fetchedAt ?? 0) + this.maxCacheAgeSeconds * 1000;
    return {
      rate: cached.rate,
      from,
      to,
      rate_expires_at: new Date(expiresAtMs).toISOString(),
      stale: Date.now() > expiresAtMs,
      circuitOpen,
    };
  }
}
