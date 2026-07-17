class MockRedis {
  private static store = new Map<string, { count: number; expiresAt: number }>();
  
  constructor(url: string, options: any) {}

  disconnect() {}

  async eval(script: string, numKeys: number, key: string, limit: any, windowMs: any, nowMs: any) {
    const limitVal = Number(limit);
    const windowMsVal = Number(windowMs);
    const nowMsVal = Number(nowMs);

    const bucketReset = (Math.floor(nowMsVal / windowMsVal) + 1) * windowMsVal;

    let entry = MockRedis.store.get(key);
    if (!entry || entry.expiresAt <= nowMsVal) {
      entry = { count: 0, expiresAt: bucketReset };
    }

    entry.count += 1;
    MockRedis.store.set(key, entry);

    const remaining = Math.max(0, limitVal - entry.count);
    return [String(entry.count), String(remaining), String(bucketReset)];
  }

  async del(keys: string | string[]) {
    const keysArr = Array.isArray(keys) ? keys : [keys];
    for (const k of keysArr) {
      MockRedis.store.delete(k);
    }
  }

  async keys(pattern: string) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(MockRedis.store.keys()).filter(k => regex.test(k));
  }
}

(globalThis as any).Ioredis = MockRedis;

import { ExecutionContext, HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RedisRateLimiter } from "./redis-rate-limiter";
import { RateLimitGuardRedis } from "./rate-limit.guard.redis";
import { RateLimitOptions } from "./rate-limit.decorator";

function contextFor(request: any, response: any): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function guardFor(
  options: RateLimitOptions | undefined,
  redisLimiter: RedisRateLimiter,
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(options),
  } as unknown as Reflector;

  return new RateLimitGuardRedis(reflector, redisLimiter);
}

function responseMock() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader: jest.fn((key: string, value: string) => {
      headers.set(key, value);
    }),
  };
}

describe("RateLimitGuardRedis", () => {
  const originalEnv = process.env;

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const limiter = new RedisRateLimiter(redisUrl, "rate-limit-test");

  // Extra limiters created inside individual tests that must be cleaned up.
  const extraLimiters: RedisRateLimiter[] = [];

  const keyPrefix = "auth:login";

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    // Clean per-test keys for stability.
    await limiter.resetAllForPrefix("auth:login");
  });

  afterAll(async () => {
    await limiter.close();
    // Close any limiters created inside individual tests to release TCP handles.
    await Promise.all(extraLimiters.map((l) => l.close()));
  });

  it("allows routes without rate limit metadata", () => {
    const guard = guardFor(undefined, limiter);
    const res = responseMock();
    const ctx = contextFor({ ip: "127.0.0.1", headers: {} }, res);

    expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("blocks requests after the configured limit and returns readable 429 payload with headers", async () => {
    const options: RateLimitOptions = {
      keyPrefix,
      limit: 2,
      windowMs: 60_000,
    };

    // Simulate two instances (two pods) by using two separate guard objects.
    // The limiters are closed in afterAll to avoid open TCP handles.
    const limiterA = new RedisRateLimiter(redisUrl, "rate-limit-test");
    const limiterB = new RedisRateLimiter(redisUrl, "rate-limit-test");
    extraLimiters.push(limiterA, limiterB);

    const instanceA = guardFor(options, limiterA);
    const instanceB = guardFor(options, limiterB);

    const request = { ip: "203.0.113.10", headers: {} };

    const res1 = responseMock();
    const res2 = responseMock();
    const res3 = responseMock();

    await expect(
      instanceA.canActivate(contextFor(request, res1)),
    ).resolves.toBe(true);
    await expect(
      instanceB.canActivate(contextFor(request, res2)),
    ).resolves.toBe(true);

    await expect(
      instanceA.canActivate(contextFor(request, res3)),
    ).rejects.toBeInstanceOf(HttpException);

    // Inspect last response headers (set before throw)
    expect(res3.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res3.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res3.headers.get("X-RateLimit-Reset")).toBeDefined();
    expect(res3.headers.get("Retry-After")).toBeDefined();
  });
});
