import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { TransactionDlqController } from './transaction-dlq.controller';
import { TransactionDlqService } from './transaction-dlq.service';
import { TransactionProcessor } from './transaction.processor';
import { TransferSimulationService } from './transfer-simulation.service';
import { FraudService } from './fraud.service';
import { AdminGuard } from '../admin/admin.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';
import { KycModule } from '../kyc/kyc.module';
import { AnchorModule } from '../anchor/anchor.module';
import {
  TRANSACTION_DLQ_QUEUE_NAME,
  TRANSACTION_QUEUE_NAME,
} from './transaction-retry.config';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: TRANSACTION_QUEUE_NAME },
      { name: TRANSACTION_DLQ_QUEUE_NAME },
    ),
    PrismaModule,
    WalletModule,
    AuthModule,
    KycModule,
    AnchorModule,
  ],
  providers: [
    TransactionService,
    TransactionProcessor,
    TransactionDlqService,
    TransferSimulationService,
    FraudService,
    AdminGuard,
  ],
  controllers: [TransactionController, TransactionDlqController],
})
export class TransactionModule {}
