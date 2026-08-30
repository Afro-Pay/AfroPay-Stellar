import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { useWalletStore } from '../store/walletStore';

export interface Balance {
  asset: string;
  balance: string;
}

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

async function fetchBalances(afterTxHash?: string): Promise<Balance[]> {
  const url = afterTxHash ? `/wallet/balances?afterTxHash=${afterTxHash}` : '/wallet/balances';
  const { data } = await api.get(url);
  return (data.balances ?? data) as Balance[];
}

async function fetchTransactions(): Promise<Transaction[]> {
  const { data } = await api.get('/transactions/history');
  return data as Transaction[];
}

export function useBalances(afterTxHash?: string) {
  const queryClient = useQueryClient();
  const cachedBalances = useWalletStore((state) => state.balances);
  const setCachedBalances = useWalletStore((state) => state.setCachedBalances);
  const query = useQuery({
    queryKey: afterTxHash ? ['balances', afterTxHash] : ['balances'],
    queryFn: async () => {
      const balances = await fetchBalances(afterTxHash);
      if (!afterTxHash) setCachedBalances(balances);
      return balances;
    },
    initialData: afterTxHash ? undefined : cachedBalances.length ? cachedBalances : undefined,
    staleTime: 0,
  });
  useEffect(() => {
    if (!afterTxHash && cachedBalances.length && !query.data) {
      queryClient.setQueryData(['balances'], cachedBalances);
    }
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['balances'] });
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [afterTxHash, cachedBalances, query.data, queryClient]);
  return query;
}

export function useTransactions() {
  const queryClient = useQueryClient();
  const cachedTransactions = useWalletStore((state) => state.transactions);
  const setCachedTransactions = useWalletStore((state) => state.setCachedTransactions);
  const query = useQuery({
    queryKey: ['transactions'],
    queryFn: async () => {
      const transactions = await fetchTransactions();
      setCachedTransactions(transactions);
      return transactions;
    },
    initialData: cachedTransactions.length ? cachedTransactions : undefined,
    staleTime: 0,
  });
  useEffect(() => {
    if (cachedTransactions.length && !query.data) {
      queryClient.setQueryData(['transactions'], cachedTransactions);
    }
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['transactions'] });
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [cachedTransactions, query.data, queryClient]);
  return query;
}
