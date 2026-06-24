import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { WalletModule } from './wallet/wallet.module';
import { TransactionModule } from './transaction/transaction.module';
import { AnchorModule } from './anchor/anchor.module';
import { AuthModule } from './auth/auth.module';
import { AppThrottlerGuard } from './common/guards/throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'login',
          ttl: config.get<number>('THROTTLE_LOGIN_TTL', 60000),
          limit: config.get<number>('THROTTLE_LOGIN_LIMIT', 5),
        },
        {
          name: 'register',
          ttl: config.get<number>('THROTTLE_REGISTER_TTL', 300000),
          limit: config.get<number>('THROTTLE_REGISTER_LIMIT', 3),
        },
        {
          name: 'wallet',
          ttl: config.get<number>('THROTTLE_WALLET_TTL', 300000),
          limit: config.get<number>('THROTTLE_WALLET_LIMIT', 5),
        },
        {
          name: 'transaction',
          ttl: config.get<number>('THROTTLE_TRANSACTION_TTL', 60000),
          limit: config.get<number>('THROTTLE_TRANSACTION_LIMIT', 10),
        },
        {
          name: 'anchor',
          ttl: config.get<number>('THROTTLE_ANCHOR_TTL', 60000),
          limit: config.get<number>('THROTTLE_ANCHOR_LIMIT', 30),
        },
      ],
    }),
    AuthModule,
    WalletModule,
    TransactionModule,
    AnchorModule,
  ],
  providers: [AppThrottlerGuard],
})
export class AppModule {}
