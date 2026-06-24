import React, { useEffect, useState, useMemo } from 'react';
import { useWalletStore } from '../store/walletStore';
import TransactionFilters from './TransactionFilters';
import TransactionRow from './TransactionRow';
import { Loader2, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

const ITEMS_PER_PAGE = 25;

export default function TransactionDashboard() {
  const { transactions, fetchTransactions } = useWalletStore();
  const [loading, setLoading] = useState(true);
  
  const [statusFilter, setStatusFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [dateRangeFilter, setDateRangeFilter] = useState('all');
  
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    fetchTransactions().finally(() => setLoading(false));
  }, [fetchTransactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      // Status Filter
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      
      // Currency Filter
      if (currencyFilter !== 'all' && tx.assetCode !== currencyFilter) return false;
      
      // Date Filter
      if (dateRangeFilter !== 'all') {
        const txDate = new Date(tx.createdAt).getTime();
        const now = new Date().getTime();
        const diffDays = (now - txDate) / (1000 * 3600 * 24);
        
        if (dateRangeFilter === '7d' && diffDays > 7) return false;
        if (dateRangeFilter === '30d' && diffDays > 30) return false;
      }
      
      return true;
    });
  }, [transactions, statusFilter, currencyFilter, dateRangeFilter]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, currencyFilter, dateRangeFilter]);

  const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 min-h-[50vh]" role="status" aria-live="polite">
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
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        currencyFilter={currencyFilter} setCurrencyFilter={setCurrencyFilter}
        dateRangeFilter={dateRangeFilter} setDateRangeFilter={setDateRangeFilter}
      />

      {filteredTransactions.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 flex flex-col items-center justify-center text-center min-h-[40vh]">
          <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
            <Inbox className="w-8 h-8 text-gray-500" aria-hidden="true" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">No Transactions Found</h3>
          <p className="text-gray-400 max-w-sm">
            We couldn't find any transactions matching your current filters. Try adjusting them or clear all filters.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedTransactions.map(tx => (
            <TransactionRow key={tx.id} tx={tx} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between border-t border-gray-800 pt-6 gap-4">
          <p className="text-sm text-gray-400">
            Showing <span className="font-medium text-white">{((currentPage - 1) * ITEMS_PER_PAGE) + 1}</span> to <span className="font-medium text-white">{Math.min(currentPage * ITEMS_PER_PAGE, filteredTransactions.length)}</span> of <span className="font-medium text-white">{filteredTransactions.length}</span> results
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              aria-label={`Go to previous page, page ${Math.max(1, currentPage - 1)} of ${totalPages}`}
              className="px-4 py-2 bg-gray-900 border border-gray-800 text-sm font-medium rounded-lg text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              aria-label={`Go to next page, page ${Math.min(totalPages, currentPage + 1)} of ${totalPages}`}
              className="px-4 py-2 bg-gray-900 border border-gray-800 text-sm font-medium rounded-lg text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              Next <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
