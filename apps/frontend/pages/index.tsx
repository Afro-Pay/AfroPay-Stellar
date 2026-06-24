import {useEffect} from "react";
import {useRouter} from "next/router";
import {useWalletStore} from "../store/walletStore";
import BalanceCard from "../components/BalanceCard";
import SendForm from "../components/SendForm";
import TransactionList from "../components/TransactionList";

export default function Dashboard() {
  const router = useRouter();
  const {balances, transactions, fetchBalances, fetchTransactions} =
    useWalletStore();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }
    fetchBalances();
    fetchTransactions();
  }, []);

  return (
    <main className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">
        RemitX Dashboard
      </h1>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
          Balances
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {balances.map((b) => (
            <BalanceCard key={b.asset} {...b} />
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
          Send Money
        </h2>
        <SendForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
          Transaction History
        </h2>
        <TransactionList transactions={transactions} />
      </section>
    </main>
  );
}
