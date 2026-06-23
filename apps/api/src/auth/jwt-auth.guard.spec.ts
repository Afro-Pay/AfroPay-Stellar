import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('returns the authenticated user when Passport validation succeeds', () => {
    const user = { userId: 'user-123', email: 'user@example.com' };

    expect(guard.handleRequest(null, user, null, {} as any)).toBe(user);
  });

  it('returns a distinct auth-expired response for expired access tokens', () => {
    const expiredAt = new Date('2026-01-01T00:00:00.000Z');

    expect(() =>
      guard.handleRequest(null, null, { name: 'TokenExpiredError', expiredAt }, {} as any),
    ).toThrow(UnauthorizedException);

    try {
      guard.handleRequest(null, null, { name: 'TokenExpiredError', expiredAt }, {} as any);
    } catch (error) {
      const exception = error as UnauthorizedException;
      expect(exception.getResponse()).toMatchObject({
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Access token expired. Refresh the session or sign in again.',
        expiredAt,
      });
    }
  });

  it('returns a distinct auth-invalid response for missing or malformed tokens', () => {
    try {
      guard.handleRequest(null, null, { name: 'JsonWebTokenError' }, {} as any);
    } catch (error) {
      const exception = error as UnauthorizedException;
      expect(exception.getResponse()).toMatchObject({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Access token is invalid or missing.',
      });
    }
  });
});
