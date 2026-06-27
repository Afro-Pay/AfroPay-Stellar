import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionService } from './transaction.service';
import { SendDto, TransactionResponseDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('transaction')
@Controller('transaction')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post('send')
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

  @Get('history/:walletId')
  @ApiOperation({ summary: 'Get transaction history' })
  @ApiResponse({
    status: 200,
    description: 'Transaction history retrieved',
    type: [TransactionResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async getHistory(@Param('walletId') walletId: string) {
    return this.transactionService.getTransactionHistory(walletId);
  }
}
