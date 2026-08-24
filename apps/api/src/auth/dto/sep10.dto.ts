import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, IsNotEmpty } from 'class-validator';

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export class Sep10ChallengeQueryDto {
  @ApiProperty({
    description: 'The client Stellar public key (G-address) to issue the challenge for',
    example: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z0-9]{55}$/, {
    message: 'account must be a valid Stellar public key (G-address, 56 characters)',
  })
  account: string;
}

export class Sep10VerifyDto {
  @ApiProperty({
    description:
      'Base64-encoded signed Stellar transaction envelope (XDR). ' +
      'The client must sign the challenge transaction returned by GET /auth/sep10/challenge ' +
      'using their Freighter wallet and submit the signed XDR here.',
    example: 'AAAAAgAAAAB...',
  })
  @IsString()
  @IsNotEmpty()
  transaction: string;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export class Sep10ChallengeResponseDto {
  @ApiProperty({
    description:
      'Base64-encoded unsigned Stellar transaction envelope (XDR). ' +
      'The client must sign this with their Stellar private key and submit it to POST /auth/sep10/verify.',
    example: 'AAAAAgAAAAB...',
  })
  transaction: string;

  @ApiProperty({
    description: 'The Stellar network passphrase the transaction must be signed for',
    example: 'Test SDF Network ; September 2015',
  })
  network_passphrase: string;
}

export class Sep10TokenResponseDto {
  @ApiProperty({
    description: 'JWT access token. Use as Bearer token in Authorization header.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  token: string;

  @ApiProperty({
    description: 'The authenticated Stellar public key',
    example: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
  })
  stellar_account: string;

  @ApiProperty({
    description: 'Token expiry in seconds from now',
    example: 900,
  })
  expires_in: number;
}
