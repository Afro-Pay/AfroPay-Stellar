import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditLogService,
  AuditCategory,
  AuditOperation,
  AuditOutcome,
} from '../audit/audit.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auditLog: AuditLogService,
  ) {}

  async register(email: string, password: string) {
    const hash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({ data: { email, password: hash } });

    await this.auditLog.log({
      userId: user.id,
      category: AuditCategory.AUTH,
      operation: AuditOperation.AUTH_REGISTER,
      outcome: AuditOutcome.SUCCESS,
      metadata: { email },
    });

    return this.signToken(user.id, user.email);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      await this.auditLog.log({
        category: AuditCategory.AUTH,
        operation: AuditOperation.AUTH_LOGIN_FAILED,
        outcome: AuditOutcome.FAILURE,
        metadata: { email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.auditLog.log({
      userId: user.id,
      category: AuditCategory.AUTH,
      operation: AuditOperation.AUTH_LOGIN,
      outcome: AuditOutcome.SUCCESS,
      metadata: { email },
    });

    return this.signToken(user.id, user.email);
  }

  private signToken(userId: string, email: string) {
    return { access_token: this.jwt.sign({ sub: userId, email }) };
  }
}
