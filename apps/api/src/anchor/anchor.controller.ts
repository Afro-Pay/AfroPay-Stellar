import { Controller, Get, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WalletService } from '../wallet/wallet.service';
import { AnchorService } from './anchor.service';
import { StellarAddressPipe } from '../common/pipes/stellar-address.pipe';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

@ApiTags('anchor')
@Controller('anchor')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class AnchorController {
  constructor(
    private readonly walletService: WalletService,
    private readonly anchorService: AnchorService,
  ) {}

  @Get('deposit')
  @ApiOperation({ summary: 'Get deposit info from anchor' })
  @ApiQuery({
    name: 'account',
    description: 'Stellar account address',
    type: String,
  })
  @ApiQuery({
    name: 'assetCode',
    description: 'Asset code',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Deposit info retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address' })
  @ApiResponse({ status: 403, description: 'Account does not match user wallet' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 502, description: 'Anchor returned a malformed or inconsistent response' })
  async getDepositInfo(
    @Request() req: any,
    @Query('account', StellarAddressPipe) account: string,
    @Query('assetCode') assetCode: string,
  ) {
    // Ownership check: verify the account matches the user's wallet
    await this.validateAccountOwnership(req.user.userId, account);

    // Proxy to the anchor; the service validates and reconciles the response.
    return this.anchorService.getDepositInfo(assetCode, account);
  }

  @Get('withdraw')
  @ApiOperation({ summary: 'Get withdraw info from anchor' })
  @ApiQuery({
    name: 'account',
    description: 'Stellar account address',
    type: String,
  })
  @ApiQuery({
    name: 'assetCode',
    description: 'Asset code',
    type: String,
  })
  @ApiQuery({
    name: 'amount',
    description: 'Withdrawal amount (reconciled against the anchor min/max)',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Withdraw info retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address or amount out of range' })
  @ApiResponse({ status: 403, description: 'Account does not match user wallet' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 502, description: 'Anchor returned a malformed or inconsistent response' })
  async getWithdrawInfo(
    @Request() req: any,
    @Query('account', StellarAddressPipe) account: string,
    @Query('assetCode') assetCode: string,
    @Query('amount') amount: string,
  ) {
    // Ownership check: verify the account matches the user's wallet
    await this.validateAccountOwnership(req.user.userId, account);

    // Proxy to the anchor; the service validates the response and reconciles the
    // requested amount against the anchor's advertised min/max.
    return this.anchorService.getWithdrawInfo(assetCode, account, amount);
  }

  @Get('fx-rate')
  // FX-rate refreshes fan out to the anchor/Horizon; cap per-user request
  // rate so repeated refreshes from one caller can't exhaust the shared quota.
  @RateLimit({
    keyPrefix: 'anchor:fx-rate',
    limit: 10,
    windowMs: 60_000,
    limitEnv: 'ANCHOR_FX_RATE_RATE_LIMIT_MAX',
    windowMsEnv: 'ANCHOR_FX_RATE_RATE_LIMIT_WINDOW_MS',
  })
  @ApiOperation({ summary: 'Get exchange rate from anchor' })
  @ApiQuery({
    name: 'account',
    description: 'Stellar account address',
    type: String,
  })
  @ApiQuery({
    name: 'type',
    description: 'Transaction type (deposit/withdraw)',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Exchange rate retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address' })
  @ApiResponse({ status: 403, description: 'Account does not match user wallet' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getExchangeRate(
    @Request() req: any,
    @Query('account', StellarAddressPipe) account: string,
    @Query('type') type: string,
  ) {
    // Ownership check: verify the account matches the user's wallet
    await this.validateAccountOwnership(req.user.userId, account);

    // Proceed with the exchange rate request
    return {
      message: 'Exchange rate retrieved',
      account,
      type,
      // Additional exchange rate info would go here
    };
  }

  /**
   * Validates that the account belongs to the user
   * @param userId - The ID of the authenticated user
   * @param account - The Stellar account address to validate
   * @throws {ForbiddenException} If the account doesn't match the user's wallet
   */
  private async validateAccountOwnership(userId: string, account: string): Promise<void> {
    try {
      // Get the user's wallet from the database
      const wallet = await this.walletService.findByUserId(userId);

      if (!wallet || !wallet.publicKey) {
        throw new ForbiddenException('User has no registered wallet');
      }

      // Compare the account with the user's wallet public key
      if (wallet.publicKey !== account) {
        throw new ForbiddenException(
          'Account does not match the user\'s registered wallet',
        );
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new ForbiddenException('Unable to validate account ownership');
    }
  }
}
