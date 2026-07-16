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

export interface PaginatedTransactions {
  data: Transaction[];
  nextCursor: string | null;
  total: number;
}

export interface TransactionFilters {
  status?: string;
  currency?: string;
  dateRange?: string;
  cursor?: string;
  limit?: number;
}

async function fetchBalances(afterTxHash?: string): Promise<Balance[]> {
  const url = afterTxHash ? `/wallet/balances?afterTxHash=${afterTxHash}` : '/wallet/balances';
  const { data } = await api.get(url);
  return (data.balances ?? data) as Balance[];
}

async function fetchTransactions(filters: TransactionFilters = {}): Promise<PaginatedTransactions> {
  const params: Record<string, string> = {};
  if (filters.status && filters.status !== 'all') params['status'] = filters.status;
  if (filters.currency && filters.currency !== 'all') params['currency'] = filters.currency;
  if (filters.dateRange && filters.dateRange !== 'all') params['dateRange'] = filters.dateRange;
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit != null) params['limit'] = String(filters.limit);

  const { data } = await api.get('/transactions/history', { params });

  // Normalise: the API returns { data, nextCursor, total }. Guard against a
  // plain array response for backward-compat with any older API version.
  if (Array.isArray(data)) {
    return { data: data as Transaction[], nextCursor: null, total: (data as Transaction[]).length };
  }
  return data as PaginatedTransactions;
}

export function useBalances(afterTxHash?: string) {
  return useQuery({
    queryKey: afterTxHash ? ['balances', afterTxHash] : ['balances'],
    queryFn: () => fetchBalances(afterTxHash),
  });
}

export function useTransactions(filters: TransactionFilters = {}) {
  return useQuery({
    // Include all filter values in the query key so React Query re-fetches
    // automatically whenever any filter or cursor changes.
    queryKey: [
      'transactions',
      filters.status ?? 'all',
      filters.currency ?? 'all',
      filters.dateRange ?? 'all',
      filters.cursor ?? null,
      filters.limit ?? 25,
    ],
    queryFn: () => fetchTransactions(filters),
  });
}
