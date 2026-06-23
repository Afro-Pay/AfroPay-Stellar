import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AnchorService } from './anchor.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

@UseGuards(AuthGuard('jwt'))
@Controller('anchor')
export class AnchorController {
  constructor(private anchor: AnchorService) {}

  @Get('deposit')
  @RateLimit({
    keyPrefix: 'anchor:deposit',
    limit: 20,
    windowMs: 60_000,
    limitEnv: 'ANCHOR_RATE_LIMIT_MAX',
    windowMsEnv: 'ANCHOR_RATE_LIMIT_WINDOW_MS',
  })
  deposit(@Query('asset') asset: string, @Query('account') account: string) {
    return this.anchor.getDepositInfo(asset, account);
  }

  @Get('withdraw')
  @RateLimit({
    keyPrefix: 'anchor:withdraw',
    limit: 20,
    windowMs: 60_000,
    limitEnv: 'ANCHOR_RATE_LIMIT_MAX',
    windowMsEnv: 'ANCHOR_RATE_LIMIT_WINDOW_MS',
  })
  withdraw(
    @Query('asset') asset: string,
    @Query('account') account: string,
    @Query('amount') amount: string,
  ) {
    return this.anchor.getWithdrawInfo(asset, account, amount);
  }

  @Get('fx-rate')
  @RateLimit({
    keyPrefix: 'anchor:fx-rate',
    limit: 20,
    windowMs: 60_000,
    limitEnv: 'ANCHOR_RATE_LIMIT_MAX',
    windowMsEnv: 'ANCHOR_RATE_LIMIT_WINDOW_MS',
  })
  fxRate(@Query('from') from: string, @Query('to') to: string) {
    return this.anchor.getFxRate(from, to);
  }
}
