export type CurrencyCode = 'XLM' | 'USDC' | 'NGN' | 'EUR';

export interface AssetBalance {
  code: CurrencyCode;
  name: string;
  symbol: string;
  balance: number;
  usdValue: number;
  trustlineActive: boolean;
  issuer?: string;
  flag: string;
}

export interface WalletState {
  publicKey: string;
  secretKeyEncrypted: string;
  sequenceNumber: string;
  isFunded: boolean;
  balances: Record<CurrencyCode, AssetBalance>;
  createdAt: string;
}

export interface TransferQuote {
  fromCurrency: CurrencyCode;
  fromAmount: number;
  toCurrency: CurrencyCode;
  estimatedToAmount: number;
  fxRate: number;
  inverseFxRate: number;
  pathRoute: string[];
  stellarFeeXLM: number;
  anchorFeeUSD: number;
  totalFeeUSD: number;
  estimatedDurationSeconds: number;
  expiresAt: number;
  corridor: string;
}

export interface RecipientInfo {
  name: string;
  email?: string;
  country: string;
  countryFlag: string;
  payoutMethod: 'bank_account' | 'mobile_money' | 'stellar_address';
  bankName?: string;
  accountNumber?: string;
  mobileProvider?: string;
  stellarAddress?: string;
}

export type TransactionType = 'transfer' | 'deposit' | 'withdrawal' | 'anchor_sep24';
export type TransactionStatus = 'pending' | 'settling' | 'settled' | 'failed' | 'flagged';

export interface TransactionRecord {
  id: string;
  type: TransactionType;
  sourceCurrency: CurrencyCode;
  sourceAmount: number;
  destCurrency: CurrencyCode;
  destAmount: number;
  fxRate: number;
  feeUSD: number;
  recipient: RecipientInfo;
  status: TransactionStatus;
  stellarTxHash?: string;
  anchorName?: string;
  createdAt: string;
  completedAt?: string;
  riskScore: number; // 0-100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  memo?: string;
}

export interface FXRateInfo {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number;
  change24h: number;
  updatedAt: string;
}

export interface KYCTierInfo {
  tier: 1 | 2 | 3;
  title: string;
  dailyLimitUSD: number;
  monthlyLimitUSD: number;
  requirements: string[];
  status: 'verified' | 'pending' | 'unverified';
}

export interface AnchorPartner {
  id: string;
  name: string;
  country: string;
  flag: string;
  supportedCurrencies: CurrencyCode[];
  feePercentage: number;
  avgProcessTime: string;
  logoUrl?: string;
  status: 'online' | 'degraded';
}
