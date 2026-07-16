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
  fetchBalances: (afterTxHash?: string) => Promise<void>;
  fetchTransactions: () => Promise<void>;
  sendTransfer: (data: {
    destinationPublicKey: string; amount: string;
    assetCode: string; assetIssuer?: string; memo?: string;
  }) => Promise<void>;
}

export const useWalletStore = create<WalletStore>((set, get) => ({
  balances: [],
  transactions: [],
  publicKey: null,
  isLoading: false,
  error: null,

  fetchBalances: async (afterTxHash?: string) => {
    set({ isLoading: true, error: null });
    try {
      const url = afterTxHash ? `/wallet/balances?afterTxHash=${afterTxHash}` : '/wallet/balances';
      const { data } = await api.get(url);
      set({ balances: data.balances || data, isLoading: false });
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
    const { data } = await api.post('/transactions/send', payload);
    // After successful transfer, poll for updated balance using txId as afterTxHash
    if (data?.txId) {
      await get().fetchBalances(data.txId);
    } else {
      await get().fetchBalances();
    }
  },
}));
