import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorAuthController } from './auth.controller';
import { Sep12Controller } from './sep12.controller';
import { AnchorService } from './anchor.service';
import { Sep12Service } from './sep12.service';
import { WalletModule } from '../wallet/wallet.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [WalletModule, PrismaModule],
  controllers: [AnchorController, AnchorAuthController, Sep12Controller],
  providers: [AnchorService, Sep12Service],
  exports: [AnchorService, Sep12Service],
})
export class AnchorModule {}
