export type Currency = 'XLM' | 'USDC' | 'NGN' | 'EUR';

export interface WalletBalance {
  currency: Currency;
  code: string;
  amount: number;
  assetIssuer?: string;
  usdEquivalent: number;
  trustlineEstablished: boolean;
}

export interface UserWallet {
  publicKey: string;
  secretKeyEncrypted: string;
  network: 'testnet' | 'public';
  balances: WalletBalance[];
  sequenceNumber: string;
  subentryCount: number;
}

export type TransactionStatus = 'PENDING' | 'QUEUED' | 'RETRYING' | 'SUCCESS' | 'FAILED';

export interface TransactionRecord {
  id: string;
  txHash?: string;
  type: 'TRANSFER' | 'DEPOSIT' | 'WITHDRAWAL' | 'TRUSTLINE';
  senderPublicKey: string;
  recipientPublicKey: string;
  recipientName: string;
  sendAmount: number;
  sendCurrency: Currency;
  receiveAmount: number;
  receiveCurrency: Currency;
  exchangeRate: number;
  feeUsd: number;
  stellarFeeXlm: number;
  status: TransactionStatus;
  createdAt: string;
  memo?: string;
  riskScore: number;
  flagged: boolean;
  pathUsed?: string[];
  callbackUrl?: string;
  callbackStatus?: 'PENDING' | 'DELIVERED' | 'FAILED';
}

export interface FXQuote {
  sourceCurrency: Currency;
  destinationCurrency: Currency;
  rate: number;
  estimatedFeeUsd: number;
  pathPaymentRequired: boolean;
  intermediatePaths: string[];
  expiresAt: number;
}

export interface KYCTierInfo {
  tier: 'Tier 0' | 'Tier 1' | 'Tier 2' | 'Tier 3';
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  status: 'VERIFIED' | 'PENDING' | 'ACTION_REQUIRED';
  requirementsMet: string[];
  pendingRequirements: string[];
}

export interface AnchorProvider {
  id: string;
  name: string;
  assetCode: Currency;
  domain: string;
  sepVersions: string[];
  supportedBanks: string[];
  minAmountUsd: number;
  maxAmountUsd: number;
  feePercentage: number;
}

export interface SSELogEvent {
  id: string;
  timestamp: string;
  txId: string;
  step: string;
  status: TransactionStatus;
  message: string;
  stellarHash?: string;
}
