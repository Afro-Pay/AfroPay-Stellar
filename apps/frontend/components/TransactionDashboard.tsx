import React, { useEffect, useState, useMemo } from 'react';
import { useTransactions } from '../hooks/useWalletData';
import TransactionFilters from './TransactionFilters';
import TransactionRow from './TransactionRow';
import { Loader2, Inbox } from 'lucide-react';
import WalletCacheStatus from './WalletCacheStatus';
import { useWalletStore } from '../store/walletStore';

/**
 * Number of records fetched from the server per page.
 * Kept at 25 to match the API default; filters operate on the current page only.
 */
const PAGE_SIZE = 25;

export default function TransactionDashboard() {
  const { data: transactions = [], isLoading: loading } = useTransactions();
  const transactionsUpdatedAt = useWalletStore((state) => state.transactionsUpdatedAt);

  const [statusFilter, setStatusFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [dateRangeFilter, setDateRangeFilter] = useState('all');

  // Reset filters when component mounts to ensure clean state
  useEffect(() => {
    // No-op: just ensuring filters are in consistent state
  }, [statusFilter, currencyFilter, dateRangeFilter]);

  // Client-side filtering of the current server page.
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      if (currencyFilter !== 'all' && tx.assetCode !== currencyFilter) return false;
      if (dateRangeFilter !== 'all') {
        const txDate = new Date(tx.createdAt).getTime();
        const now = Date.now();
        const diffDays = (now - txDate) / (1000 * 3600 * 24);
        if (dateRangeFilter === '7d' && diffDays > 7) return false;
        if (dateRangeFilter === '30d' && diffDays > 30) return false;
      }
      return true;
    });
  }, [transactions, statusFilter, currencyFilter, dateRangeFilter]);


  if (loading && transactions.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-24 min-h-[50vh]"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" aria-hidden="true" />
        <p className="text-gray-400">Loading your transactions...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Transaction History</h1>
        <p className="text-gray-400">View and manage all your remittance activities.</p>
        <WalletCacheStatus updatedAt={transactionsUpdatedAt} />
      </div>

      <TransactionFilters
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        currencyFilter={currencyFilter}
        setCurrencyFilter={setCurrencyFilter}
        dateRangeFilter={dateRangeFilter}
        setDateRangeFilter={setDateRangeFilter}
      />

      {filteredTransactions.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 flex flex-col items-center justify-center text-center min-h-[40vh]">
          <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
            <Inbox className="w-8 h-8 text-gray-500" aria-hidden="true" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">No Transactions Found</h3>
          <p className="text-gray-400 max-w-sm">
            We couldn&apos;t find any transactions matching your current filters. Try adjusting
            them or clear all filters.
          </p>
        </div>
      ) : (
        <div className={`space-y-3 relative ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" aria-hidden="true" />
            </div>
          )}
          {filteredTransactions.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} />
          ))}
        </div>
      )}
    </div>
  );
}
