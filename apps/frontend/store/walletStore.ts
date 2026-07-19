import { create } from 'zustand';
import api from '../lib/api';

interface Balance {
  asset: string;
  balance: string;
}

interface Transaction {
  id: string;
  destination: string;
  amount: string;
  assetCode: string;
  status: string;
  createdAt: string;
}

interface WalletStore {
  balances: Balance[];
  transactions: Transaction[];
  /** Stellar public key for the authenticated user, or null if no wallet yet. */
  publicKey: string | null;
  /** True while any async wallet operation is in flight. */
  loading: boolean;
  /** Last error message from a wallet operation, or null. */
  error: string | null;

  fetchBalances: () => Promise<void>;
  fetchTransactions: () => Promise<void>;
  sendTransfer: (data: {
    destinationPublicKey: string;
    amount: string;
    assetCode: string;
    assetIssuer?: string;
    memo?: string;
  }) => Promise<void>;

  /**
   * Call POST /wallet/create to generate a new Stellar keypair on the
   * backend and persist the public key in store state.
   */
  createWallet: () => Promise<void>;

  /**
   * Retrieve only the public key for the current user from GET /wallet/public-key.
   * Returns 404 when no wallet exists — the store sets publicKey to null in
   * that case so the WalletSetup onboarding prompt is shown automatically.
   * Intended to be called once on Dashboard mount.
   */
  fetchPublicKey: () => Promise<void>;

  /** Clear any stored error message. */
  clearError: () => void;
}

export const useWalletStore = create<WalletStore>((set) => ({
  balances: [],
  transactions: [],
  publicKey: null,
  loading: false,
  error: null,

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
