import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TransactionService } from './transaction.service';
import { TransactionController } from './transaction.controller';
import { TransactionProcessor } from './transaction.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { SorobanModule } from '../soroban/soroban.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'transactions',
    }),
    PrismaModule,
    SorobanModule,
  ],
  providers: [TransactionService, TransactionProcessor],
  controllers: [TransactionController],
  exports: [TransactionService],
})
export class TransactionModule {}
