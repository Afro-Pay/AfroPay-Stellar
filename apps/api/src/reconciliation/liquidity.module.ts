import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { LiquidityController } from './liquidity.controller';
import { LiquidityWorkerController } from './liquidity-worker.controller';
import { HybridReserveMonitor, LiquidityService, ReserveMonitor } from './liquidity.service';
import { LiquidityExecutor, RedisLiquidityExecutor } from './liquidity-executor';
import { RedisLockService } from '../common/lock/lock.service';
import { AdminGuard } from '../admin/admin.guard';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [LiquidityController, LiquidityWorkerController],
  providers: [
    LiquidityService,
    HybridReserveMonitor,
    { provide: 'LIQUIDITY_RESERVE_MONITOR', useExisting: HybridReserveMonitor },
    { provide: LiquidityExecutor, useClass: RedisLiquidityExecutor },
    RedisLockService,
    AdminGuard,
  ],
  exports: [LiquidityService],
})
export class LiquidityModule {}
