import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { TransactionProcessor } from './transaction.processor';
import { TransferSimulationService } from './transfer-simulation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'transactions' }),
    PrismaModule,
    WalletModule,
    AuthModule,
  ],
  providers: [TransactionService, TransactionProcessor, TransferSimulationService],
  controllers: [TransactionController],
})
export class TransactionModule {}
