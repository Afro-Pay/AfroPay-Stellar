import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useWalletStore } from "../store/walletStore";
import BalanceCard from "../components/BalanceCard";
import SendForm from "../components/SendForm";
import TransactionList from "../components/TransactionList";
import { SkeletonCard, SkeletonRow } from "../components/SkeletonCard";

export default function Dashboard() {
  const router = useRouter();
  const {
    balances,
    transactions,
    isLoading,
    error,
    fetchBalances,
    fetchTransactions,
  } = useWalletStore();
  const [dismissedError, setDismissedError] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }
    fetchBalances();
    fetchTransactions();
  }, []);

  const displayError = dismissedError ? null : error;

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">RemitX Dashboard</h1>

      {displayError && (
        <div className="mb-6 bg-red-900/50 border border-red-700 rounded-xl p-4 flex items-center justify-between">
          <p className="text-red-200 text-sm">{displayError}</p>
          <button
            onClick={() => setDismissedError(true)}
            className="text-red-400 hover:text-red-300 text-lg leading-none ml-3"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Balances</h2>
        <div className="grid grid-cols-3 gap-3">
          {isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : balances.length === 0 ? (
            <div className="col-span-3 bg-gray-900 rounded-xl p-6 text-center">
              <p className="text-gray-400 text-sm">
                No balances found — create a wallet to get started.
              </p>
            </div>
          ) : (
            balances.map((b) => <BalanceCard key={b.asset} {...b} />)
          )}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Send Money</h2>
        <SendForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Transaction History</h2>
        {isLoading ? (
          <div className="space-y-2">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : (
          <TransactionList transactions={transactions} />
        )}
      </section>
    </main>
  );
}
