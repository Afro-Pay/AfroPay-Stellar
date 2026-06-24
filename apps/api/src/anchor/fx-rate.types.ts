export type SupportedFiatCurrency = "USD" | "USDC" | "NGN";
export type SupportedOnchainCurrency = "XLM";

export type FxRatePair =
  | "XLM-USD"
  | "USD-NGN"
  | "NGN-USD"
  | "USDC-NGN"
  | "XLM-NGN"
  | "XLM-USDC"
  | "USD-USDC"
  | "NGN-USDC";

export interface FxRateResponse {
  rate: number;
  from: string;
  to: string;
  provider: string;
  timestamp: string; // ISO8601
}
