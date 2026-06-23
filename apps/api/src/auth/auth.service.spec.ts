import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';

describe('AuthService refresh sessions', () => {
  const originalEnv = process.env;
  let service: AuthService;
  let jwt: JwtService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JWT_SECRET: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_ACCESS_EXPIRES_IN: '10m',
      JWT_REFRESH_EXPIRES_IN: '2d',
    };
    jwt = new JwtService({ secret: process.env.JWT_SECRET });
    service = new AuthService({} as any, jwt);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('refreshes a valid refresh token into a new token pair', async () => {
    const refreshToken = jwt.sign(
      { sub: 'user-123', email: 'user@example.com', type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '2d' },
    );

    const result = await service.refreshSession(refreshToken);

    expect(result).toMatchObject({
      token_type: 'Bearer',
      expires_in: '10m',
    });
    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(jwt.verify(result.access_token, { secret: process.env.JWT_SECRET })).toMatchObject({
      sub: 'user-123',
      email: 'user@example.com',
    });
    expect(
      jwt.verify(result.refresh_token, { secret: process.env.JWT_REFRESH_SECRET }),
    ).toMatchObject({
      sub: 'user-123',
      email: 'user@example.com',
      type: 'refresh',
    });
  });

  it('rejects access tokens on the refresh endpoint', async () => {
    const accessToken = jwt.sign(
      { sub: 'user-123', email: 'user@example.com' },
      { secret: process.env.JWT_SECRET, expiresIn: '10m' },
    );

    await expect(service.refreshSession(accessToken)).rejects.toThrow(UnauthorizedException);
  });
});
