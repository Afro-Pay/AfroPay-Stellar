import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWalletStore } from '../store/walletStore';
import BalanceCard from '../components/BalanceCard';
import SendForm from '../components/SendForm';
import TransactionList from '../components/TransactionList';
import SkeletonCard from '../components/SkeletonCard';

export default function Dashboard() {
  const router = useRouter();
  const { balances, transactions, isLoading, error, fetchBalances, fetchTransactions } = useWalletStore();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/login'); return; }
    fetchBalances();
    fetchTransactions();
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">RemitX Dashboard</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-xl text-red-300 text-sm">
          {error}
        </div>
      )}

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Balances</h2>
        {isLoading ? (
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
        <h2 className="text-lg font-semibold mb-2">Send Money</h2>
        <SendForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Transaction History</h2>
        <TransactionList transactions={transactions} isLoading={isLoading} />
      </section>
    </main>
  );
}
