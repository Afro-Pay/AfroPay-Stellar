import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useQueryClient } from '@tanstack/react-query';
import { useWalletStore } from '../store/walletStore';
import { useBalances, useTransactions } from '../hooks/useWalletData';
import BalanceCard from '../components/BalanceCard';
import SendForm from '../components/SendForm';
import TransactionList from '../components/TransactionList';
import SkeletonCard from '../components/SkeletonCard';

export default function Dashboard() {
  const router = useRouter();
  const { publicKey, setPublicKey } = useWalletStore();
  const { data: balances = [], isLoading, error } = useBalances();
  const { data: transactions = [] } = useTransactions();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }
    const pk = localStorage.getItem("publicKey");
    if (pk) setPublicKey(pk);
  }, [router, setPublicKey]);

  useEffect(() => {
    setBalancesLoading(balancesLoading);
  }, [balancesLoading, setBalancesLoading]);

  useEffect(() => {
    if (balancesQueryError) {
      setBalancesError(balancesQueryError.message);
    } else {
      setBalancesError(null);
    }
  }, [balancesQueryError, setBalancesError]);

  useEffect(() => {
    if (transactionsQueryError) {
      setTransactionsError(transactionsQueryError.message);
    } else {
      setTransactionsError(null);
    }
  }, [transactionsQueryError, setTransactionsError]);

  const retryBalances = () => {
    clearError('balances');
    void queryClient.invalidateQueries({ queryKey: ['balances'] });
  };

  const retryTransactions = () => {
    clearError('transactions');
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
  };

  return (
    <main className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">
        RemitX Dashboard
      </h1>

      {balancesError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-xl text-red-300 text-sm flex items-center justify-between gap-3">
          <span>{balancesError}</span>
          <button type="button" onClick={retryBalances} className="text-xs font-semibold text-indigo-300 hover:text-indigo-200">
            Retry
          </button>
        </div>
      )}

      {transactionsError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-xl text-red-300 text-sm flex items-center justify-between gap-3">
          <span>{transactionsError}</span>
          <button type="button" onClick={retryTransactions} className="text-xs font-semibold text-indigo-300 hover:text-indigo-200">
            Retry
          </button>
        </div>
      )}

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Balances</h2>
        {isLoadingBalances ? (
          <div className="grid grid-cols-3 gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : balances.length === 0 ? (
          <p className="text-gray-500 text-sm">No balances found — create a wallet to get started.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {balances.map((b) => <BalanceCard key={b.asset} {...b} />)}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
          Send Money
        </h2>
        <SendForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Transaction History</h2>
        <TransactionList transactions={transactions} isLoading={txLoading} />
      </section>
    </main>
  );
}
