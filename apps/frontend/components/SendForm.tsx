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
    <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl p-4 space-y-3" aria-describedby="send-form-status">
      <div>
        <label htmlFor="destination-public-key" className="block text-xs font-medium text-gray-300 mb-1">
          Destination public key
        </label>
        <input
          id="destination-public-key"
          name="destinationPublicKey"
          className="w-full bg-gray-800 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="G..."
          value={form.destinationPublicKey}
          onChange={(e) => setForm({ ...form, destinationPublicKey: e.target.value })}
          autoComplete="off"
          required
        />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor="transfer-amount" className="block text-xs font-medium text-gray-300 mb-1">
            Amount
          </label>
          <input
            id="transfer-amount"
            name="amount"
            className="w-full bg-gray-800 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="0.00"
            type="number"
            step="0.0000001"
            min="0"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
        </div>
        <div>
          <label htmlFor="transfer-asset" className="block text-xs font-medium text-gray-300 mb-1">
            Asset
          </label>
          <select
            id="transfer-asset"
            name="assetCode"
            className="bg-gray-800 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            value={form.assetCode}
            onChange={(e) => setForm({ ...form, assetCode: e.target.value })}
          >
            {ASSETS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="transfer-memo" className="block text-xs font-medium text-gray-300 mb-1">
          Memo <span className="text-gray-500">(optional)</span>
        </label>
        <input
          id="transfer-memo"
          name="memo"
          className="w-full bg-gray-800 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Invoice or note"
          value={form.memo}
          onChange={(e) => setForm({ ...form, memo: e.target.value })}
        />
      </div>
      <button className="w-full bg-indigo-600 hover:bg-indigo-700 rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
        Send
      </button>
      <p id="send-form-status" className="text-sm text-center text-gray-400" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
