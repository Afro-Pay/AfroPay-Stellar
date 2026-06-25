import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { TransactionService, SendTransferDto } from './transaction.service';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycGuard } from '../kyc/kyc.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

class SendDto implements SendTransferDto {
  @IsString() destinationPublicKey: string;
  @IsString() amount: string;
  @IsString() assetCode: string;
  @IsOptional() @IsString() assetIssuer?: string;
  @IsOptional() @IsString() memo?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionController {
  constructor(private txService: TransactionService) {}

  @Post('send')
  @UseGuards(KycGuard)
  @RateLimit({
    keyPrefix: 'transactions:send',
    limit: 20,
    windowMs: 60_000,
    limitEnv: 'PUBLIC_API_RATE_LIMIT_MAX',
    windowMsEnv: 'PUBLIC_API_RATE_LIMIT_WINDOW_MS',
  })
  send(@Request() req: any, @Body() dto: SendDto) {
    return this.txService.sendTransfer(req.user.userId, dto);
  }

  @Get('history')
  history(@Request() req: any) {
    return this.txService.getHistory(req.user.userId);
  }

  @Get(':id')
  get(@Param('id') id: string, @Request() req: any) {
    return this.txService.getTransaction(id, req.user?.userId);
  }
}
