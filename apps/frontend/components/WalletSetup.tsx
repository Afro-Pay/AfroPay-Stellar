import { useState, useEffect, useRef } from 'react';
import { useWalletStore } from '../store/walletStore';

// ---------------------------------------------------------------------------
// Lightweight QR-code renderer using the browser's native Canvas API.
// ---------------------------------------------------------------------------

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
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3" />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// WalletSetup — Multi-wallet support with creation and management
// ---------------------------------------------------------------------------
export default function WalletSetup() {
  const {
    wallets,
    activeWalletId,
    publicKey,
    loading,
    error,
    fetchWallets,
    createWallet,
    switchWallet,
    removeWallet,
    updateWalletAlias,
    clearWalletError,
  } = useWalletStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newAlias, setNewAlias] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAlias, setEditingAlias] = useState('');

  // Fetch wallets on mount
  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  // No wallets — show creation form
  if (wallets.length === 0) {
    return (
      <div className="bg-gray-900 border border-indigo-700 rounded-2xl p-6 text-center space-y-5">
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
          onClick={() => createWallet()}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl py-3 font-semibold text-sm text-white transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900"
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

  const activeWallet = wallets.find(w => w.id === activeWalletId);

  return (
    <div className="space-y-6">
      {/* Active Wallet Display */}
      {activeWallet && publicKey && (
        <div className="bg-gray-900 border border-green-700 rounded-2xl p-6 text-center space-y-5">
          <div className="flex items-center justify-center w-12 h-12 mx-auto rounded-full bg-green-900/50 border border-green-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div>
            <h2 className="text-xl font-bold text-white">
              {activeWallet.alias || 'Wallet'}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Your Stellar wallet is ready. Keep your public key safe — you&apos;ll need it to receive payments.
            </p>
          </div>

          <div className="flex justify-center">
            <QrCanvas value={publicKey} />
          </div>

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
      )}

      {/* Wallet List and Management */}
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            My Wallets ({wallets.length}/5)
          </h3>
          {wallets.length < 5 && (
            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-sm font-medium text-white transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Wallet
            </button>
          )}
        </div>

        {/* Add Wallet Form */}
        {showAddForm && (
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <input
              type="text"
              placeholder="Wallet alias (optional, max 32 chars)"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value.slice(0, 32))}
              maxLength={32}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  await createWallet(newAlias || undefined);
                  setNewAlias('');
                  setShowAddForm(false);
                }}
                disabled={loading}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg py-2 font-medium text-sm text-white transition-colors"
              >
                {loading ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewAlias('');
                }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 rounded-lg py-2 font-medium text-sm text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Wallets List */}
        <div className="space-y-2">
          {wallets.map((wallet) => (
            <div
              key={wallet.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                wallet.id === activeWalletId
                  ? 'bg-indigo-900/20 border-indigo-500'
                  : 'bg-gray-800 border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex-1 min-w-0">
                {editingId === wallet.id ? (
                  <input
                    type="text"
                    value={editingAlias}
                    onChange={(e) => setEditingAlias(e.target.value.slice(0, 32))}
                    maxLength={32}
                    autoFocus
                    className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <div>
                    <p className="text-sm font-medium text-white">
                      {wallet.alias || `Wallet ${wallets.indexOf(wallet) + 1}`}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {wallet.publicKey.slice(0, 8)}...{wallet.publicKey.slice(-8)}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1">
                {wallet.id === activeWalletId && (
                  <span className="px-2 py-1 bg-indigo-600 rounded text-xs font-medium text-white whitespace-nowrap">
                    Active
                  </span>
                )}

                {editingId === wallet.id ? (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        await updateWalletAlias(wallet.id, editingAlias || null);
                        setEditingId(null);
                        setEditingAlias('');
                      }}
                      className="p-2 rounded hover:bg-gray-700 text-green-400"
                      title="Save"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setEditingAlias('');
                      }}
                      className="p-2 rounded hover:bg-gray-700 text-gray-400"
                      title="Cancel"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    {wallet.id !== activeWalletId && (
                      <button
                        type="button"
                        onClick={() => switchWallet(wallet.id)}
                        className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs font-medium text-white transition-colors"
                      >
                        Switch
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(wallet.id);
                        setEditingAlias(wallet.alias || '');
                      }}
                      className="p-2 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
                      title="Edit alias"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    {wallets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeWallet(wallet.id)}
                        className="p-2 rounded hover:bg-red-900/30 text-gray-400 hover:text-red-400"
                        title="Delete wallet"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

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
      </div>
    </div>
  );
}

