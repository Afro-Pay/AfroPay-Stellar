import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

interface RefreshTokenPayload {
  sub: string;
  email: string;
  type?: string;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async register(email: string, password: string) {
    const hash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({ data: { email, password: hash } });
    return this.signToken(user.id, user.email);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password)))
      throw new UnauthorizedException('Invalid credentials');
    return this.signToken(user.id, user.email);
  }

  async refreshSession(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.refreshSecret(),
      });
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return this.signToken(payload.sub, payload.email);
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired. Please sign in again.',
      });
    }
  }

  private signToken(userId: string, email: string) {
    const accessExpiresIn = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
    return {
      access_token: this.jwt.sign(
        { sub: userId, email, type: 'access' },
        { expiresIn: accessExpiresIn },
      ),
      refresh_token: this.jwt.sign(
        { sub: userId, email, type: 'refresh' },
        {
          expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
          secret: this.refreshSecret(),
        },
      ),
      token_type: 'Bearer',
      expires_in: accessExpiresIn,
    };
  }

  private refreshSecret() {
    return process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET;
  }
}
