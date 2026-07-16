import { create } from 'zustand';
import api, { SimulationResult } from '../lib/api';

interface Balance { asset: string; balance: string; }

export interface Transaction {
  id: string;
  destination: string;
  amount: string;
  assetCode: string;
  status: string;
  createdAt: string;
  stellarTxHash?: string;
  fee?: string;
  anchorInfo?: string;
}

export interface PaginatedTransactions {
  data: Transaction[];
  nextCursor: string | null;
  total: number;
}

interface WalletStore {
  balances: Balance[];
  transactions: Transaction[];
  /** Cursor to pass on the next fetchTransactions call. null = no more pages. */
  nextCursor: string | null;
  /** Total transaction count reported by the server. */
  totalTransactions: number;
  publicKey: string | null;
  isLoading: boolean;
  error: string | null;
  fetchBalances: (afterTxHash?: string) => Promise<void>;
  /**
   * Fetch a page of transactions.
   * @param cursor  Pass undefined/null for the first page. Pass the value from
   *                nextCursor to load the next page.
   * @param limit   Records per page (default: 25, max: 100).
   * @param replace When true (default on first page), replace the transactions
   *                array. When false, append to the existing list.
   */
  fetchTransactions: (cursor?: string | null, limit?: number, replace?: boolean) => Promise<void>;
  sendTransfer: (data: {
    destinationPublicKey: string;
    amount: string;
    assetCode: string;
    assetIssuer?: string;
    memo?: string;
  }) => Promise<void>;
  simulateTransfer: (data: {
    destinationPublicKey: string;
    amount: string;
    assetCode: string;
    assetIssuer?: string;
  }) => Promise<SimulationResult>;
}

export const useWalletStore = create<WalletStore>((set, get) => ({
  balances: [],
  transactions: [],
  nextCursor: null,
  totalTransactions: 0,
  publicKey: null,
  isLoading: false,
  error: null,

  fetchBalances: async (afterTxHash?: string) => {
    set({ isLoading: true, error: null });
    try {
      const url = afterTxHash
        ? `/wallet/balances?afterTxHash=${afterTxHash}`
        : '/wallet/balances';
      const { data } = await api.get(url);
      set({ balances: data.balances || data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch balances',
      });
    }
  },

  fetchTransactions: async (cursor?: string | null, limit = 25, replace = true) => {
    set({ isLoading: true, error: null });
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (cursor) params.set('cursor', cursor);

      const { data } = await api.get<PaginatedTransactions>(
        `/transactions/history?${params.toString()}`,
      );

      set((state) => ({
        transactions: replace ? data.data : [...state.transactions, ...data.data],
        nextCursor: data.nextCursor,
        totalTransactions: data.total,
        isLoading: false,
      }));
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch transactions',
      });
    }
  },

  sendTransfer: async (payload) => {
    const { data } = await api.post('/transactions/send', payload);
    if (data?.txId) {
      await get().fetchBalances(data.txId);
    } else {
      await get().fetchBalances();
    }
  },

  simulateTransfer: async (payload) => {
    const { data } = await api.post('/transactions/simulate', payload);
    return data;
  },
}));
