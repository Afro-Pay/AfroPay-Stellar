import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionService } from './transaction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KycGuard } from '../kyc/kyc.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import {
  GetHistoryQueryDto,
  PaginatedHistoryDto,
  SendDto,
  TransactionResponseDto,
} from './dto';

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
  async sendPayment(@Request() req: any, @Body() sendDto: SendDto) {
    return this.transactionService.sendPayment(req.user.userId, sendDto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get paginated transaction history' })
  @ApiResponse({
    status: 200,
    description: 'Paginated transaction history',
    type: PaginatedHistoryDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid pagination parameters (limit > 100)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  history(@Request() req: any, @Query() query: GetHistoryQueryDto) {
    return this.transactionService.getHistory(req.user.userId, {
      limit: query.limit,
      cursor: query.cursor,
      status: query.status,
      currency: query.currency,
      dateRange: query.dateRange,
    });
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
