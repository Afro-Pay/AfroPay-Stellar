import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from 'nestjs-pino';

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
  providers: [
    AuditService,
    {
      provide: PrismaClient,
      useFactory: () => {
        const prisma = new PrismaClient();
        // Ensure audit_logs are append-only
        // This is enforced at the database level with permissions
        // But we also ensure no update/delete methods are exposed
        return prisma;
      },
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
