import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from 'nestjs-pino';

// nestjs-pino's LoggerModule is registered once, globally, in AppModule —
// the Logger it provides is available here without a second forRoot() call.
@Global()
@Module({
  imports: [
    PrismaModule,
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
        level: process.env.LOG_LEVEL || 'info',
        customProps: () => ({
          service: 'afropay-api',
        }),
      },
    }),
  ],
  controllers: [AuditLogController],
  providers: [AuditLogService, AdminGuard, JwtAuthGuard, JwtStrategy],
  exports: [AuditLogService],
})
export class AuditModule {}
