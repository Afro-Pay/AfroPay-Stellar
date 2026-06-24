import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitOptions } from './rate-limit.decorator';

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

function guardFor(options: RateLimitOptions | undefined): RateLimitGuard {
  return new RateLimitGuard({
    getAllAndOverride: jest.fn().mockReturnValue(options),
  } as unknown as Reflector);
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

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allows routes without rate limit metadata', () => {
    guard = guardFor(undefined);
    const res = responseMock();
    const ctx = contextFor({ ip: '127.0.0.1', headers: {} }, res);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('blocks requests after the configured limit and returns a readable 429 payload', () => {
    const options = { keyPrefix: 'auth:login', limit: 2, windowMs: 60_000 };
    guard = guardFor(options);
    const request = { ip: '203.0.113.10', headers: {} };
    const firstRes = responseMock();
    const secondRes = responseMock();
    const thirdRes = responseMock();

    expect(guard.canActivate(contextFor(request, firstRes))).toBe(true);
    expect(guard.canActivate(contextFor(request, secondRes))).toBe(true);

    expect(() => guard.canActivate(contextFor(request, thirdRes))).toThrow(HttpException);
    const thrown = (() => {
      try {
        guard.canActivate(contextFor(request, responseMock()));
      } catch (error) {
        return error as HttpException;
      }
      throw new Error('expected rate limit exception');
    })();

    expect(thrown.getStatus()).toBe(429);
    expect(thrown.getResponse()).toMatchObject({
      code: 'RATE_LIMITED',
      limit: 2,
      windowMs: 60_000,
    });
    expect(thirdRes.headers.get('Retry-After')).toBeDefined();
    expect(thirdRes.headers.get('X-RateLimit-Limit')).toBe('2');
    expect(thirdRes.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('uses route-specific environment overrides', () => {
    process.env.LOGIN_RATE_LIMIT_MAX = '1';
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '5000';
    const request = { headers: { 'x-forwarded-for': '198.51.100.44, 10.0.0.2' } };
    const options = {
      keyPrefix: 'auth:login',
      limit: 10,
      windowMs: 60_000,
      limitEnv: 'LOGIN_RATE_LIMIT_MAX',
      windowMsEnv: 'LOGIN_RATE_LIMIT_WINDOW_MS',
    };
    guard = guardFor(options);

    expect(guard.canActivate(contextFor(request, responseMock()))).toBe(true);

    expect(() => guard.canActivate(contextFor(request, responseMock()))).toThrow(HttpException);
  });

  it('separates buckets by authenticated user when a user id is available', () => {
    const options = { keyPrefix: 'transactions:send', limit: 1, windowMs: 60_000 };
    guard = guardFor(options);

    expect(
      guard.canActivate(contextFor({ user: { userId: 'user-a' }, headers: {} }, responseMock())),
    ).toBe(true);
    expect(
      guard.canActivate(contextFor({ user: { userId: 'user-b' }, headers: {} }, responseMock())),
    ).toBe(true);
    expect(() =>
      guard.canActivate(contextFor({ user: { userId: 'user-a' }, headers: {} }, responseMock())),
    ).toThrow(HttpException);
  });
});
