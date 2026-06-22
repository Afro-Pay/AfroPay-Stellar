import { Injectable } from '@nestjs/common';
import axios from 'axios';
import Redis from 'ioredis';

const ANCHORS: Record<string, string> = {
  USDC: process.env.ANCHOR_USDC_URL ?? 'https://testanchor.stellar.org',
  NGN: process.env.ANCHOR_NGN_URL ?? 'https://testanchor.stellar.org',
};

const CACHE_TTL_SECONDS = 30; // cap TTL at 30 seconds
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
    return data;
  }

  async getWithdrawInfo(asset: string, account: string, amount: string) {
    const anchorUrl = ANCHORS[asset];
    const { data } = await axios.get(`${anchorUrl}/sep6/withdraw`, {
      params: { asset_code: asset, account, amount },
    });
    return data;
  }

  // Separated method so tests can mock provider behaviour
  async fetchExternalRate(from: string, to: string) {
    // Stub: replace with real FX provider
    const rates: Record<string, number> = { 'USD-NGN': 1550, 'NGN-USD': 0.00065, 'XLM-USD': 0.11 };
    return { rate: rates[`${from}-${to}`] ?? null, from, to };
  }

  async getFxRate(from: string, to: string) {
    const key = `fx:${from}:${to}`;

    // Try to read cached value
    let cachedRaw = await this.redis.get(key);
    let cached: { rate: number | null; from: string; to: string; fetchedAt?: number } | null = null;
    if (cachedRaw) {
      try { cached = JSON.parse(cachedRaw); } catch (e) { cached = null; }
    }

    // Fetch latest from provider to decide whether to bust cache
    const external = await this.fetchExternalRate(from, to);

    // If neither external nor cached exist, return null
    if (!external.rate && !cached) {
      return { rate: null, from, to, rate_expires_at: null };
    }

    // If no cached value, store external and return
    if (!cached) {
      if (external.rate != null) {
        const payload = { rate: external.rate, from, to, fetchedAt: Date.now() };
        await this.redis.set(key, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
        const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString();
        return { ...payload, rate_expires_at: expiresAt };
      }
      // external null but cached handled earlier, so shouldn't reach here
      return { rate: null, from, to, rate_expires_at: null };
    }

    // If we have both cached and an external rate, compare delta
    if (external.rate != null && cached.rate != null) {
      const delta = Math.abs(external.rate - cached.rate) / external.rate;
      if (delta > DELTA_THRESHOLD) {
        // Significant change: update cache immediately with external
        const payload = { rate: external.rate, from, to, fetchedAt: Date.now() };
        await this.redis.set(key, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
        const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString();
        return { ...payload, rate_expires_at: expiresAt };
      }
    }

    // Otherwise return cached value and compute expiry from TTL
    const ttlSecs = await this.redis.ttl ? await this.redis.ttl(key) : CACHE_TTL_SECONDS;
    let expiresAt: string | null = null;
    if (ttlSecs > 0) {
      expiresAt = new Date(Date.now() + ttlSecs * 1000).toISOString();
    }

    return { rate: cached.rate, from, to, rate_expires_at: expiresAt };
  }
}
