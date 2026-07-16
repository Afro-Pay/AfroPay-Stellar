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
      // Set to 0 so disconnect() destroys the socket in the next tick rather
      // than after the default 2000 ms wait. This prevents Jest from detecting
      // an open Timeout handle when tests run without a live Redis instance.
      disconnectTimeout: 0,
    });
  }

  async close(): Promise<void> {
    // Use disconnect() rather than quit() to force-close the socket immediately.
    // quit() sends a QUIT command and awaits a reply, but when Redis is
    // unavailable (e.g. in unit-test environments) ioredis schedules a
    // reconnect Timeout before giving up — leaving an open handle that prevents
    // Jest from exiting cleanly.
    try {
      this.redis.disconnect();
    } catch {
      // Ignore errors during forced disconnect (e.g. already closed).
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const remaining = Number.parseInt(result[1], 10);
    const resetAt = Number.parseInt(result[2], 10);

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
