import { Module } from '@nestjs/common';
import { AuditLogService } from './audit.service';
import { AuditLogController } from './audit.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [AuditLogService],
  controllers: [AuditLogController],
  // Export so WalletModule, TransactionModule, etc. can inject AuditLogService.
  exports: [AuditLogService],
})
export class AuditModule {}
