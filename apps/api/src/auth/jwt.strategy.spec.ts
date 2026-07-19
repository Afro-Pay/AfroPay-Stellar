import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const originalEnv = process.env;
  let strategy: JwtStrategy;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JWT_SECRET: 'test-secret',
    };
    strategy = new JwtStrategy();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts access-token payloads', () => {
    expect(
      strategy.validate({
        sub: 'user-123',
        email: 'user@example.com',
        type: 'access',
      }),
    ).toEqual({
      userId: 'user-123',
      email: 'user@example.com',
    });
  });

  it('accepts legacy access-token payloads without a token type', () => {
    expect(
      strategy.validate({
        sub: 'user-123',
        email: 'user@example.com',
      }),
    ).toEqual({
      userId: 'user-123',
      email: 'user@example.com',
    });
  });

  it('rejects refresh-token payloads on protected routes', () => {
    expect(() =>
      strategy.validate({
        sub: 'user-123',
        email: 'user@example.com',
        type: 'refresh',
      }),
    ).toThrow(UnauthorizedException);
  });
});
