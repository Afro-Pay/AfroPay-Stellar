import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWalletStore } from '../store/walletStore';
import BalanceCard from '../components/BalanceCard';
import SendForm from '../components/SendForm';
import TransactionList from '../components/TransactionList';
import WalletSetup from '../components/WalletSetup';

export default function Dashboard() {
  const router = useRouter();
  const {
    balances,
    transactions,
    publicKey,
    fetchBalances,
    fetchTransactions,
    fetchPublicKey,
  } = useWalletStore();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    // Fetch wallet status first; if a wallet exists, also load balances and
    // transaction history.  fetchPublicKey sets publicKey to null on 404 so
    // WalletSetup is shown automatically to first-time users.
    fetchPublicKey().then(() => {
      const { publicKey: pk } = useWalletStore.getState();
      if (pk) {
        fetchBalances();
        fetchTransactions();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch balances and transactions once the wallet becomes available
  // (e.g., after the user creates a wallet via WalletSetup).
  useEffect(() => {
    if (publicKey) {
      fetchBalances();
      fetchTransactions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">AfroPay Dashboard</h1>

      {/* ------------------------------------------------------------------ */}
      {/* Wallet onboarding — shown only when the user has no wallet yet.     */}
      {/* ------------------------------------------------------------------ */}
      {!publicKey && (
        <section className="mb-6">
          <WalletSetup />
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Balances — shown once wallet exists.                                */}
      {/* ------------------------------------------------------------------ */}
      {publicKey && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Balances</h2>
          <div className="grid grid-cols-3 gap-3">
            {balances.map((b) => (
              <BalanceCard key={b.asset} {...b} />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Send Money — always rendered; SendForm handles the disabled state.  */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Send Money</h2>
        <SendForm />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Transaction History                                                  */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Transaction History</h2>
        <TransactionList transactions={transactions} />
      </section>
    </main>
  );
}
