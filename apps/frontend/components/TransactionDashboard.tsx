import React, { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTransactions } from '../hooks/useWalletData';
import TransactionFilters from './TransactionFilters';
import TransactionRow from './TransactionRow';
import { Loader2, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

/**
 * Number of records requested from the server per page.
 * Matches the API default.
 */
const PAGE_SIZE = 25;

/**
 * Read a string query param from a Next.js router query object.
 * Returns the fallback if the param is missing or is an array.
 */
function qp(query: Record<string, string | string[] | undefined>, key: string, fallback: string): string {
  const v = query[key];
  if (typeof v === 'string' && v.length > 0) return v;
  return fallback;
}

export default function TransactionDashboard() {
  const router = useRouter();

  // Derive filter state from URL query params.  This makes filters survive
  // refresh and navigation, and makes shared URLs restore the same view.
  const statusFilter   = qp(router.query, 'status',    'all');
  const currencyFilter = qp(router.query, 'currency',  'all');
  const dateRangeFilter = qp(router.query, 'dateRange', 'all');
  const cursor         = qp(router.query, 'cursor',    '');
  const pageStr        = qp(router.query, 'page',      '1');
  const currentPage    = Math.max(1, parseInt(pageStr, 10) || 1);

  // Keep a ref to the cursor stack so "Back" can return to the correct cursor
  // without storing it in the URL (avoids very long URLs for deep pagination).
  // The stack is keyed by page number: cursorStack[pageN] is the cursor to use
  // to fetch page N (null / '' means start of list).
  const cursorStack = useRef<(string | null)[]>([null]);

  // Synchronise router.query → cursor stack on mount and cursor changes.
  // If the user navigates directly to ?page=3&cursor=xyz we seed the stack.
  useEffect(() => {
    const pg = Math.max(1, parseInt(qp(router.query, 'page', '1'), 10) || 1);
    const cur = qp(router.query, 'cursor', '') || null;
    if (cursorStack.current.length < pg) {
      // Pad the stack so the current page maps to its cursor.
      while (cursorStack.current.length < pg) {
        cursorStack.current.push(cur);
      }
    }
    cursorStack.current[pg - 1] = cur;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading } = useTransactions({
    status:    statusFilter,
    currency:  currencyFilter,
    dateRange: dateRangeFilter,
    cursor:    cursor || undefined,
    limit:     PAGE_SIZE,
  });

  const transactions    = data?.data ?? [];
  const nextCursor      = data?.nextCursor ?? null;
  const totalTransactions = data?.total ?? 0;
  const totalPages      = Math.max(1, Math.ceil(totalTransactions / PAGE_SIZE));
  const isFirstPage     = currentPage === 1;
  const isLastPage      = nextCursor === null;

  /**
   * Push updated query params to the URL without a full-page reload.
   * Resets to page 1 when filters change, keeps page/cursor when paginating.
   */
  const pushQuery = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next: Record<string, string> = {};

      // Carry forward existing filter params.
      for (const key of ['status', 'currency', 'dateRange', 'page', 'cursor']) {
        const v = router.query[key];
        if (typeof v === 'string' && v.length > 0) next[key] = v;
      }

      // Apply the incoming updates (undefined removes the key).
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined || v === '' || v === 'all' || v === '1') {
          delete next[k];
        } else {
          next[k] = v;
        }
      }

      router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
    },
    [router],
  );

  /** Called by TransactionFilters when any filter select changes. */
  const handleStatusChange = useCallback(
    (v: string) => {
      cursorStack.current = [null];
      pushQuery({ status: v, cursor: undefined, page: undefined });
    },
    [pushQuery],
  );

  const handleCurrencyChange = useCallback(
    (v: string) => {
      cursorStack.current = [null];
      pushQuery({ currency: v, cursor: undefined, page: undefined });
    },
    [pushQuery],
  );

  const handleDateRangeChange = useCallback(
    (v: string) => {
      cursorStack.current = [null];
      pushQuery({ dateRange: v, cursor: undefined, page: undefined });
    },
    [pushQuery],
  );

  const handleNextPage = useCallback(() => {
    if (!nextCursor) return;
    const newPage = currentPage + 1;
    // Store the cursor for the new page so "Back" can recover it.
    cursorStack.current[newPage - 1] = nextCursor;
    pushQuery({ cursor: nextCursor, page: String(newPage) });
  }, [nextCursor, currentPage, pushQuery]);

  const handlePrevPage = useCallback(() => {
    if (currentPage <= 1) return;
    const prevPage = currentPage - 1;
    const prevCursor = cursorStack.current[prevPage - 1] ?? null;
    pushQuery({ cursor: prevCursor ?? undefined, page: prevPage > 1 ? String(prevPage) : undefined });
  }, [currentPage, pushQuery]);

  // Full-page skeleton shown only on the very first load (empty data + loading).
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
        setStatusFilter={handleStatusChange}
        currencyFilter={currencyFilter}
        setCurrencyFilter={handleCurrencyChange}
        dateRangeFilter={dateRangeFilter}
        setDateRangeFilter={handleDateRangeChange}
      />

      {!isLoading && transactions.length === 0 ? (
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
          {/* Loading overlay while a filter change or page navigation is in flight */}
          <div
            className={`space-y-3 relative ${isLoading ? 'opacity-60 pointer-events-none' : ''}`}
            role="status"
            aria-live="polite"
            aria-busy={isLoading}
          >
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" aria-hidden="true" />
              </div>
            )}
            {transactions.map((tx) => (
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
