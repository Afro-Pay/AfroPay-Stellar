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
  /** Anchor transaction id. */
  @IsOptional()
  @IsString()
  id?: string;

  /** Estimated seconds until the withdrawal completes. */
  @IsOptional()
  @IsNumber()
  eta?: number;

  @IsOptional()
  @IsNumber()
  min_amount?: number;

  @IsOptional()
  @IsNumber()
  max_amount?: number;

  @IsOptional()
  @IsNumber()
  fee_fixed?: number;

  @IsOptional()
  @IsNumber()
  fee_percent?: number;

  @IsOptional()
  @IsObject()
  extra_info?: Record<string, unknown>;

  /** The anchor's Stellar account the user must send the withdrawal to. */
  @IsOptional()
  @IsString()
  account_id?: string;

  @IsOptional()
  @IsString()
  memo?: string;

  @IsOptional()
  @IsString()
  memo_type?: string;

  /** `non_interactive_customer_info_needed` variant. */
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}
