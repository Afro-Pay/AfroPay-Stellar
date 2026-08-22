import { Injectable, UnauthorizedException, ConflictException, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Logger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    @Optional() private auditService?: AuditService,
    @Optional() private logger?: Logger,
  ) {}

  async register(
    emailOrDto: string | { email: string; password: string; name?: string },
    password?: string,
    name?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const email = typeof emailOrDto === 'object' ? emailOrDto.email : emailOrDto;
    const pwd = typeof emailOrDto === 'object' ? emailOrDto.password : password!;
    const userName = typeof emailOrDto === 'object' ? emailOrDto.name : name;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(pwd, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    const payload: any = { sub: user.id, email: user.email };
    if (user.role) payload.role = user.role;

    const access_token = this.jwtService.sign(payload, { expiresIn: '7d' });

    if (this.auditService) {
      await this.auditService.log(
        user.id,
        'REGISTER',
        { email: user.email, name: userName },
        ipAddress,
        userAgent,
      );
    }

    this.logger?.log({
      event: 'user_registered',
      userId: user.id,
      email: user.email,
    });

    return { access_token, user: { id: user.id, email: user.email, role: user.role } };
  }

  async login(
    emailOrDto: string | { email: string; password: string },
    password?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const email = typeof emailOrDto === 'object' ? emailOrDto.email : emailOrDto;
    const pwd = typeof emailOrDto === 'object' ? emailOrDto.password : password!;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    const storedHash = user?.password ?? (user as any)?.passwordHash;

    if (!user || !storedHash) {
      this.logger?.warn({
        event: 'login_failed',
        email,
        ipAddress,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    try {
      const isMatch = await bcrypt.compare(pwd, storedHash);
      if (!isMatch) {
        this.logger?.warn({
          event: 'login_failed',
          email,
          ipAddress,
        });
        throw new UnauthorizedException('Invalid credentials');
      }
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: any = { sub: user.id, email: user.email };
    if (user.role) payload.role = user.role;

    const access_token = this.jwtService.sign(payload, { expiresIn: '7d' });

    if (this.auditService) {
      await this.auditService.log(
        user.id,
        'LOGIN',
        { email: user.email },
        ipAddress,
        userAgent,
      );
    }

    this.logger?.log({
      event: 'user_logged_in',
      userId: user.id,
      email: user.email,
    });

    return { access_token, user: { id: user.id, email: user.email, role: user.role } };
  }

  async logout() {
    return { message: 'Logged out successfully' };
  }

  validateToken(token: string) {
    return this.jwtService.verify(token);
  }

  async refreshToken(oldToken: string) {
    const decoded = this.jwtService.verify(oldToken);
    const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const payload: any = { sub: user.id, email: user.email };
    if (user.role) payload.role = user.role;

    const accessToken = this.jwtService.sign(payload, { expiresIn: '7d' });
    return { accessToken };
  }
}
