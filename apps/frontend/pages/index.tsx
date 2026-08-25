import { useState, useEffect } from 'react';
import { useWalletStore } from '../store/walletStore';
import { useBalances, useTransactions } from '../hooks/useWalletData';
import { withAuth } from '../lib/withAuth';
import BalanceCard from '../components/BalanceCard';
import SendForm from '../components/SendForm';
import TransactionList from '../components/TransactionList';
import SkeletonCard from '../components/SkeletonCard';
import DepositModal from '../components/DepositModal';
import WithdrawModal from '../components/WithdrawModal';
import WalletCacheStatus from '../components/WalletCacheStatus';

type ActiveModal = 'deposit' | 'withdraw' | null;

function Dashboard() {
  const { publicKey, setPublicKey } = useWalletStore();
  const { data: balances = [], isLoading: isLoadingBalances, error: balancesError } = useBalances();
  const { data: transactions = [], isLoading: isLoadingTransactions, error: transactionsError } = useTransactions();
  const balancesUpdatedAt = useWalletStore((state) => state.balancesUpdatedAt);
  const transactionsUpdatedAt = useWalletStore((state) => state.transactionsUpdatedAt);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  useEffect(() => {
    const pk = localStorage.getItem('publicKey');
    if (pk) {
      setPublicKey(pk);
    }
  }, [setPublicKey]);

  const closeModal = () => setActiveModal(null);

  return (
    <main id="main-content" tabIndex={-1} className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">
        RemitX Dashboard
      </h1>

      {balancesError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-xl text-red-300 text-sm" role="alert" aria-live="assertive">
          <span>{balancesError instanceof Error ? balancesError.message : String(balancesError)}</span>
        </div>
      )}

      {transactionsError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-xl text-red-300 text-sm" role="alert" aria-live="assertive">
          <span>{transactionsError instanceof Error ? transactionsError.message : String(transactionsError)}</span>
        </div>
      )}

      {/* Balances */}
      <section className="mb-6" aria-labelledby="balances-heading">
        <h2 id="balances-heading" className="text-lg font-semibold mb-2">Balances</h2>
        <WalletCacheStatus updatedAt={balancesUpdatedAt} />
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
            {balances.map((balance) => <BalanceCard key={balance.asset} {...balance} />)}
          </div>
        )}
      </section>

      {/* Deposit & Withdraw */}
      {publicKey && (
        <section className="mb-6" aria-labelledby="fiat-ramp-heading">
          <h2 id="fiat-ramp-heading" className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">
            Fiat On/Off-Ramp
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {/* Deposit */}
            <button
              onClick={() => setActiveModal('deposit')}
              className="flex items-center justify-center gap-2 bg-gray-900 border border-gray-800 hover:border-emerald-600/50 hover:bg-emerald-500/5 active:scale-[0.99] transition-all rounded-xl p-4 text-sm font-semibold text-gray-200 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm group"
              aria-label="Deposit funds via anchor"
            >
              {/* Arrow-down into circle icon */}
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 group-hover:bg-emerald-500/20 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
                </svg>
              </span>
              Deposit
            </button>

            {/* Withdraw */}
            <button
              onClick={() => setActiveModal('withdraw')}
              className="flex items-center justify-center gap-2 bg-gray-900 border border-gray-800 hover:border-violet-600/50 hover:bg-violet-500/5 active:scale-[0.99] transition-all rounded-xl p-4 text-sm font-semibold text-gray-200 hover:text-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-500 shadow-sm group"
              aria-label="Withdraw funds via anchor"
            >
              {/* Arrow-up out of circle icon */}
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-violet-500/10 group-hover:bg-violet-500/20 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 20V8m0 0l-4 4m4-4l4 4M4 4h16" />
                </svg>
              </span>
              Withdraw
            </button>
          </div>
        </section>
      )}

      {/* Send Money */}
      <section className="mb-6" aria-labelledby="send-money-heading">
        <h2 id="send-money-heading" className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
          Send Money
        </h2>
        <SendForm />
      </section>

      {/* Transaction History */}
      <section aria-labelledby="transactions-heading">
        <h2 id="transactions-heading" className="text-lg font-semibold mb-2">Transaction History</h2>
        <WalletCacheStatus updatedAt={transactionsUpdatedAt} />
        <TransactionList transactions={transactions} isLoading={isLoadingTransactions} />
      </section>

      {/* Modals — rendered in a portal-like pattern at end of tree */}
      {activeModal === 'deposit' && publicKey && (
        <DepositModal publicKey={publicKey} onClose={closeModal} />
      )}
      {activeModal === 'withdraw' && publicKey && (
        <WithdrawModal publicKey={publicKey} onClose={closeModal} />
      )}
    </main>
  );
}

export default withAuth(Dashboard);
