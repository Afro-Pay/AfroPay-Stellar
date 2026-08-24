import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * SEP-6 `GET /withdraw` response.
 *
 * As with deposits, SEP-6 fields are individually optional (success, or a
 * `non_interactive_customer_info_needed` variant), so validation enforces field
 * types; a non-object response or a wrong-typed field is treated as malformed.
 *
 * `account_id` is the anchor's *own* receiving account (where the user sends the
 * withdrawal), not the user's wallet — so it is deliberately not reconciled
 * against the caller. AnchorService instead reconciles the requested amount
 * against `min_amount`/`max_amount`.
 */
export class WithdrawResponseDto {
  @ApiPropertyOptional({
    description: 'Anchor transaction ID',
    example: 'anchor-withdraw-xyz789',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    description: 'Estimated seconds until withdrawal completes',
    example: 7200,
  })
  @IsOptional()
  @IsNumber()
  eta?: number;

  @ApiPropertyOptional({
    description: 'Minimum withdrawal amount',
    example: 20,
  })
  @IsOptional()
  @IsNumber()
  min_amount?: number;

  @ApiPropertyOptional({
    description: 'Maximum withdrawal amount',
    example: 50000,
  })
  @IsOptional()
  @IsNumber()
  max_amount?: number;

  @ApiPropertyOptional({
    description: 'Fixed fee amount',
    example: 2.0,
  })
  @IsOptional()
  @IsNumber()
  fee_fixed?: number;

  @ApiPropertyOptional({
    description: 'Percentage fee (0-100)',
    example: 1.0,
  })
  @IsOptional()
  @IsNumber()
  fee_percent?: number;

  @ApiPropertyOptional({
    description: 'Additional withdrawal information',
    example: { bank_name: 'Example Bank', swift_code: 'EXAMPUS33' },
  })
  @IsOptional()
  @IsObject()
  extra_info?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: "Anchor's Stellar account to send withdrawal to",
    example: 'GANCHORACCOUNTADDRESS1234567890',
  })
  @IsOptional()
  @IsString()
  account_id?: string;

  @ApiPropertyOptional({
    description: 'Memo to include with withdrawal transaction',
    example: 'WD-123456',
  })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiPropertyOptional({
    description: 'Memo type (text, id, hash)',
    example: 'text',
    enum: ['text', 'id', 'hash'],
  })
  @IsOptional()
  @IsString()
  memo_type?: string;

  @ApiPropertyOptional({
    description: 'Response type (e.g., non_interactive_customer_info_needed)',
    example: 'non_interactive_customer_info_needed',
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    description: 'Required customer info fields',
    example: { bank_account: { type: 'string', description: 'Bank account number' } },
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}
