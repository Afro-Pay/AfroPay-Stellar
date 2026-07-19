import { useState } from 'react';
import { useWalletStore } from '../store/walletStore';

const ASSETS = ['XLM', 'USDC', 'NGN'];

export default function SendForm() {
  const { sendTransfer, fetchBalances, fetchTransactions, publicKey } = useWalletStore();
  const [form, setForm] = useState({
    destinationPublicKey: '',
    amount: '',
    assetCode: 'XLM',
    memo: '',
  });
  const [status, setStatus] = useState('');

  const walletReady = publicKey !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletReady) return;
    setStatus('Sending…');
    try {
      await sendTransfer(form);
      setStatus('Transaction submitted!');
      fetchBalances();
      fetchTransactions();
    } catch {
      setStatus('Failed to send. Please try again.');
    }
  };

  return (
    <div className="relative">
      {/* Disabled overlay with explanatory tooltip */}
      {!walletReady && (
        <div
          role="status"
          aria-label="Wallet required to send"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-gray-900/80 backdrop-blur-sm gap-2 px-4"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p className="text-sm text-gray-400 text-center">
            Create a wallet first to send money.
          </p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        aria-disabled={!walletReady}
        className={`bg-gray-900 rounded-xl p-4 space-y-3 ${!walletReady ? 'opacity-40 pointer-events-none select-none' : ''}`}
      >
        <input
          className="w-full bg-gray-800 rounded-lg p-3 text-sm outline-none"
          placeholder="Destination public key"
          value={form.destinationPublicKey}
          onChange={(e) => setForm({ ...form, destinationPublicKey: e.target.value })}
          disabled={!walletReady}
          required
        />
        <div className="flex gap-2">
          <input
            className="flex-1 bg-gray-800 rounded-lg p-3 text-sm outline-none"
            placeholder="Amount"
            type="number"
            step="0.0000001"
            min="0"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            disabled={!walletReady}
            required
          />
          <select
            className="bg-gray-800 rounded-lg p-3 text-sm outline-none"
            value={form.assetCode}
            onChange={(e) => setForm({ ...form, assetCode: e.target.value })}
            disabled={!walletReady}
          >
            {ASSETS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <input
          className="w-full bg-gray-800 rounded-lg p-3 text-sm outline-none"
          placeholder="Memo (optional)"
          value={form.memo}
          onChange={(e) => setForm({ ...form, memo: e.target.value })}
          disabled={!walletReady}
        />
        <button
          type="submit"
          disabled={!walletReady}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg p-3 font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Send
        </button>
        {status && (
          <p className="text-sm text-center text-gray-400">{status}</p>
        )}
      </form>
    </div>
  );
}
