import { Controller, Get, Post, Body, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StellarAddressPipe } from '../common/pipes/stellar-address.pipe';
import { WalletService } from '../wallet/wallet.service';
import { AnchorService } from './anchor.service';

@ApiTags('anchor-auth')
@Controller('anchor/auth')
export class AnchorAuthController {
  constructor(
    private readonly walletService: WalletService,
    private readonly anchorService: AnchorService,
  ) {}

  @Get('challenge')
  @ApiOperation({ summary: 'Get SEP-10 challenge for wallet verification' })
  @ApiResponse({
    status: 200,
    description: 'Challenge generated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async getChallenge(
    @Query('account', StellarAddressPipe) account: string,
  ) {
    // Check if the wallet exists
    const wallet = await this.walletService.findByPublicKey(account);
    if (!wallet) {
      throw new BadRequestException('Wallet not found');
    }

    const nonce = await this.anchorService.issueChallengeNonce(account);
    const challenge = this.generateChallenge(account, nonce);

    return {
      account,
      challenge,
      nonce,
      message: 'Sign this challenge with your Stellar keypair',
    };
  }

  @Post('token')
  @ApiOperation({ summary: 'Exchange challenge for token (SEP-10)' })
  @ApiResponse({
    status: 200,
    description: 'Token generated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid signature or challenge' })
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

    const token = this.generateToken(body.account);

    return {
      token,
      message: 'Token generated successfully',
    };
  }

  private generateChallenge(account: string, nonce: string): string {
    return `stellar:${account}?nonce=${nonce}`;
  }

  private async validateChallenge(
    account: string,
    challenge: string,
    signature: string,
  ): Promise<boolean> {
    const queryString = challenge.includes('?') ? challenge.split('?')[1] : '';
    const params = new URLSearchParams(queryString);
    const nonce = params.get('nonce');
    if (!nonce) {
      return false;
    }

    try {
      await this.anchorService.consumeChallengeNonce(account, nonce);
    } catch {
      return false;
    }

    return this.anchorService.validateChallengeSignature(account, challenge, signature);
  }

  private generateToken(account: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 60 * 60;
    const payload = Buffer.from(JSON.stringify({ sub: account, exp, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
    return `${header}.${payload}.`;
  }
}
