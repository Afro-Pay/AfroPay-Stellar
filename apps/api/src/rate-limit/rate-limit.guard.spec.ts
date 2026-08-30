class MockRedis {
  private static store = new Map<string, { count: number; expiresAt: number }>();

  disconnect() {}

  quit() { return Promise.resolve(); }

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
    const instanceA = guardFor(
      options,
      new RedisRateLimiter(redisUrl, "rate-limit-test"),
    );
    const instanceB = guardFor(
      options,
      new RedisRateLimiter(redisUrl, "rate-limit-test"),
    );

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

// Coverage for the Horizon-facing routes wrapped as part of #204: wallet
// balance fetches and anchor fx-rate refreshes are limited per authenticated
// user, and the unauthenticated SEP-10 anchor-auth endpoints are limited per
// source IP.
describe("RateLimitGuardRedis: Horizon-facing routes (issue #204)", () => {
  const originalEnv = process.env;
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    await Promise.all(
      ["wallet:balances", "anchor:fx-rate", "anchor:auth:challenge", "anchor:auth:token"].map(
        (prefix) => new RedisRateLimiter(redisUrl, "rate-limit-test").resetAllForPrefix(prefix),
      ),
    );
  });

  it("keys wallet balance and fx-rate limits per authenticated user, not per IP", async () => {
    const options: RateLimitOptions = {
      keyPrefix: "wallet:balances",
      limit: 1,
      windowMs: 60_000,
    };
    const guard = guardFor(options, new RedisRateLimiter(redisUrl, "rate-limit-test"));

    const userA = { ip: "203.0.113.20", headers: {}, user: { userId: "user-a" } };
    const userB = { ip: "203.0.113.20", headers: {}, user: { userId: "user-b" } };

    // Same IP, different authenticated users: each gets its own bucket.
    await expect(
      guard.canActivate(contextFor(userA, responseMock())),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor(userB, responseMock())),
    ).resolves.toBe(true);

    // A second request from user-a within the window is blocked.
    await expect(
      guard.canActivate(contextFor(userA, responseMock())),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("blocks fx-rate requests over the configured per-user limit with a 429 and Retry-After", async () => {
    const options: RateLimitOptions = {
      keyPrefix: "anchor:fx-rate",
      limit: 2,
      windowMs: 60_000,
    };
    const guard = guardFor(options, new RedisRateLimiter(redisUrl, "rate-limit-test"));
    const request = { ip: "203.0.113.21", headers: {}, user: { userId: "user-fx" } };

    await expect(guard.canActivate(contextFor(request, responseMock()))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(request, responseMock()))).resolves.toBe(true);

    const res = responseMock();
    await expect(guard.canActivate(contextFor(request, res))).rejects.toBeInstanceOf(HttpException);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res.headers.get("Retry-After")).toBeDefined();
  });

  it("keys unauthenticated anchor-auth challenge/token limits per source IP", async () => {
    const challengeOptions: RateLimitOptions = {
      keyPrefix: "anchor:auth:challenge",
      limit: 1,
      windowMs: 60_000,
    };
    const guard = guardFor(challengeOptions, new RedisRateLimiter(redisUrl, "rate-limit-test"));

    const requestFromIp = { headers: {}, ip: "198.51.100.5" };

    await expect(
      guard.canActivate(contextFor(requestFromIp, responseMock())),
    ).resolves.toBe(true);

    // Same IP again: blocked.
    await expect(
      guard.canActivate(contextFor(requestFromIp, responseMock())),
    ).rejects.toBeInstanceOf(HttpException);

    // A different IP is unaffected.
    const requestFromOtherIp = { headers: {}, ip: "198.51.100.6" };
    await expect(
      guard.canActivate(contextFor(requestFromOtherIp, responseMock())),
    ).resolves.toBe(true);
  });

  it("respects env-configured overrides for the anchor-auth limit/window", async () => {
    process.env.ANCHOR_AUTH_RATE_LIMIT_MAX = "1";
    process.env.ANCHOR_AUTH_RATE_LIMIT_WINDOW_MS = "60000";

    const options: RateLimitOptions = {
      keyPrefix: "anchor:auth:token",
      limit: 20,
      windowMs: 60_000,
      limitEnv: "ANCHOR_AUTH_RATE_LIMIT_MAX",
      windowMsEnv: "ANCHOR_AUTH_RATE_LIMIT_WINDOW_MS",
    };
    const guard = guardFor(options, new RedisRateLimiter(redisUrl, "rate-limit-test"));
    const request = { headers: {}, ip: "198.51.100.7" };

    await expect(
      guard.canActivate(contextFor(request, responseMock())),
    ).resolves.toBe(true);

    // The env override (limit=1) is honored over the decorator default (20).
    await expect(
      guard.canActivate(contextFor(request, responseMock())),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
