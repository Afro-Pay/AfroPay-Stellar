import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorAuthController } from './auth.controller';
import { AnchorService } from './anchor.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [AnchorController, AnchorAuthController],
  providers: [AnchorService],
  exports: [AnchorService],
})
export class AnchorModule {}
