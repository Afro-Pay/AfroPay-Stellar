import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AnchorService } from './anchor.service';
import { DepositQueryDto, FxRateQueryDto, WithdrawQueryDto } from './anchor.query';

@UseGuards(AuthGuard('jwt'))
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
