import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnchorService } from './anchor.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('anchor')
export class AnchorController {
  constructor(private anchor: AnchorService) {}

  @Get('deposit')
  deposit(@Query() query: DepositQueryDto) {
    return this.anchor.getDepositInfo(query.asset, query.account);
  }

  @Get('withdraw')
  withdraw(@Query() query: WithdrawQueryDto) {
    return this.anchor.getWithdrawInfo(query.asset, query.account, query.amount);
  }

  @Get('fx-rate')
  fxRate(@Query() query: FxRateQueryDto) {
    return this.anchor.getFxRate(query.from, query.to);
  }
}
