import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionService, SendTransferDto } from './transaction.service';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycGuard } from '../kyc/kyc.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { SendDto, TransactionResponseDto } from './dto';

class SendDto implements SendTransferDto {
  @IsString() destinationPublicKey: string;
  @IsString() amount: string;
  @IsString() assetCode: string;
  @IsOptional() @IsString() assetIssuer?: string;
  @IsOptional() @IsString() memo?: string;
}

@ApiTags('transaction')
@Controller('transaction')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post('send')
  @UseGuards(KycGuard)
  @RateLimit({
    keyPrefix: 'transactions:send',
    limit: 20,
    windowMs: 60_000,
    limitEnv: 'PUBLIC_API_RATE_LIMIT_MAX',
    windowMsEnv: 'PUBLIC_API_RATE_LIMIT_WINDOW_MS',
  })
  @ApiOperation({ summary: 'Send payment' })
  @ApiResponse({
    status: 201,
    description: 'Payment sent successfully',
    type: TransactionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid transaction data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 402, description: 'Insufficient funds' })
  async sendPayment(@Body() sendDto: SendDto) {
    return this.transactionService.sendPayment(sendDto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get transaction history' })
  @ApiResponse({
    status: 200,
    description: 'Transaction history retrieved',
    type: [TransactionResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  history(@Request() req: any) {
    return this.transactionService.getHistory(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  @ApiResponse({
    status: 200,
    description: 'Transaction found',
    type: TransactionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  get(@Param('id') id: string, @Request() req: any) {
    return this.transactionService.getTransaction(id, req.user?.userId);
  }
}