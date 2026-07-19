import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnchorModule } from '../anchor/anchor.module';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';

@Module({
  imports: [PrismaModule, AnchorModule],
  providers: [KycService],
  controllers: [KycController],
  exports: [KycService],
})
export class KycModule {}
