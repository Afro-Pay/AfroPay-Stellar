import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AnchorController } from './anchor.controller';
import { AnchorAuthController } from './auth.controller';
import { Sep12Controller } from './sep12.controller';
import { Sep24Controller } from './sep24.controller';
import { AnchorService } from './anchor.service';
import { Sep12Service } from './sep12.service';
import { Sep24Service } from './sep24.service';
import { WalletModule } from '../wallet/wallet.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    WalletModule,
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'test-secret-for-development-only',
      signOptions: { expiresIn: '30m' },
    }),
  ],
  controllers: [AnchorController, AnchorAuthController, Sep12Controller, Sep24Controller],
  providers: [AnchorService, Sep12Service, Sep24Service],
  exports: [AnchorService, Sep12Service, Sep24Service],
})
export class AnchorModule {}

