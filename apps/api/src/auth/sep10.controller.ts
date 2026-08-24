import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { Sep10Service } from './sep10.service';
import {
  Sep10ChallengeQueryDto,
  Sep10ChallengeResponseDto,
  Sep10VerifyDto,
  Sep10TokenResponseDto,
} from './dto/sep10.dto';

/**
 * SEP-10 Web Authentication endpoints.
 *
 * Standard flow:
 *   1. GET  /api/auth/sep10/challenge?account=G...  → returns unsigned challenge XDR
 *   2. Client signs the XDR with Freighter wallet
 *   3. POST /api/auth/sep10/verify  { transaction: "<signed-xdr>" } → returns JWT
 */
@ApiTags('sep10-auth')
@Controller('auth/sep10')
export class Sep10Controller {
  constructor(private readonly sep10Service: Sep10Service) {}

  // ---------------------------------------------------------------------------
  // Challenge
  // ---------------------------------------------------------------------------

  @Get('challenge')
  @ApiOperation({
    summary: 'Generate a SEP-10 authentication challenge',
    description:
      'Returns an unsigned Stellar transaction containing a one-time nonce. ' +
      'The client must sign this with their Stellar wallet and submit it to POST /auth/sep10/verify. ' +
      'The challenge expires after 5 minutes.',
  })
  @ApiQuery({
    name: 'account',
    description: 'The client Stellar public key (G-address) to issue a challenge for',
    example: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Challenge transaction generated successfully',
    type: Sep10ChallengeResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar public key' })
  @ApiResponse({ status: 429, description: 'Too many challenge requests' })
  async getChallenge(
    @Query() query: Sep10ChallengeQueryDto,
  ): Promise<Sep10ChallengeResponseDto> {
    return this.sep10Service.generateChallenge(query.account);
  }

  // ---------------------------------------------------------------------------
  // Verify & issue token
  // ---------------------------------------------------------------------------

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a signed SEP-10 challenge and issue a JWT',
    description:
      'Accepts a base64-encoded signed Stellar transaction envelope. ' +
      'Verifies the client and server signatures, nonce freshness, and replay protection. ' +
      'On success, returns a JWT that can be used as a Bearer token.',
  })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful — JWT issued',
    type: Sep10TokenResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Malformed or invalid transaction XDR' })
  @ApiResponse({ status: 401, description: 'Signature invalid, nonce expired, or replay detected' })
  async verify(
    @Body() body: Sep10VerifyDto,
  ): Promise<Sep10TokenResponseDto> {
    const result = await this.sep10Service.verifyAndIssueToken(body.transaction);
    return {
      token: result.token,
      stellar_account: result.stellar_account,
      expires_in: result.expires_in,
    };
  }

  // ---------------------------------------------------------------------------
  // Server info (TOML / .well-known helper)
  // ---------------------------------------------------------------------------

  @Get('info')
  @ApiOperation({
    summary: 'Get SEP-10 server public key and configuration',
    description: 'Returns the server signing public key and home domain for client-side TOML discovery.',
  })
  @ApiResponse({ status: 200, description: 'Server info' })
  getServerInfo() {
    return {
      server_signing_key: this.sep10Service.getServerPublicKey(),
      home_domain: process.env.SEP10_HOME_DOMAIN ?? 'localhost',
      network_passphrase:
        process.env.STELLAR_NETWORK === 'mainnet'
          ? 'Public Global Stellar Network ; September 2015'
          : 'Test SDF Network ; September 2015',
    };
  }
}
