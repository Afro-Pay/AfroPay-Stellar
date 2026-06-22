export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface Wallet {
  id: string;
  userId: string;
  publicKey: string;
  createdAt: string;
}

export interface Balance {
  asset: string;
  balance: string;
}

export interface Transaction {
  id: string;
  userId: string;
  destination: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
  status: 'PENDING' | 'RETRYING' | 'SUCCESS' | 'FAILED';
  stellarTxHash?: string;
  retryAttempts: number;
  lastFailureReason?: string;
  failedAt?: string;
  riskScore?: number;
  flagged: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SendTransferPayload {
  destinationPublicKey: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
}
