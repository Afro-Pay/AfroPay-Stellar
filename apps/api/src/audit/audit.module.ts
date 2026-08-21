import { Module, Global } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AdminGuard } from '../admin/admin.guard';
import { AuditLogService } from './audit.service';
import { AuditLogController } from './audit.controller';

// nestjs-pino's LoggerModule is registered once, globally, in AppModule —
// the Logger it provides is available here without a second forRoot() call.
@Global()
@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [AuditLogController],
  providers: [AuditLogService, AdminGuard, JwtAuthGuard, JwtStrategy],
  exports: [AuditLogService],
})
export class AuditModule {}
