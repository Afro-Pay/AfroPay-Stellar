// ioredis is a transitive dependency of `bull` in this repo.
// Import via require() to avoid TS resolution issues in some setups.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Redis: any = (globalThis as any).Ioredis ?? require("ioredis");

export interface RateLimitResult {
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms
}

/**
 * Redis-backed fixed-window rate limiter.
 *
 * Notes:
 * - Uses atomic Lua script to ensure correct behavior across replicas.
 * - We return a resetAt timestamp for header generation.
 */
export class RedisRateLimiter {
  private readonly redis: any;
  private readonly keyPrefix: string;

  // Single Lua script handles increment+expiry+remaining.
  private readonly script = `
    local key = KEYS[1]
    local limit = tonumber(ARGV[1])
    local windowMs = tonumber(ARGV[2])
    local nowMs = tonumber(ARGV[3])

    local bucketReset = (math.floor(nowMs / windowMs) + 1) * windowMs

    local current = redis.call('INCR', key)

    if current == 1 then
      local ttlMs = bucketReset - nowMs
      redis.call('PEXPIRE', key, ttlMs)
    end

    local remaining = limit - current
    if remaining < 0 then remaining = 0 end

    return { tostring(current), tostring(remaining), tostring(bucketReset) }
  `;

  constructor(redisUrl: string, keyPrefix = "rate-limit") {
    this.keyPrefix = keyPrefix;
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
  }

  async close(): Promise<void> {
    if (this.redis && typeof this.redis.quit === 'function') {
      await this.redis.quit().catch(() => undefined);
    }
  }

  private key(realKey: string): string {
    return `${this.keyPrefix}:${realKey}`;
  }

  async consume(
    realKey: string,
    limit: number,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitResult> {
    const result = (await this.redis.eval(
      this.script,
      1,
      this.key(realKey),
      limit,
      windowMs,
      nowMs,
    )) as unknown as [string, string, string];

    const count = Number.parseInt(result[0], 10);
    const resetAt = Number.parseInt(result[2], 10);
    const remaining = limit - count;

    return {
      limit,
      remaining: Number.isFinite(remaining) ? remaining : 0,
      resetAt: Number.isFinite(resetAt) ? resetAt : nowMs + windowMs,
    };
  }

  async resetKey(realKey: string): Promise<void> {
    await this.redis.del(this.key(realKey));
  }

  async resetAllForPrefix(prefix: string): Promise<void> {
    // Used only for tests.
    // CAUTION: KEYS is O(n). Never use in production.
    const pattern = `${this.keyPrefix}:${prefix}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length) {
      await this.redis.del(keys);
    }
  }
}
