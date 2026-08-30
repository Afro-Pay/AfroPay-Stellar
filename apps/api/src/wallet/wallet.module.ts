import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { VaultService } from '../vault/vault.service';
import { WalletOwnershipGuard } from './wallet-ownership.guard';
import { SorobanModule } from '../soroban/soroban.module';
import { WebAuthnService } from './webauthn.service';

@Module({
  imports: [PrismaModule, AuthModule, SorobanModule],
  providers: [WalletService, VaultService, WalletOwnershipGuard, WebAuthnService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
