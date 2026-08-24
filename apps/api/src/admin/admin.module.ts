import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AdminController } from './admin.controller';

import { AdminComplianceService } from './admin.service';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  controllers: [AdminController],
  providers: [AdminComplianceService, JwtAuthGuard, JwtStrategy],
  exports: [AdminComplianceService],
})
export class AdminModule {}
