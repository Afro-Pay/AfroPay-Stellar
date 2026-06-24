import { IsIn, IsNumberString, Matches } from 'class-validator';

export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
export const SUPPORTED_ANCHOR_ASSETS = ['USDC', 'NGN'] as const;
export const SUPPORTED_FX_ASSETS = ['USD', 'NGN', 'XLM'] as const;
export const POSITIVE_DECIMAL_REGEX = /^(?!0+(?:\.0+)?$)(?:0|[1-9]\d*)(?:\.\d+)?$/;

export class DepositQueryDto {
  @IsIn(SUPPORTED_ANCHOR_ASSETS)
  asset: (typeof SUPPORTED_ANCHOR_ASSETS)[number];

  @Matches(STELLAR_ACCOUNT_REGEX, {
    message: 'account must be a valid Stellar public key',
  })
  account: string;
}

export class WithdrawQueryDto extends DepositQueryDto {
  @IsNumberString({ no_symbols: false }, { message: 'amount must be a decimal string' })
  @Matches(POSITIVE_DECIMAL_REGEX, { message: 'amount must be greater than zero' })
  amount: string;
}

export class FxRateQueryDto {
  @IsIn(SUPPORTED_FX_ASSETS)
  from: (typeof SUPPORTED_FX_ASSETS)[number];

  @IsIn(SUPPORTED_FX_ASSETS)
  to: (typeof SUPPORTED_FX_ASSETS)[number];
}
