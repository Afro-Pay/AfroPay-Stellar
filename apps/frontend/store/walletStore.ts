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
  isLoading: boolean;
  error: string | null;
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
  isLoading: false,
  error: null,

  fetchBalances: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await api.get('/wallet/balances');
      set({ balances: data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch balances',
      });
    }
  },

  fetchTransactions: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await api.get('/transactions/history');
      set({ transactions: data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch transactions',
      });
    }
  },

  sendTransfer: async (payload) => {
    await api.post('/transactions/send', payload);
  },
}));
