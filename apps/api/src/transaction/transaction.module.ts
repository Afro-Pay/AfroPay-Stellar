import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { TransactionProcessor } from './transaction.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'transactions' }),
    PrismaModule,
    WalletModule,
    AuditModule,
  ],
  providers: [TransactionService, TransactionProcessor],
  controllers: [TransactionController],
})
export class TransactionModule {}
