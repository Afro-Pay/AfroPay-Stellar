import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { TransactionModule } from './transaction/transaction.module';
import { AnchorModule } from './anchor/anchor.module';
import { PrismaModule } from './prisma/prisma.module';
import { SorobanModule } from './soroban/soroban.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    PrismaModule,
    SorobanModule,
    AuthModule,
    WalletModule,
    TransactionModule,
    AnchorModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
