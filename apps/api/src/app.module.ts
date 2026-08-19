import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { TransactionModule } from './transaction/transaction.module';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';

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
    // Registers RateLimitGuardRedis as a global APP_GUARD so every
    // @RateLimit(...) decorated route is enforced. Routes without the
    // decorator are unaffected (the guard is a no-op for them).
    RateLimitModule,
    AuditModule,
    AuthModule,
    WalletModule,
    TransactionModule,
    AdminModule,
  ],
})
export class AppModule {}
