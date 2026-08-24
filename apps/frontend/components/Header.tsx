import { useMemo, useState } from "react";
import { useTheme } from "../lib/useTheme";
import { useWalletStore } from "../store/walletStore";

function truncateMiddle(value: string, start = 6, end = 4) {
  if (!value) return "";
  if (value.length <= start + end) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export default function Header() {
  const { toggleTheme, ariaLabel } = useTheme();
  const { wallets, activeWalletId, publicKey, switchWallet } = useWalletStore();
  const [showWalletDropdown, setShowWalletDropdown] = useState(false);

  const activeWallet = useMemo(() => {
    return wallets.find(w => w.id === activeWalletId);
  }, [wallets, activeWalletId]);

  const truncated = publicKey ? truncateMiddle(publicKey) : "Public key";
  const walletLabel = activeWallet?.alias || `Wallet ${wallets.indexOf(activeWallet || wallets[0]) + 1}` || "No Wallet";

  return (
    <header className="w-full sticky top-0 z-30 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200/70 dark:border-gray-800/70">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-bold text-base sm:text-lg text-gray-900 dark:text-white leading-tight">
            RemitX
          </div>
          
          {/* Wallet Picker */}
          {wallets.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowWalletDropdown(!showWalletDropdown)}
                className="text-[11px] sm:text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 truncate flex items-center gap-1 focus:outline-none"
              >
                <span className="truncate">{walletLabel}</span>
                {wallets.length > 1 && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-3 w-3 flex-shrink-0 transition-transform ${
                      showWalletDropdown ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 14l-7 7m0 0l-7-7m7 7V3"
                    />
                  </svg>
                )}
              </button>

              {/* Wallet Dropdown Menu */}
              {showWalletDropdown && wallets.length > 1 && (
                <div className="absolute left-0 mt-2 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-40">
                  {wallets.map((wallet) => (
                    <button
                      key={wallet.id}
                      type="button"
                      onClick={() => {
                        switchWallet(wallet.id);
                        setShowWalletDropdown(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                        wallet.id === activeWalletId
                          ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100 font-medium'
                          : 'text-gray-900 dark:text-gray-300'
                      } ${wallets.indexOf(wallet) !== 0 ? 'border-t border-gray-200 dark:border-gray-800' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">
                            {wallet.alias || `Wallet ${wallets.indexOf(wallet) + 1}`}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {truncateMiddle(wallet.publicKey, 6, 4)}
                          </div>
                        </div>
                        {wallet.id === activeWalletId && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                          </svg>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] sm:text-xs text-gray-600 dark:text-gray-300 truncate">
              {truncated}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={ariaLabel}
          className="shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 hover:bg-gray-50 dark:hover:bg-gray-900 text-gray-900 dark:text-white p-2"
        >
          <SunMoonIcon />
        </button>
      </div>
    </header>
  );
}

function SunMoonIcon() {
  // Icon swaps via CSS with dark class.
  return (
    <span className="relative w-5 h-5 inline-block" aria-hidden>
      <svg
        className="absolute inset-0 transition-opacity duration-200 dark:opacity-0 opacity-100"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="M4.93 4.93l1.41 1.41" />
        <path d="M17.66 17.66l1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="M4.93 19.07l1.41-1.41" />
        <path d="M17.66 6.34l1.41-1.41" />
      </svg>
      <svg
        className="absolute inset-0 transition-opacity duration-200 dark:opacity-100 opacity-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </span>
  );
}

