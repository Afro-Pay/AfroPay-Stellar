import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { TransactionModule } from './transaction/transaction.module';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty' }
          : undefined,
        level: process.env.LOG_LEVEL || 'info',
        customProps: () => ({
          service: 'afropay-api',
        }),
      },
    }),
    // Global Bull/Redis connection — shared by every BullModule.registerQueue().
    // Falls back to localhost in test/dev when REDIS_URL is absent.
    BullModule.forRoot({
      redis: process.env.REDIS_URL || 'redis://localhost:6379',
    }),
    AuditModule,
    AuthModule,
    WalletModule,
    TransactionModule,
    AdminModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
