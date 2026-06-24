import {useState} from "react";
import {useWalletStore} from "../store/walletStore";

const ASSETS = ["XLM", "USDC", "NGN"];

export default function SendForm() {
  const {sendTransfer, fetchBalances, fetchTransactions} = useWalletStore();
  const [form, setForm] = useState({
    destinationPublicKey: "",
    amount: "",
    assetCode: "XLM",
    memo: "",
  });
  const [status, setStatus] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Sending...");
    try {
      await sendTransfer(form);
      setStatus("Transaction submitted!");
      fetchBalances();
      fetchTransactions();
    } catch {
      setStatus("Failed to send. Please try again.");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-gray-900 rounded-xl p-4 space-y-3 border border-gray-200/80 dark:border-gray-800"
    >
      <input
        className="w-full bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-sm outline-none text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
        placeholder="Destination public key"
        value={form.destinationPublicKey}
        onChange={(e) =>
          setForm({...form, destinationPublicKey: e.target.value})
        }
        required
      />
      <div className="flex gap-2">
        <input
          className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-sm outline-none text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
          placeholder="Amount"
          type="number"
          step="0.0000001"
          min="0"
          value={form.amount}
          onChange={(e) => setForm({...form, amount: e.target.value})}
          required
        />
        <select
          className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-sm outline-none text-gray-900 dark:text-white"
          value={form.assetCode}
          onChange={(e) => setForm({...form, assetCode: e.target.value})}
        >
          {ASSETS.map((a) => (
            <option
              key={a}
              className="bg-white text-gray-900 dark:bg-gray-900 dark:text-white"
            >
              {a}
            </option>
          ))}
        </select>
      </div>
      <input
        className="w-full bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-sm outline-none text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400"
        placeholder="Memo (optional)"
        value={form.memo}
        onChange={(e) => setForm({...form, memo: e.target.value})}
      />
      <button className="w-full bg-indigo-600 hover:bg-indigo-700 rounded-lg p-3 font-semibold text-sm">
        Send
      </button>
      {status && (
        <p className="text-sm text-center text-gray-500 dark:text-gray-400">
          {status}
        </p>
      )}
    </form>
  );
}
