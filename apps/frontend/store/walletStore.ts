import { create } from 'zustand';
import api from '../lib/api';

interface Balance { asset: string; balance: string; }
export interface Transaction {
  id: string; destination: string; amount: string;
  assetCode: string; status: string; createdAt: string;
  stellarTxHash?: string; fee?: string; anchorInfo?: string;
}

interface WalletStore {
  balances: Balance[];
  transactions: Transaction[];
  publicKey: string | null;
  fetchBalances: () => Promise<void>;
  fetchTransactions: () => Promise<void>;
  sendTransfer: (data: {
    destinationPublicKey: string; amount: string;
    assetCode: string; assetIssuer?: string; memo?: string;
  }) => Promise<void>;
}

export const useWalletStore = create<WalletStore>((set) => ({
  balances: [],
  transactions: [],
  publicKey: null,

  fetchBalances: async () => {
    const { data } = await api.get('/wallet/balances');
    set({ balances: data });
  },

  fetchTransactions: async () => {
    const { data } = await api.get('/transactions/history');
    set({ transactions: data });
  },

  sendTransfer: async (payload) => {
    await api.post('/transactions/send', payload);
  },
}));
