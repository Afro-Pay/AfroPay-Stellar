import { create } from 'zustand';
import api, { SimulationResult } from '../lib/api';

type WalletAction = 'balances' | 'transactions' | 'send';

export interface Wallet {
  id: string;
  publicKey: string;
  alias: string | null;
  isDefault: boolean;
  createdAt: string;
}

interface WalletStore {
  wallets: Wallet[];
  activeWalletId: string | null;
  publicKey: string | null; // The public key of the active wallet
  balancesError: string | null;
  transactionsError: string | null;
  sendError: string | null;
  isLoadingBalances: boolean;
  isLoadingSend: boolean;
  loading: boolean;
  error: string | null;

  // Wallet management
  setWallets: (wallets: Wallet[]) => void;
  setActiveWalletId: (id: string | null) => void;
  setPublicKey: (key: string | null) => void;

  // Error management
  setBalancesError: (error: string | null) => void;
  setTransactionsError: (error: string | null) => void;
  setSendError: (error: string | null) => void;
  clearError: (action: WalletAction) => void;
  clearWalletError: () => void;
  setBalancesLoading: (isLoading: boolean) => void;
  setSendLoading: (isLoading: boolean) => void;

  // API operations
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
  createWallet: (alias?: string) => Promise<void>;
  fetchWallets: () => Promise<void>;
  switchWallet: (walletId: string) => Promise<void>;
  addWallet: (alias?: string) => Promise<void>;
  removeWallet: (walletId: string) => Promise<void>;
  updateWalletAlias: (walletId: string, alias: string | null) => Promise<void>;

  // Legacy support
  fetchPublicKey: () => Promise<void>;
}

export const useWalletStore = create<WalletStore>((set, get) => ({
  wallets: [],
  activeWalletId: null,
  publicKey: null,
  balancesError: null,
  transactionsError: null,
  sendError: null,
  isLoadingBalances: false,
  isLoadingSend: false,
  loading: false,
  error: null,

  // Wallet management
  setWallets: (wallets) => set({ wallets }),
  setActiveWalletId: (id) => {
    const state = get();
    const wallet = state.wallets.find(w => w.id === id);
    set({ 
      activeWalletId: id,
      publicKey: wallet?.publicKey ?? null 
    });
  },
  setPublicKey: (key) => set({ publicKey: key }),

  // Error management
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
  clearWalletError: () => set({ error: null }),
  setBalancesLoading: (isLoading) => set({ isLoadingBalances: isLoading }),
  setSendLoading: (isLoading) => set({ isLoadingSend: isLoading }),

  // API operations
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

  /**
   * Create the first wallet for a user.
   */
  createWallet: async (alias?: string) => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.post<{ publicKey: string; walletId: string }>('/wallet/create', { alias });
      // After creating, fetch all wallets to update state
      await get().fetchWallets();
    } catch (err: any) {
      const message =
        err?.response?.data?.message ?? err?.message ?? 'Failed to create wallet.';
      set({ loading: false, error: message });
    }
  },

  /**
   * Fetch all wallets for the current user.
   */
  fetchWallets: async () => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.get<Wallet[]>('/wallet/list');
      const defaultWallet = data.find(w => w.isDefault) || data[0];
      set({
        wallets: data,
        activeWalletId: defaultWallet?.id ?? null,
        publicKey: defaultWallet?.publicKey ?? null,
        loading: false,
      });
    } catch (err: any) {
      // 404 means the user has no wallet yet — this is an expected state
      if (err?.response?.status === 404) {
        set({ wallets: [], activeWalletId: null, publicKey: null, loading: false });
      } else {
        const message =
          err?.response?.data?.message ?? err?.message ?? 'Failed to fetch wallets.';
        set({ loading: false, error: message });
      }
    }
  },

  /**
   * Switch to a different wallet.
   */
  switchWallet: async (walletId: string) => {
    set({ loading: true, error: null });
    try {
      await api.post(`/wallet/${walletId}/set-default`);
      const wallet = get().wallets.find(w => w.id === walletId);
      if (wallet) {
        get().setActiveWalletId(walletId);
      }
      set({ loading: false });
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Failed to switch wallet.';
      set({ loading: false, error: message });
    }
  },

  /**
   * Add a new wallet.
   */
  addWallet: async (alias?: string) => {
    set({ loading: true, error: null });
    try {
      await api.post('/wallet/add', { alias });
      await get().fetchWallets();
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Failed to add wallet.';
      set({ loading: false, error: message });
    }
  },

  /**
   * Remove a wallet.
   */
  removeWallet: async (walletId: string) => {
    set({ loading: true, error: null });
    try {
      await api.delete(`/wallet/${walletId}`);
      await get().fetchWallets();
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Failed to remove wallet.';
      set({ loading: false, error: message });
    }
  },

  /**
   * Update a wallet's alias.
   */
  updateWalletAlias: async (walletId: string, alias: string | null) => {
    set({ error: null });
    try {
      await api.put(`/wallet/${walletId}/alias`, { alias });
      const wallets = get().wallets.map(w =>
        w.id === walletId ? { ...w, alias } : w
      );
      set({ wallets });
    } catch (err: any) {
      const message = err?.response?.data?.message ?? 'Failed to update wallet alias.';
      set({ error: message });
    }
  },

  // Legacy support
  fetchPublicKey: async () => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.get<{ publicKey: string; walletId: string }>('/wallet/public-key');
      set({ publicKey: data.publicKey, loading: false });
    } catch (err: any) {
      if (err?.response?.status === 404) {
        set({ publicKey: null, loading: false });
      } else {
        const message =
          err?.response?.data?.message ?? err?.message ?? 'Failed to fetch wallet.';
        set({ loading: false, error: message });
      }
    }
  },
}));

