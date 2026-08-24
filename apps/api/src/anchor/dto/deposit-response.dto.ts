import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * SEP-6 `GET /deposit` response.
 *
 * Per SEP-6 the fields are individually optional (a success response, or a
 * `non_interactive_customer_info_needed` variant), so validation enforces the
 * *types* of whatever the anchor returns rather than presence. A response that
 * is not a JSON object, or that carries a wrong-typed field, is treated as
 * malformed by AnchorService.
 *
 * Note on reconciliation: SEP-6 deposit responses do not reliably echo the
 * user's Stellar account. When the anchor does echo it (`stellar_account` /
 * `account` / `account_id`), AnchorService reconciles it against the requested
 * account so a compromised anchor cannot silently redirect the credit.
 */
export class DepositResponseDto {
  @ApiPropertyOptional({
    description: 'Deprecated free-text deposit instructions',
    example: 'Wire transfer to account: 1234567890',
  })
  @IsOptional()
  @IsString()
  how?: string;

  @ApiPropertyOptional({
    description: 'Anchor transaction ID',
    example: 'anchor-tx-abc123',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    description: 'Estimated seconds until deposit completes',
    example: 3600,
  })
  @IsOptional()
  @IsNumber()
  eta?: number;

  @ApiPropertyOptional({
    description: 'Minimum deposit amount',
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  min_amount?: number;

  @ApiPropertyOptional({
    description: 'Maximum deposit amount',
    example: 10000,
  })
  @IsOptional()
  @IsNumber()
  max_amount?: number;

  @ApiPropertyOptional({
    description: 'Fixed fee amount',
    example: 1.5,
  })
  @IsOptional()
  @IsNumber()
  fee_fixed?: number;

  @ApiPropertyOptional({
    description: 'Percentage fee (0-100)',
    example: 0.5,
  })
  @IsOptional()
  @IsNumber()
  fee_percent?: number;

  @ApiPropertyOptional({
    description: 'Additional deposit information',
    example: { memo: 'ABC123', memo_type: 'text' },
  })
  @IsOptional()
  @IsObject()
  extra_info?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Structured deposit instructions (newer SEP-6)',
    example: { bank_account: '1234567890', routing_number: '987654321' },
  })
  @IsOptional()
  @IsObject()
  instructions?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Stellar account address (reconciled against request)',
    example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
  })
  @IsOptional()
  @IsString()
  stellar_account?: string;

  @ApiPropertyOptional({
    description: 'Account field echoed by anchor',
    example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
  })
  @IsOptional()
  @IsString()
  account?: string;

  @ApiPropertyOptional({
    description: 'Account ID field echoed by anchor',
    example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
  })
  @IsOptional()
  @IsString()
  account_id?: string;

  @ApiPropertyOptional({
    description: 'Response type (e.g., non_interactive_customer_info_needed)',
    example: 'non_interactive_customer_info_needed',
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    description: 'Required customer info fields',
    example: { email_address: { type: 'string', description: 'Email address' } },
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}
