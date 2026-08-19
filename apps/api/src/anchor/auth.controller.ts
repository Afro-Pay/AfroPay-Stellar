import { Controller, Get, Post, Body, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StellarAddressPipe } from '../common/pipes/stellar-address.pipe';
import { WalletService } from '../wallet/wallet.service';
import { RateLimit } from '../rate-limit/rate-limit.decorator';

@ApiTags('anchor-auth')
@Controller('anchor/auth')
export class AnchorAuthController {
  constructor(
    private readonly walletService: WalletService,
  ) {}

  @Get('challenge')
  // Unauthenticated SEP-10 endpoint: limit per source IP since there is no
  // user identity yet to key the bucket on.
  @RateLimit({
    keyPrefix: 'anchor:auth:challenge',
    limit: 20,
    windowMs: 60_000,
    limitEnv: 'ANCHOR_AUTH_RATE_LIMIT_MAX',
    windowMsEnv: 'ANCHOR_AUTH_RATE_LIMIT_WINDOW_MS',
  })
  @ApiOperation({ summary: 'Get SEP-10 challenge for wallet verification' })
  @ApiResponse({
    status: 200,
    description: 'Challenge generated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getChallenge(
    @Query('account', StellarAddressPipe) account: string,
  ) {
    // Check if the wallet exists
    const wallet = await this.walletService.findByPublicKey(account);
    if (!wallet) {
      throw new BadRequestException('Wallet not found');
    }

    // Generate a challenge for SEP-10
    const challenge = this.generateChallenge(account);

    return {
      account,
      challenge,
      message: 'Sign this challenge with your Stellar keypair',
    };
  }

  @Post('token')
  // Unauthenticated SEP-10 endpoint: limit per source IP since there is no
  // user identity yet to key the bucket on. Shares its budget with
  // /challenge via ANCHOR_AUTH_RATE_LIMIT_* but uses a distinct key prefix
  // so the two endpoints don't share the same bucket.
  @RateLimit({
    keyPrefix: 'anchor:auth:token',
    limit: 20,
    windowMs: 60_000,
    limitEnv: 'ANCHOR_AUTH_RATE_LIMIT_MAX',
    windowMsEnv: 'ANCHOR_AUTH_RATE_LIMIT_WINDOW_MS',
  })
  @ApiOperation({ summary: 'Exchange challenge for token (SEP-10)' })
  @ApiResponse({
    status: 200,
    description: 'Token generated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid signature or challenge' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getToken(
    @Body() body: {
      account: string;
      challenge: string;
      signature: string;
    },
  ) {
    // Validate the challenge signature
    const isValid = await this.validateChallenge(
      body.account,
      body.challenge,
      body.signature,
    );

    if (!isValid) {
      throw new BadRequestException('Invalid challenge signature');
    }

    // Generate a JWT token for the wallet
    const token = this.generateToken(body.account);

    return {
      token,
      message: 'Token generated successfully',
    };
  }

  private generateChallenge(account: string): string {
    // In a real implementation, this would create a proper SEP-10 challenge
    // For now, we return a placeholder
    return `stellar:${account}?nonce=${Date.now()}`;
  }

  private async validateChallenge(
    account: string,
    challenge: string,
    signature: string,
  ): Promise<boolean> {
    // In a real implementation, this would verify the signature
    // For now, we return true for demonstration
    return true;
  }

  private generateToken(account: string): string {
    // In a real implementation, this would generate a JWT
    // For now, we return a placeholder
    return `jwt_token_for_${account}`;
  }
}
