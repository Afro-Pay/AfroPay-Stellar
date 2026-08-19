class MockRedis {
  private static store = new Map<string, { count: number; expiresAt: number }>();
  
  constructor(url: string, options: any) {
    void url;
    void options;
  }

  disconnect() {}

  async quit() {}

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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    await limiter.resetAllForPrefix("wallet:balances");
    await limiter.resetAllForPrefix("anchor:auth");
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

  it("uses an environment-configured per-user bucket for authenticated endpoints", async () => {
    process.env.WALLET_BALANCE_RATE_LIMIT_MAX = "1";
    process.env.WALLET_BALANCE_RATE_LIMIT_WINDOW_MS = "60000";
    const guard = guardFor({
      keyPrefix: "wallet:balances",
      limit: 10,
      windowMs: 60_000,
      limitEnv: "WALLET_BALANCE_RATE_LIMIT_MAX",
      windowMsEnv: "WALLET_BALANCE_RATE_LIMIT_WINDOW_MS",
    }, limiter);

    const firstUser = { user: { userId: "user-1" }, ip: "203.0.113.1", headers: {} };
    const sameUserDifferentIp = { user: { userId: "user-1" }, ip: "203.0.113.2", headers: {} };
    const secondUser = { user: { userId: "user-2" }, ip: "203.0.113.1", headers: {} };

    await expect(guard.canActivate(contextFor(firstUser, responseMock()))).resolves.toBe(true);
    const blockedResponse = responseMock();
    await expect(guard.canActivate(contextFor(sameUserDifferentIp, blockedResponse))).rejects.toMatchObject({
      status: 429,
    });
    expect(blockedResponse.headers.get("Retry-After")).toBeDefined();
    await expect(guard.canActivate(contextFor(secondUser, responseMock()))).resolves.toBe(true);
  });

  it("uses the first forwarded IP for unauthenticated endpoint buckets", async () => {
    const guard = guardFor({
      keyPrefix: "anchor:auth",
      limit: 1,
      windowMs: 60_000,
    }, limiter);

    const firstRequest = { headers: { "x-forwarded-for": "198.51.100.8, 10.0.0.1" } };
    const sameClient = { headers: { "x-forwarded-for": "198.51.100.8, 10.0.0.2" } };
    const differentClient = { headers: { "x-forwarded-for": "198.51.100.9" } };

    await expect(guard.canActivate(contextFor(firstRequest, responseMock()))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(sameClient, responseMock()))).rejects.toMatchObject({
      status: 429,
    });
    await expect(guard.canActivate(contextFor(differentClient, responseMock()))).resolves.toBe(true);
  });

  it("wires configurable policies to every Horizon-facing endpoint", () => {
    const walletController = readFileSync(
      join(__dirname, "../wallet/wallet.controller.ts"),
      "utf8",
    );
    const anchorController = readFileSync(
      join(__dirname, "../anchor/anchor.controller.ts"),
      "utf8",
    );
    const anchorAuthController = readFileSync(
      join(__dirname, "../anchor/auth.controller.ts"),
      "utf8",
    );
    const appModule = readFileSync(join(__dirname, "../app.module.ts"), "utf8");

    expect(walletController).toContain("WALLET_BALANCE_RATE_LIMIT_MAX");
    expect(walletController).toContain("WALLET_BALANCE_RATE_LIMIT_WINDOW_MS");
    expect(anchorController).toContain("ANCHOR_FX_RATE_LIMIT_MAX");
    expect(anchorController).toContain("ANCHOR_FX_RATE_LIMIT_WINDOW_MS");
    expect(anchorAuthController).toContain("ANCHOR_AUTH_RATE_LIMIT_MAX");
    expect(anchorAuthController).toContain("ANCHOR_AUTH_RATE_LIMIT_WINDOW_MS");
    expect(appModule).toContain("RateLimitModule");
  });
});
