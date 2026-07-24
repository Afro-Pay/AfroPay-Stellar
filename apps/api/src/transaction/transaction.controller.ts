import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
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
@Controller(['transaction', 'transactions'])
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
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional UUID. Retrying a send with the same key within 24h returns the ' +
      'original response (HTTP 200) without creating a second transfer.',
  })
  @ApiResponse({
    status: 201,
    description: 'Payment sent successfully',
    type: TransactionResponseDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Duplicate request with a known Idempotency-Key — original response replayed',
    type: TransactionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid transaction data or malformed Idempotency-Key' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 402, description: 'Insufficient funds' })
  async sendPayment(
    @Request() req: any,
    @Body() sendDto: SendDto,
    // Minimal structural type — only `status()` is used — to avoid depending on
    // express type declarations. `passthrough` keeps normal body serialization.
    @Res({ passthrough: true }) res: { status: (code: number) => void },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    const result = await this.transactionService.sendPayment(req.user.userId, sendDto, key);

    // A replayed duplicate returns 200; a freshly created transfer keeps 201.
    if (result.idempotentReplay) {
      res.status(HttpStatus.OK);
    }

    // Return only the response shape; the internal replay flag is not exposed,
    // so a replayed body is identical to the original.
    return { txId: result.txId, status: result.status };
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

  @Post(':id/risk')
  @ApiOperation({ summary: 'Update transaction risk score and flagged status' })
  @ApiResponse({ status: 200, description: 'Risk updated successfully' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async updateRisk(
    @Param('id') id: string,
    @Body() body: { riskScore: number; flagged: boolean },
  ) {
    return this.transactionService.updateRiskScore(id, body.riskScore, body.flagged);
  }

  /** RFC 4122 UUID (any version), matching the `Idempotency-Key: <uuid>` spec. */
  private static readonly IDEMPOTENCY_KEY_PATTERN =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  /**
   * Validates the optional Idempotency-Key header. Returns undefined when absent
   * (idempotency disabled for the request) and throws on a malformed value so a
   * client bug can't silently bypass deduplication.
   */
  private normalizeIdempotencyKey(raw?: string): string | undefined {
    if (raw === undefined) return undefined;
    const key = raw.trim();
    if (!TransactionController.IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new BadRequestException('Idempotency-Key header must be a valid UUID');
    }
    return key;
  }
}
