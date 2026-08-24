import {useMemo} from "react";
import {useTheme} from "../lib/useTheme";

function truncateMiddle(value: string, start = 6, end = 4) {
  if (!value) return "";
  if (value.length <= start + end) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export default function Header() {
  const {toggleTheme, ariaLabel} = useTheme();

  // Attempt to read public key from common places.
  const publicKey = useMemo(() => {
    if (typeof window === "undefined") return "";

    const token = window.localStorage.getItem("token");
    // If token is a JWT-like string, we don't want to display it as a public key.
    // So we only display a public key if there is an explicit value.
    const key = window.localStorage.getItem("publicKey");
    return key || "";
  }, []);

  const truncated = publicKey ? truncateMiddle(publicKey) : "Public key";

  return (
    <header className="w-full sticky top-0 z-30 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200/70 dark:border-gray-800/70">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-base sm:text-lg text-gray-900 dark:text-white leading-tight">
            RemitX
          </div>
          <div className="text-[11px] sm:text-xs text-gray-600 dark:text-gray-300 truncate">
            {truncated}
          </div>
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
