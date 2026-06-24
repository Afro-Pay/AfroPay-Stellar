import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { TransactionService, SendTransferDto } from './transaction.service';
import { AppThrottlerGuard } from '../common/guards/throttler.guard';
import { IsOptional, IsString } from 'class-validator';

class SendDto implements SendTransferDto {
  @IsString() destinationPublicKey: string;
  @IsString() amount: string;
  @IsString() assetCode: string;
  @IsOptional() @IsString() assetIssuer?: string;
  @IsOptional() @IsString() memo?: string;
}

@UseGuards(AuthGuard('jwt'))
@Controller('transactions')
export class TransactionController {
  constructor(private txService: TransactionService) {}

  @Post('send')
  @UseGuards(AppThrottlerGuard)
  @SkipThrottle({ login: true, register: true, wallet: true, anchor: true })
  send(@Request() req: any, @Body() dto: SendDto) {
    return this.txService.sendTransfer(req.user.userId, dto);
  }

  @Get('history')
  history(@Request() req: any) {
    return this.txService.getHistory(req.user.userId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.txService.getTransaction(id);
  }
}
