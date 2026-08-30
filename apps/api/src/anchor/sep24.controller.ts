import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Sep10AuthGuard } from './sep10-auth.guard';
import { Sep24Service } from './sep24.service';

@ApiTags('sep24')
@Controller('sep24')
export class Sep24Controller {
  constructor(private readonly sep24Service: Sep24Service) {}

  // ---------------------------------------------------------------------------
  // GET /sep24/info — Anchor capabilities (public, no auth required)
  // ---------------------------------------------------------------------------

  @Get('info')
  @ApiOperation({ summary: 'Get SEP-24 anchor capabilities and supported assets' })
  @ApiResponse({ status: 200, description: 'SEP-24 info response' })
  getInfo() {
    return this.sep24Service.getSep24Info();
  }

  // ---------------------------------------------------------------------------
  // POST /sep24/transactions/deposit/interactive — Start interactive deposit
  // ---------------------------------------------------------------------------

  @Post('transactions/deposit/interactive')
  @UseGuards(Sep10AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Start an interactive SEP-24 deposit session' })
  @ApiResponse({
    status: 200,
    description: 'Interactive deposit session created with webview URL',
  })
  @ApiResponse({ status: 400, description: 'Missing or invalid parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized — invalid SEP-10 token' })
  async depositInteractive(
    @Request() req: any,
    @Body()
    body: {
      asset_code: string;
      asset_issuer?: string;
      amount?: string;
    },
  ) {
    const account = req.sep10User.account;
    if (!body.asset_code) {
      throw new BadRequestException('asset_code is required');
    }
    return this.sep24Service.createInteractiveSession(
      account,
      'deposit',
      body.asset_code,
      body.asset_issuer,
      body.amount,
    );
  }

  // ---------------------------------------------------------------------------
  // POST /sep24/transactions/withdraw/interactive — Start interactive withdraw
  // ---------------------------------------------------------------------------

  @Post('transactions/withdraw/interactive')
  @UseGuards(Sep10AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Start an interactive SEP-24 withdrawal session' })
  @ApiResponse({
    status: 200,
    description: 'Interactive withdrawal session created with webview URL',
  })
  @ApiResponse({ status: 400, description: 'Missing or invalid parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized — invalid SEP-10 token' })
  async withdrawInteractive(
    @Request() req: any,
    @Body()
    body: {
      asset_code: string;
      asset_issuer?: string;
      amount?: string;
    },
  ) {
    const account = req.sep10User.account;
    if (!body.asset_code) {
      throw new BadRequestException('asset_code is required');
    }
    return this.sep24Service.createInteractiveSession(
      account,
      'withdraw',
      body.asset_code,
      body.asset_issuer,
      body.amount,
    );
  }

  // ---------------------------------------------------------------------------
  // GET /sep24/transaction — Single transaction lookup
  // ---------------------------------------------------------------------------

  @Get('transaction')
  @UseGuards(Sep10AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get a single SEP-24 transaction by ID' })
  @ApiQuery({ name: 'id', description: 'Transaction ID', required: true })
  @ApiResponse({ status: 200, description: 'SEP-24 transaction details' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async getTransaction(@Request() req: any, @Query('id') id: string) {
    const account = req.sep10User.account;
    if (!id) {
      throw new BadRequestException('id query parameter is required');
    }
    const transaction = await this.sep24Service.getTransactionById(id, account);
    return { transaction };
  }

  // ---------------------------------------------------------------------------
  // GET /sep24/transactions — Transaction history
  // ---------------------------------------------------------------------------

  @Get('transactions')
  @UseGuards(Sep10AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List SEP-24 transactions for the authenticated account' })
  @ApiQuery({ name: 'asset_code', description: 'Filter by asset code', required: false })
  @ApiQuery({ name: 'kind', description: 'Filter by kind (deposit or withdraw)', required: false })
  @ApiQuery({ name: 'limit', description: 'Max results to return', required: false })
  @ApiResponse({ status: 200, description: 'List of SEP-24 transactions' })
  async getTransactions(
    @Request() req: any,
    @Query('asset_code') assetCode?: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ) {
    const account = req.sep10User.account;
    return this.sep24Service.getTransactionsByAccount(
      account,
      assetCode,
      kind,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  // ---------------------------------------------------------------------------
  // GET /sep24/interactive/session — Webview session data
  // ---------------------------------------------------------------------------

  @Get('interactive/session')
  @ApiOperation({ summary: 'Get active interactive session data for the webview' })
  @ApiQuery({ name: 'token', description: 'Session JWT token', required: true })
  @ApiResponse({ status: 200, description: 'Active session details' })
  @ApiResponse({ status: 400, description: 'Session expired or already completed' })
  @ApiResponse({ status: 401, description: 'Invalid session token' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getInteractiveSession(@Query('token') token: string) {
    if (!token) {
      throw new BadRequestException('token query parameter is required');
    }
    return this.sep24Service.getSessionData(token);
  }

  // ---------------------------------------------------------------------------
  // POST /sep24/interactive/confirm — Webview form submission
  // ---------------------------------------------------------------------------

  @Post('interactive/confirm')
  @ApiOperation({ summary: 'Submit KYC data and confirm the interactive session' })
  @ApiResponse({
    status: 200,
    description: 'Session confirmed, transaction moved to pending_user_transfer_start',
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired session' })
  @ApiResponse({ status: 401, description: 'Invalid session token' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async confirmInteractiveSession(
    @Body()
    body: {
      token: string;
      kyc_data: Record<string, unknown>;
      payment_method: string;
      amount?: string;
    },
  ) {
    if (!body.token) {
      throw new BadRequestException('token is required');
    }
    if (!body.kyc_data) {
      throw new BadRequestException('kyc_data is required');
    }
    if (!body.payment_method) {
      throw new BadRequestException('payment_method is required');
    }
    return this.sep24Service.confirmInteractiveSession(
      body.token,
      body.kyc_data,
      body.payment_method,
      body.amount,
    );
  }
}
