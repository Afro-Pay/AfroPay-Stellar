import { create } from 'zustand';
import api, { SimulationResult } from '../lib/api';

interface WalletStore {
  publicKey: string | null;
  setPublicKey: (key: string | null) => void;
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
  setPublicKey: (key) => set({ publicKey: key }),

  sendTransfer: async (payload) => {
    const { data } = await api.post('/transactions/send', payload);
    return { txId: data?.txId };
  },

  simulateTransfer: async (payload) => {
    const { data } = await api.post('/transactions/simulate', payload);
    return data;
  },
}));
