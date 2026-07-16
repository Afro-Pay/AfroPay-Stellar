import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

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
  return useQuery({
    queryKey: afterTxHash ? ['balances', afterTxHash] : ['balances'],
    queryFn: () => fetchBalances(afterTxHash),
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: ['transactions'],
    queryFn: fetchTransactions,
  });
}
