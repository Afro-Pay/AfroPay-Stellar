import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { TransactionProcessor } from './transaction.processor';
import { TransferSimulationService } from './transfer-simulation.service';
import { FraudService } from './fraud.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';
import { KycModule } from '../kyc/kyc.module';
import { AnchorModule } from '../anchor/anchor.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'transactions' }),
    PrismaModule,
    WalletModule,
    AuthModule,
    KycModule,
    AnchorModule,
    AuditModule,
  ],
  providers: [TransactionService, TransactionProcessor, TransferSimulationService, FraudService],
  controllers: [TransactionController],
})
export class TransactionModule {}
