import React, { useEffect, useState, useMemo } from 'react';
import { useWalletStore } from '../store/walletStore';
import TransactionFilters from './TransactionFilters';
import TransactionRow from './TransactionRow';
import { Loader2, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

/**
 * Number of records fetched from the server per page.
 * Kept at 25 to match the API default; filters operate on the current page only.
 */
const PAGE_SIZE = 25;

export default function TransactionDashboard() {
  const {
    transactions,
    nextCursor,
    totalTransactions,
    fetchTransactions,
    isLoading,
  } = useWalletStore();

  // Stack of cursors used to navigate backwards. Index 0 = first page (no cursor).
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);

  const [statusFilter, setStatusFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [dateRangeFilter, setDateRangeFilter] = useState('all');

  // Load the first page on mount.
  useEffect(() => {
    fetchTransactions(null, PAGE_SIZE, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset to page 1 when filters change — the current page may no longer be
  // meaningful after a filter switch, and we already have its data locally.
  useEffect(() => {
    setPageIndex(0);
    setCursorHistory([null]);
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

  const currentPage = pageIndex + 1;
  // Total pages is derived from the server-reported total.
  const totalPages = Math.max(1, Math.ceil(totalTransactions / PAGE_SIZE));
  const isFirstPage = pageIndex === 0;
  const isLastPage = nextCursor === null;

  const handleNextPage = async () => {
    if (!nextCursor) return;
    const newPageIndex = pageIndex + 1;
    // Extend cursor history if we're moving to a page we haven't visited yet.
    const newHistory = [...cursorHistory];
    if (newHistory.length <= newPageIndex) {
      newHistory.push(nextCursor);
    }
    setCursorHistory(newHistory);
    setPageIndex(newPageIndex);
    await fetchTransactions(nextCursor, PAGE_SIZE, true);
  };

  const handlePrevPage = async () => {
    if (pageIndex === 0) return;
    const prevPageIndex = pageIndex - 1;
    setPageIndex(prevPageIndex);
    // Cursor for the previous page is already stored in cursorHistory.
    await fetchTransactions(cursorHistory[prevPageIndex], PAGE_SIZE, true);
  };

  if (isLoading && transactions.length === 0) {
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
        <>
          {/* Show a subtle loading overlay while fetching the next page */}
          <div className={`space-y-3 relative ${isLoading ? 'opacity-60 pointer-events-none' : ''}`}>
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" aria-hidden="true" />
              </div>
            )}
            {filteredTransactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </div>

          <div
            className="mt-8 flex flex-col sm:flex-row items-center justify-between border-t border-gray-800 pt-6 gap-4"
            aria-label="Pagination"
          >
            <p className="text-sm text-gray-400">
              Page{' '}
              <span className="font-medium text-white">{currentPage}</span>
              {' '}of{' '}
              <span className="font-medium text-white">{totalPages}</span>
              {' '}·{' '}
              <span className="font-medium text-white">{totalTransactions}</span> total
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={isFirstPage || isLoading}
                aria-label={`Go to previous page, page ${Math.max(1, currentPage - 1)}`}
                className="px-4 py-2 bg-gray-900 border border-gray-800 text-sm font-medium rounded-lg text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous
              </button>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={isLastPage || isLoading}
                aria-label={`Go to next page, page ${currentPage + 1}`}
                className="px-4 py-2 bg-gray-900 border border-gray-800 text-sm font-medium rounded-lg text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                Next <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
