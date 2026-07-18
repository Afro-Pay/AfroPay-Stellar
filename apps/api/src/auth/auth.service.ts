import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Logger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaClient,
    private auditService: AuditService,
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
    await this.auditService.log(
      user.id,
      'REGISTER',
      { email: user.email, name: user.name },
      ipAddress,
      userAgent,
    );

    this.logger.info({
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
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    // Audit: Login
    await this.auditService.log(
      user.id,
      'LOGIN',
      { email: user.email },
      ipAddress,
      userAgent,
    );

    this.logger.info({
      event: 'user_logged_in',
      userId: user.id,
      email: user.email,
    });

    return { accessToken, user: { id: user.id, email: user.email, role: user.role } };
  }
}
