import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, AuditCategory, AuditOperation, AuditOutcome } from '../audit/audit.service';
import { Logger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private auditService: AuditLogService,
    private logger: Logger,
  ) {}

  async register(email: string, password: string, name?: string, ipAddress?: string, userAgent?: string) {
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    // Audit: Registration
    await this.auditService.log({
      userId: user.id,
      category: AuditCategory.AUTH,
      operation: AuditOperation.REGISTER,
      outcome: AuditOutcome.SUCCESS,
      metadata: { email: user.email, name: user.name, ipAddress, userAgent },
    });

    this.logger.log({
      event: 'user_registered',
      userId: user.id,
      email: user.email,
    });

    return user;
  }

  async login(email: string, password: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      this.logger.warn({
        event: 'login_failed',
        email,
        ipAddress,
      });
      await this.auditService.log({
        userId: user?.id ?? null,
        category: AuditCategory.AUTH,
        operation: AuditOperation.LOGIN_FAILED,
        outcome: AuditOutcome.FAILURE,
        metadata: { email, ipAddress, userAgent },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    // Audit: Login
    await this.auditService.log({
      userId: user.id,
      category: AuditCategory.AUTH,
      operation: AuditOperation.LOGIN,
      outcome: AuditOutcome.SUCCESS,
      metadata: { email: user.email, ipAddress, userAgent },
    });

    this.logger.log({
      event: 'user_logged_in',
      userId: user.id,
      email: user.email,
    });

    return { accessToken, user: { id: user.id, email: user.email, role: user.role } };
  }
}
