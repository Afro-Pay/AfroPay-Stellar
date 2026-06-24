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

export type TransactionStatus = 'PENDING' | 'RETRYING' | 'SUCCESS' | 'FAILED';

export interface Balance {
  asset: string;
  balance: string;
}

export interface Transaction {
  id: string;
  userId: string;
  walletId: string;
  destination: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
  status: TransactionStatus;
  stellarTxHash?: string;
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
