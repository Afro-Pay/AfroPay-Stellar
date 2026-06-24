import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AnchorService } from './anchor.service';
import { AppThrottlerGuard } from '../common/guards/throttler.guard';

@UseGuards(AuthGuard('jwt'), AppThrottlerGuard)
@SkipThrottle({ login: true, register: true, wallet: true, transaction: true })
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
