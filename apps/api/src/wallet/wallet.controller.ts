import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WalletService } from './wallet.service';
import { IsString } from 'class-validator';

class ImportWalletDto {
  @IsString() secretKey: string;
}

@UseGuards(AuthGuard('jwt'))
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Post('create')
  create(@Request() req: any) {
    return this.wallet.createWallet(req.user.userId);
  }

  @Get('balances')
  balances(@Request() req: any) {
    return this.wallet.getBalances(req.user.userId);
  }

  @Get('reconcile')
  reconcile(@Request() req: any) {
    return this.wallet.reconcileWallet(req.user.userId);
  }

  @Get('export')
  export(@Request() req: any) {
    return this.wallet.exportWallet(req.user.userId);
  }

  @Post('import')
  import(@Request() req: any, @Body() dto: ImportWalletDto) {
    return this.wallet.importWallet(req.user.userId, dto.secretKey);
  }
}
