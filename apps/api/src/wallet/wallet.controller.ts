import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WalletService } from './wallet.service';
import { IsString } from 'class-validator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

class ImportWalletDto {
  @IsString() secretKey: string;
}

@UseGuards(AuthGuard('jwt'))
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Post('create')
  @RateLimit({
    keyPrefix: 'wallet:create',
    limit: 10,
    windowMs: 60_000,
    limitEnv: 'PUBLIC_API_RATE_LIMIT_MAX',
    windowMsEnv: 'PUBLIC_API_RATE_LIMIT_WINDOW_MS',
  })
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
