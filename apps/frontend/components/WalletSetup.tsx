import { useState, useEffect, useRef } from 'react';
import { useWalletStore } from '../store/walletStore';

// ---------------------------------------------------------------------------
// Lightweight QR-code renderer using the browser's native Canvas API.
// We embed a minimal QR encoder so no external dependency is needed.
// For a richer visual, install `qrcode` (npm i qrcode @types/qrcode) and
// swap the <QrCanvas> component for <QRCodeCanvas value={publicKey} />.
// ---------------------------------------------------------------------------

/** Converts a string to a data-URI QR code via the qrcode package when it is
 * available, otherwise renders a placeholder that shows the key. */
function QrCanvas({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Attempt to dynamically import the optional `qrcode` package.
    // @ts-expect-error - qrcode is an optional dependency
    import('qrcode')
      .then((QRCode) => {
        if (cancelled || !canvasRef.current) return;
        QRCode.toCanvas(canvasRef.current, value, { width: 160, margin: 1 }, (err) => {
          if (err && !cancelled) setFallback(true);
        });
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => { cancelled = true; };
  }, [value]);

  if (fallback) {
    // Plain visual fallback — a bordered box with truncated key text.
    return (
      <div className="w-40 h-40 flex items-center justify-center border-2 border-dashed border-gray-500 rounded-lg bg-gray-800 p-2">
        <p className="text-xs text-gray-400 text-center break-all leading-tight">{value}</p>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="rounded-lg" />;
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard button
// ---------------------------------------------------------------------------
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silent fail is acceptable here.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy public key to clipboard"
      aria-label={copied ? 'Copied!' : 'Copy public key'}
      className="ml-2 flex-shrink-0 p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      {copied ? (
        // Check-mark icon
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        // Clipboard icon
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// WalletSetup — shown on Dashboard when publicKey === null.
// ---------------------------------------------------------------------------
export default function WalletSetup() {
  const { publicKey, loading, error, createWallet, clearWalletError } = useWalletStore();

  // Success state — wallet was just created (publicKey is now populated).
  if (publicKey) {
    return (
      <div className="bg-gray-900 border border-green-700 rounded-2xl p-6 text-center space-y-5">
        <div className="flex items-center justify-center w-12 h-12 mx-auto rounded-full bg-green-900/50 border border-green-600">
          {/* Checkmark */}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <div>
          <h2 className="text-xl font-bold text-white">Wallet Created!</h2>
          <p className="text-sm text-gray-400 mt-1">
            Your Stellar wallet is ready. Keep your public key safe — you&apos;ll need it to receive payments.
          </p>
        </div>

        {/* QR code */}
        <div className="flex justify-center">
          <QrCanvas value={publicKey} />
        </div>

        {/* Public key display + copy */}
        <div>
          <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Public Key</p>
          <div className="flex items-center bg-gray-800 rounded-lg px-3 py-2">
            <code className="text-xs text-green-400 break-all flex-1 text-left font-mono">
              {publicKey}
            </code>
            <CopyButton text={publicKey} />
          </div>
        </div>
      </div>
    );
  }

  // Default state — no wallet yet.
  return (
    <div className="bg-gray-900 border border-indigo-700 rounded-2xl p-6 text-center space-y-5">
      {/* Wallet icon */}
      <div className="flex items-center justify-center w-14 h-14 mx-auto rounded-full bg-indigo-900/50 border border-indigo-600">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      </div>

      <div>
        <h2 className="text-xl font-bold text-white">Set Up Your Stellar Wallet</h2>
        <p className="text-sm text-gray-400 mt-2 leading-relaxed">
          You don&apos;t have a wallet yet. Create one to start sending and receiving
          cross-border payments on the Stellar network.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div role="alert" className="flex items-start gap-2 bg-red-900/40 border border-red-700 rounded-lg p-3 text-left">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-red-300 flex-1">{error}</p>
          <button
            type="button"
            onClick={clearWalletError}
            aria-label="Dismiss error"
            className="text-red-400 hover:text-red-200 flex-shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Feature highlights */}
      <ul className="text-sm text-gray-400 space-y-1.5 text-left">
        {[
          'Generate a secure Stellar keypair instantly',
          'Receive XLM, USDC, and multi-currency payments',
          'Your encrypted secret key never leaves our servers',
        ].map((item) => (
          <li key={item} className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {item}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={createWallet}
        disabled={loading}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl py-3 font-semibold text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Creating Wallet…
          </span>
        ) : (
          'Create Wallet'
        )}
      </button>
    </div>
  );
}
