import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AuditCategory, AuditLogService, AuditOutcome } from '../audit/audit.service';
import { Logger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';
import { LoginDto, RegisterDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaClient,
    private auditService: AuditLogService,
    private logger: Logger,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string, userAgent?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name ?? null,
      },
    });

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    // Audit: Registration
    await this.auditService.log({
      userId: user.id,
      category: AuditCategory.AUTH,
      operation: 'REGISTER',
      outcome: AuditOutcome.SUCCESS,
      metadata: { email: user.email, name: user.name, ipAddress, userAgent },
    });

    this.logger.log({
      event: 'user_registered',
      userId: user.id,
      email: user.email,
    });

    return { access_token: accessToken, user: this.publicUser(user) };
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      this.logger.warn({
        event: 'login_failed',
        email: dto.email,
        ipAddress,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    // Audit: Login
    await this.auditService.log({
      userId: user.id,
      category: AuditCategory.AUTH,
      operation: 'LOGIN',
      outcome: AuditOutcome.SUCCESS,
      metadata: { email: user.email, ipAddress, userAgent },
    });

    this.logger.log({
      event: 'user_logged_in',
      userId: user.id,
      email: user.email,
    });

    return { access_token: accessToken, user: this.publicUser(user) };
  }

  /**
   * Stateless JWTs — logout is a client-side token discard. Kept as an
   * endpoint so future revocation lists can hook in without API changes.
   */
  async logout() {
    return { success: true, message: 'Logged out' };
  }

  private publicUser(user: { id: string; email: string; name: string | null; role: string }) {
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
