import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AdminGuard } from '../admin/admin.guard';
import { ComplianceController } from './compliance.controller';
import { ComplianceActionService } from './compliance-action.service';
import { ComplianceExecutor, RedisComplianceExecutor } from './compliance-executor';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [ComplianceController],
  providers: [
    ComplianceActionService,
    { provide: ComplianceExecutor, useClass: RedisComplianceExecutor },
    AdminGuard,
    JwtAuthGuard,
    JwtStrategy,
  ],
  exports: [ComplianceActionService],
})
export class ComplianceModule {}
