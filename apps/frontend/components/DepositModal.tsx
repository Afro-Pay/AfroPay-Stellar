import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getDepositInfo, DepositInfo } from '../lib/api';

const SUPPORTED_ASSETS = ['USDC', 'NGN'] as const;
type SupportedAsset = (typeof SUPPORTED_ASSETS)[number];

interface DepositModalProps {
  /** The authenticated user's Stellar public key. */
  publicKey: string;
  onClose: () => void;
}

type ModalState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Renders anchor deposit instructions fetched via GET /anchor/deposit.
 * Follows the same Tailwind dark-mode patterns as SendForm.tsx.
 */
export default function DepositModal({ publicKey, onClose }: DepositModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [assetCode, setAssetCode] = useState<SupportedAsset>('USDC');
  const [state, setState] = useState<ModalState>('idle');
  const [depositInfo, setDepositInfo] = useState<DepositInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();

    return () => previouslyFocusedRef.current?.focus();
  }, []);

  const requestClose = () => {
    onClose();
    previouslyFocusedRef.current?.focus();
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleFetch = async () => {
    setState('loading');
    setErrorMessage(null);
    setDepositInfo(null);
    try {
      const info = await getDepositInfo(assetCode, publicKey);
      setDepositInfo(info);
      setState('success');
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        'Unable to retrieve deposit instructions. Please try again.';
      setErrorMessage(msg);
      setState('error');
    }
  };

  const reset = () => {
    setState('idle');
    setDepositInfo(null);
    setErrorMessage(null);
  };

  const fmt = (value?: number) =>
    value !== undefined ? value.toLocaleString() : '—';

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl space-y-5 p-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 id="deposit-modal-title" className="text-lg font-semibold text-white">
            Deposit Funds
          </h2>
          <button
            onClick={requestClose}
            aria-label="Close deposit modal"
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Asset selector */}
        <div>
          <label htmlFor="deposit-asset" className="block text-xs font-medium text-gray-300 mb-1">
            Asset
          </label>
          <select
            id="deposit-asset"
            value={assetCode}
            onChange={(e) => { setAssetCode(e.target.value as SupportedAsset); reset(); }}
            className="w-full bg-gray-800 border border-gray-700/50 text-white text-sm rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          >
            {SUPPORTED_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        {/* Error */}
        {state === 'error' && errorMessage && (
          <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3.5 space-y-1">
            <p className="font-semibold">Unable to retrieve deposit instructions</p>
            <p className="text-xs text-red-300/80">{errorMessage}</p>
          </div>
        )}

        {/* Loading skeleton */}
        {state === 'loading' && (
          <div aria-live="polite" aria-busy="true" className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-800 rounded w-2/3" />
            <div className="h-12 bg-gray-800 rounded-lg" />
            <div className="h-12 bg-gray-800 rounded-lg w-5/6" />
            <p className="text-xs text-center text-gray-500">Fetching deposit instructions…</p>
          </div>
        )}

        {/* Success: instructions */}
        {state === 'success' && depositInfo && (
          <div aria-live="polite" className="space-y-3 bg-gray-800/40 border border-gray-800 rounded-xl p-4 text-sm">

            {/* non_interactive_customer_info_needed variant */}
            {depositInfo.type === 'non_interactive_customer_info_needed' && (
              <div role="alert" className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm rounded-lg p-3">
                <p className="font-semibold mb-1">Additional information required</p>
                {depositInfo.fields && (
                  <ul className="list-disc list-inside text-xs text-amber-200/80 space-y-0.5">
                    {Object.keys(depositInfo.fields).map((f) => <li key={f}>{f}</li>)}
                  </ul>
                )}
              </div>
            )}

            {depositInfo.how && (
              <InfoRow label="Instructions" value={depositInfo.how} highlight />
            )}

            {depositInfo.instructions &&
              Object.entries(depositInfo.instructions).map(([k, v]) => (
                <InfoRow key={k} label={k.replace(/_/g, ' ')} value={String(typeof v === 'object' ? JSON.stringify(v) : v)} />
              ))}

            {depositInfo.id && (
              <InfoRow label="Anchor transaction ID" value={depositInfo.id} mono />
            )}

            {(depositInfo.fee_fixed !== undefined || depositInfo.fee_percent !== undefined) && (
              <InfoRow
                label="Fee"
                value={[
                  depositInfo.fee_fixed !== undefined ? `${fmt(depositInfo.fee_fixed)} ${assetCode} fixed` : null,
                  depositInfo.fee_percent !== undefined ? `${depositInfo.fee_percent}%` : null,
                ].filter(Boolean).join(' + ')}
              />
            )}

            {(depositInfo.min_amount !== undefined || depositInfo.max_amount !== undefined) && (
              <InfoRow label="Limits" value={`${fmt(depositInfo.min_amount)} – ${fmt(depositInfo.max_amount)} ${assetCode}`} />
            )}

            {depositInfo.eta !== undefined && (
              <InfoRow label="Estimated time" value={`~${depositInfo.eta}s`} />
            )}

            {depositInfo.extra_info &&
              Object.entries(depositInfo.extra_info).map(([k, v]) => (
                <InfoRow key={k} label={k.replace(/_/g, ' ')} value={String(typeof v === 'object' ? JSON.stringify(v) : v)} />
              ))}

            <p className="text-xs text-gray-500 pt-1">
              Send your {assetCode} using the instructions above. The anchor will credit your Stellar account once confirmed.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          {state !== 'success' ? (
            <button
              onClick={handleFetch}
              disabled={state === 'loading'}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-white rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 shadow-md shadow-emerald-600/20"
            >
              {state === 'loading' ? 'Fetching…' : 'Get Deposit Instructions'}
            </button>
          ) : (
            <button
              onClick={reset}
              className="flex-1 bg-gray-800 hover:bg-gray-700 active:scale-[0.99] transition-all text-gray-300 rounded-lg p-3 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 border border-gray-700"
            >
              Change Asset
            </button>
          )}
          <button
            onClick={requestClose}
            className="bg-gray-800 hover:bg-gray-700 active:scale-[0.99] transition-all text-gray-400 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 border border-gray-700"
          >
            Close
          </button>
        </div>

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
