import { create } from 'zustand';
import api, { SimulationResult } from '../lib/api';

type WalletAction = 'balances' | 'transactions' | 'send';

interface WalletStore {
  publicKey: string | null;
  balancesError: string | null;
  transactionsError: string | null;
  sendError: string | null;
  isLoadingBalances: boolean;
  isLoadingSend: boolean;

  setPublicKey: (key: string | null) => void;
  setBalancesError: (error: string | null) => void;
  setTransactionsError: (error: string | null) => void;
  setSendError: (error: string | null) => void;
  clearError: (action: WalletAction) => void;
  setBalancesLoading: (isLoading: boolean) => void;
  setSendLoading: (isLoading: boolean) => void;
  sendTransfer: (data: {
    destinationPublicKey: string; amount: string;
    assetCode: string; assetIssuer?: string; memo?: string;
  }) => Promise<{ txId?: string }>;
  simulateTransfer: (data: {
    destinationPublicKey: string;
    amount: string;
    assetCode: string;
    assetIssuer?: string;
  }) => Promise<SimulationResult>;
}

export const useWalletStore = create<WalletStore>((set) => ({
  publicKey: null,
  balancesError: null,
  transactionsError: null,
  sendError: null,
  isLoadingBalances: false,
  isLoadingSend: false,

  setPublicKey: (key) => set({ publicKey: key }),
  setBalancesError: (error) => set({ balancesError: error }),
  setTransactionsError: (error) => set({ transactionsError: error }),
  setSendError: (error) => set({ sendError: error }),
  clearError: (action) => {
    if (action === 'balances') {
      set({ balancesError: null });
      return;
    }

    if (action === 'transactions') {
      set({ transactionsError: null });
      return;
    }

    set({ sendError: null });
  },
  setBalancesLoading: (isLoading) => set({ isLoadingBalances: isLoading }),
  setSendLoading: (isLoading) => set({ isLoadingSend: isLoading }),

  sendTransfer: async (payload) => {
    set({ isLoadingSend: true, sendError: null });

    try {
      const { data } = await api.post('/transactions/send', payload);
      return { txId: data?.txId };
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Transfer failed. Please try again.';
      set({ sendError: message });
      throw error;
    } finally {
      set({ isLoadingSend: false });
    }
  },

  simulateTransfer: async (payload) => {
    const { data } = await api.post('/transactions/simulate', payload);
    return data;
  },

  createWallet: async () => {
    set({ loading: true, error: null });
    try {
      // POST /wallet/create returns { publicKey: string }
      const { data } = await api.post<{ publicKey: string }>('/wallet/create');
      set({ publicKey: data.publicKey, loading: false });
    } catch (err: any) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Failed to create wallet.';
      set({ loading: false, error: message });
    }
  },

  fetchPublicKey: async () => {
    set({ loading: true, error: null });
    try {
      // GET /wallet/public-key returns { publicKey: string }
      // Returns 404 when no wallet exists — expected for new users.
      const { data } = await api.get<{ publicKey: string }>('/wallet/public-key');
      set({ publicKey: data.publicKey, loading: false });
    } catch (err: any) {
      // 404 means the user has no wallet yet — this is an expected state,
      // not an error that should be surfaced in the UI.
      if (err?.response?.status === 404) {
        set({ publicKey: null, loading: false });
      } else {
        const message =
          err?.response?.data?.message ?? err?.message ?? 'Failed to fetch wallet.';
        set({ loading: false, error: message });
      }
    }
  },

  clearError: () => set({ error: null }),
}));
