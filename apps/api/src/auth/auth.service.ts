import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
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

  async register(emailOrDto: string | any, password?: string) {
    let email = '';
    let pass = '';
    if (typeof emailOrDto === 'object' && emailOrDto !== null) {
      email = emailOrDto.email;
      pass = emailOrDto.password;
    } else {
      email = emailOrDto;
      pass = password;
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hash = await bcrypt.hash(pass, 10);
    const user = await this.prisma.user.create({ data: { email, password: hash } });
    return this.signToken(user.id, user.email);
  }

  async login(emailOrDto: string | any, password?: string) {
    let email = '';
    let pass = '';
    if (typeof emailOrDto === 'object' && emailOrDto !== null) {
      email = emailOrDto.email;
      pass = emailOrDto.password;
    } else {
      email = emailOrDto;
      pass = password;
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(pass, user.password ?? (user as any).passwordHash);
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }
    
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');
    return this.signToken(user.id, user.email);
  }

  validateToken(token: string) {
    return this.jwt.verify(token);
  }

  async refreshToken(oldToken: string) {
    const decoded = this.jwt.verify<RefreshTokenPayload>(oldToken);
    const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const tokens = this.signToken(user.id, user.email);
    return { accessToken: tokens.access_token };
  }

  async logout() {
    return { success: true };
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
