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
  /** Deprecated free-text deposit instructions. */
  @IsOptional()
  @IsString()
  how?: string;

  /** Anchor transaction id. */
  @IsOptional()
  @IsString()
  id?: string;

  /** Estimated seconds until the deposit completes. */
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

  /** Structured deposit instructions (newer SEP-6). */
  @IsOptional()
  @IsObject()
  instructions?: Record<string, unknown>;

  /** Account fields some anchors echo; reconciled against the request. */
  @IsOptional()
  @IsString()
  stellar_account?: string;

  @IsOptional()
  @IsString()
  account?: string;

  @IsOptional()
  @IsString()
  account_id?: string;

  /** `non_interactive_customer_info_needed` variant. */
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}
