import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnchorService } from './anchor.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('anchor')
export class AnchorController {
  constructor(private anchor: AnchorService) {}

  @Get('deposit')
  deposit(@Query('asset') asset: string, @Query('account') account: string) {
    return this.anchor.getDepositInfo(asset, account);
  }

  @Get('withdraw')
  withdraw(
    @Query('asset') asset: string,
    @Query('account') account: string,
    @Query('amount') amount: string,
  ) {
    return this.anchor.getWithdrawInfo(asset, account, amount);
  }

  @Get('fx-rate')
  fxRate(@Query('from') from: string, @Query('to') to: string) {
    return this.anchor.getFxRate(from, to);
  }
}
