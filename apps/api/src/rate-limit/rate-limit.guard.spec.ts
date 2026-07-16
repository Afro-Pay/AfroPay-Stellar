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
