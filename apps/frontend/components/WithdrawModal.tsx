import { useState } from 'react';
import { getWithdrawInfo, WithdrawInfo } from '../lib/api';

const SUPPORTED_ASSETS = ['USDC', 'NGN'] as const;
type SupportedAsset = (typeof SUPPORTED_ASSETS)[number];

interface WithdrawModalProps {
  /** The authenticated user's Stellar public key. */
  publicKey: string;
  onClose: () => void;
}

type ModalState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Collects asset + amount, calls GET /anchor/withdraw, and displays
 * the anchor's withdrawal instructions.
 * Follows the same Tailwind dark-mode patterns as SendForm.tsx.
 */
export default function WithdrawModal({ publicKey, onClose }: WithdrawModalProps) {
  const [assetCode, setAssetCode] = useState<SupportedAsset>('USDC');
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<ModalState>('idle');
  const [withdrawInfo, setWithdrawInfo] = useState<WithdrawInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = () => {
    setState('idle');
    setWithdrawInfo(null);
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setErrorMessage('Please enter a valid amount greater than zero.');
      setState('error');
      return;
    }
    setState('loading');
    setErrorMessage(null);
    setWithdrawInfo(null);
    try {
      const info = await getWithdrawInfo(assetCode, publicKey, amount);
      setWithdrawInfo(info);
      setState('success');
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        'Unable to retrieve withdrawal instructions. Please try again.';
      setErrorMessage(msg);
      setState('error');
    }
  };

  const fmt = (value?: number) =>
    value !== undefined ? value.toLocaleString() : '—';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl space-y-5 p-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 id="withdraw-modal-title" className="text-lg font-semibold text-white">
            Withdraw Funds
          </h2>
          <button
            onClick={onClose}
            aria-label="Close withdrawal modal"
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form — only show before success */}
        {state !== 'success' && (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="flex gap-2">
              {/* Amount */}
              <div className="flex-1">
                <label htmlFor="withdraw-amount" className="block text-xs font-medium text-gray-300 mb-1">
                  Amount
                </label>
                <input
                  id="withdraw-amount"
                  type="number"
                  step="0.0000001"
                  min="0"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); if (state === 'error') reset(); }}
                  className="w-full bg-gray-800 border border-gray-700/50 text-white text-sm rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>

              {/* Asset */}
              <div>
                <label htmlFor="withdraw-asset" className="block text-xs font-medium text-gray-300 mb-1">
                  Asset
                </label>
                <select
                  id="withdraw-asset"
                  value={assetCode}
                  onChange={(e) => { setAssetCode(e.target.value as SupportedAsset); reset(); }}
                  className="bg-gray-800 border border-gray-700/50 text-white text-sm rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                >
                  {SUPPORTED_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>

            {/* Error */}
            {state === 'error' && errorMessage && (
              <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3.5 space-y-1">
                <p className="font-semibold">Unable to process withdrawal</p>
                <p className="text-xs text-red-300/80">{errorMessage}</p>
              </div>
            )}

            {/* Loading skeleton */}
            {state === 'loading' && (
              <div aria-live="polite" aria-busy="true" className="animate-pulse space-y-3">
                <div className="h-4 bg-gray-800 rounded w-2/3" />
                <div className="h-12 bg-gray-800 rounded-lg" />
                <div className="h-12 bg-gray-800 rounded-lg w-5/6" />
                <p className="text-xs text-center text-gray-500">Fetching withdrawal instructions…</p>
              </div>
            )}

            <button
              type="submit"
              disabled={state === 'loading'}
              className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-white rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 shadow-md shadow-violet-600/20"
            >
              {state === 'loading' ? 'Fetching…' : 'Get Withdrawal Instructions'}
            </button>
          </form>
        )}

        {/* Success: withdrawal instructions */}
        {state === 'success' && withdrawInfo && (
          <div aria-live="polite" className="space-y-3 bg-gray-800/40 border border-gray-800 rounded-xl p-4 text-sm">

            {/* Summary */}
            <div className="flex justify-between items-baseline border-b border-gray-800/50 pb-2">
              <span className="text-gray-400 text-xs">Withdrawing</span>
              <span className="font-semibold text-white">{amount} {assetCode}</span>
            </div>

            {/* non_interactive_customer_info_needed variant */}
            {withdrawInfo.type === 'non_interactive_customer_info_needed' && (
              <div role="alert" className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm rounded-lg p-3">
                <p className="font-semibold mb-1">Additional information required</p>
                {withdrawInfo.fields && (
                  <ul className="list-disc list-inside text-xs text-amber-200/80 space-y-0.5">
                    {Object.keys(withdrawInfo.fields).map((f) => <li key={f}>{f}</li>)}
                  </ul>
                )}
              </div>
            )}

            {/* Anchor receiving account */}
            {withdrawInfo.account_id && (
              <InfoRow label="Send to account" value={withdrawInfo.account_id} mono highlight />
            )}

            {/* Memo */}
            {withdrawInfo.memo && (
              <InfoRow
                label={`Memo${withdrawInfo.memo_type ? ` (${withdrawInfo.memo_type})` : ''}`}
                value={withdrawInfo.memo}
                mono
              />
            )}

            {/* Transaction ID */}
            {withdrawInfo.id && (
              <InfoRow label="Anchor transaction ID" value={withdrawInfo.id} mono />
            )}

            {/* Fees */}
            {(withdrawInfo.fee_fixed !== undefined || withdrawInfo.fee_percent !== undefined) && (
              <InfoRow
                label="Fee"
                value={[
                  withdrawInfo.fee_fixed !== undefined ? `${fmt(withdrawInfo.fee_fixed)} ${assetCode} fixed` : null,
                  withdrawInfo.fee_percent !== undefined ? `${withdrawInfo.fee_percent}%` : null,
                ].filter(Boolean).join(' + ')}
              />
            )}

            {/* Limits */}
            {(withdrawInfo.min_amount !== undefined || withdrawInfo.max_amount !== undefined) && (
              <InfoRow label="Limits" value={`${fmt(withdrawInfo.min_amount)} – ${fmt(withdrawInfo.max_amount)} ${assetCode}`} />
            )}

            {/* ETA */}
            {withdrawInfo.eta !== undefined && (
              <InfoRow label="Estimated time" value={`~${withdrawInfo.eta}s`} />
            )}

            {/* Extra info */}
            {withdrawInfo.extra_info &&
              Object.entries(withdrawInfo.extra_info).map(([k, v]) => (
                <InfoRow key={k} label={k.replace(/_/g, ' ')} value={String(typeof v === 'object' ? JSON.stringify(v) : v)} />
              ))}

            <p className="text-xs text-gray-500 pt-1">
              Send {amount} {assetCode} to the account above{withdrawInfo.memo ? `, including the memo` : ''}. The anchor will process your withdrawal once confirmed.
            </p>
          </div>
        )}

        {/* Action row when success */}
        {state === 'success' && (
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => { reset(); setAmount(''); }}
              className="flex-1 bg-gray-800 hover:bg-gray-700 active:scale-[0.99] transition-all text-gray-300 rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 border border-gray-700"
            >
              New Withdrawal
            </button>
            <button
              onClick={onClose}
              className="bg-gray-800 hover:bg-gray-700 active:scale-[0.99] transition-all text-gray-400 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 border border-gray-700"
            >
              Close
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared row component
// ---------------------------------------------------------------------------
interface InfoRowProps {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}

function InfoRow({ label, value, mono = false, highlight = false }: InfoRowProps) {
  return (
    <div className="flex justify-between items-start gap-3 border-b border-gray-800/50 pb-2 last:border-0 last:pb-0">
      <span className="text-gray-400 text-xs capitalize shrink-0">{label}</span>
      <span className={`text-right text-xs break-all ${highlight ? 'text-white font-medium' : mono ? 'text-indigo-300 font-mono' : 'text-gray-200'}`}>
        {value}
      </span>
    </div>
  );
}
