import React, { useState, useMemo } from 'react';
import { useTransactions } from '../hooks/useWalletData';
import TransactionFilters, {
  DEFAULT_FILTERS,
  filterTransactions,
  type TransactionFilterState,
} from './TransactionFilters';
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

  const [filters, setFilters] = useState<TransactionFilterState>(DEFAULT_FILTERS);

  const handleFilterChange = (patch: Partial<TransactionFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
  };

  // Derive the set of asset codes present in the fetched transactions.
  const availableAssets = useMemo(() => {
    const assets = new Set<string>();
    transactions.forEach((tx) => {
      if (tx.assetCode) assets.add(tx.assetCode);
    });
    return Array.from(assets).sort();
  }, [transactions]);

  // Client-side filtering of the current server page.
  const filteredTransactions = useMemo(
    () => filterTransactions(transactions, filters),
    [transactions, filters],
  );

  const hasActiveFilters = useMemo(
    () =>
      JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS),
    [filters],
  );


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
        filters={filters}
        availableAssets={availableAssets}
        onChange={handleFilterChange}
        onReset={handleReset}
      />

      {filteredTransactions.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 flex flex-col items-center justify-center text-center min-h-[40vh]">
          <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
            <Inbox className="w-8 h-8 text-gray-500" aria-hidden="true" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">No Transactions Found</h3>
          <p className="text-gray-400 max-w-sm">
            {hasActiveFilters
              ? "We couldn't find any transactions matching your current filters. Try adjusting them or clear all filters."
              : "You don't have any transactions yet."}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleReset}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Clear filters
            </button>
          )}
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
