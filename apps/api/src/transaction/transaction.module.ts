import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { TransactionDlqController } from './transaction-dlq.controller';
import { TransactionDlqService } from './transaction-dlq.service';
import { TransactionProcessor } from './transaction.processor';
import { TransferSimulationService } from './transfer-simulation.service';
import { FraudService } from './fraud.service';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { AdminGuard } from '../admin/admin.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';
import { KycModule } from '../kyc/kyc.module';
import { AnchorModule } from '../anchor/anchor.module';
import { AuditModule } from '../audit/audit.module';

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
    AuditModule,
  ],
  providers: [
    TransactionService,
    TransactionProcessor,
    TransactionDlqService,
    TransferSimulationService,
    FraudService,
    ComplianceService,
    AdminGuard,
  ],
  controllers: [TransactionController, TransactionDlqController, ComplianceController],
})
export class TransactionModule {}
