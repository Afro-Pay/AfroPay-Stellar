import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { TransactionModule } from './transaction/transaction.module';
import { MetricsModule } from './metrics/metrics.module';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { SorobanModule } from './soroban/soroban.module';
import { ComplianceModule } from './transaction/compliance.module';
import { LiquidityModule } from './reconciliation/liquidity.module';

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
    MetricsModule,
    AuditModule,
    AuthModule,
    WalletModule,
    TransactionModule,
    AdminModule,
    SorobanModule,
    ComplianceModule,
    LiquidityModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
