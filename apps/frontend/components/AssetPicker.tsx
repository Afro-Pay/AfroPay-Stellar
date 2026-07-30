import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ASSETS, type Asset } from '../lib/assets';

/**
 * Truncate a Stellar public key (or any base32-ish string) to fit on screen.
 * Single source of truth for address display; matches the truncation style
 * used in the header / wallet setup UI.
 */
function truncateAddress(value: string, head = 6, tail = 4): string {
  if (!value) return '';
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function optionId(baseId: string, code: string): string {
  return `${baseId}-opt-${code.toLowerCase()}`;
}

export interface AssetPickerProps {
  /** Display label, e.g. "Asset". */
  label?: string;
  /** Currently-selected asset code. */
  value: string;
  /** Stable change handler — receives both code & issuer so callers don't
   *  need to look the asset up themselves. */
  onChange: (asset: Asset) => void;
  /** Optional id forwarded to the combobox button (for external labels). */
  id?: string;
  /** Disable the picker (e.g. while a transfer is submitting). */
  disabled?: boolean;
}

export default function AssetPicker({
  label = 'Asset',
  value,
  onChange,
  id,
  disabled = false,
}: AssetPickerProps) {
  const generatedId = useId();
  const baseId = id ?? `asset-picker-${generatedId}`;
  const buttonId = `${baseId}-button`;
  const listboxId = `${baseId}-listbox`;
  const helpId = `${baseId}-help`;
  const labelId = `${baseId}-label`;

  const [isOpen, setIsOpen] = useState(false);
  const selectedAsset = ASSETS.find((a) => a.code === value) ?? ASSETS[0];
  // Index of the currently highlighted option (focused via aria-activedescendant).
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      ASSETS.findIndex((a) => a.code === selectedAsset.code),
    ),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Type-ahead buffer ref — keeps typed characters across re-renders without
  // triggering re-renders of their own.
  const typeAheadRef = useRef<{ chars: string; resetAt: number }>({
    chars: '',
    resetAt: 0,
  });

  // Keep activeIndex aligned with `value` whenever the parent flips it.
  useEffect(() => {
    const idx = ASSETS.findIndex((a) => a.code === value);
    if (idx >= 0) setActiveIndex(idx);
  }, [value]);

  // Close on click outside — `mousedown` so we beat the button's own click.
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen]);

  const commitSelection = useCallback(
    (asset: Asset) => {
      onChange(asset);
      setIsOpen(false);
      buttonRef.current?.focus();
    },
    [onChange],
  );

  const moveActive = useCallback(
    (delta: number) => {
      setActiveIndex((prev) => {
        const next = (prev + delta + ASSETS.length) % ASSETS.length;
        return next;
      });
    },
    [],
  );

  const jumpTo = useCallback((idx: number) => {
    setActiveIndex(Math.max(0, Math.min(ASSETS.length - 1, idx)));
  }, []);

  const handleTypeAhead = useCallback(
    (key: string) => {
      const now = Date.now();
      // Reset the buffer if it's been more than ~700ms since the last key.
      if (now - typeAheadRef.current.resetAt > 700) {
        typeAheadRef.current.chars = '';
      }
      typeAheadRef.current.chars += key.toLowerCase();
      typeAheadRef.current.resetAt = now;

      // Find the first asset whose code starts with the buffered string,
      // searching forward from the current active index.
      const chars = typeAheadRef.current.chars;
      for (let i = 0; i < ASSETS.length; i++) {
        const candidate = ASSETS[(activeIndex + 1 + i) % ASSETS.length];
        if (candidate.code.toLowerCase().startsWith(chars)) {
          setActiveIndex(ASSETS.indexOf(candidate));
          return;
        }
      }
    },
    [activeIndex],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          moveActive(1);
        }
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          moveActive(-1);
        }
        return;
      }
      case 'Home': {
        if (isOpen) {
          event.preventDefault();
          jumpTo(0);
        }
        return;
      }
      case 'End': {
        if (isOpen) {
          event.preventDefault();
          jumpTo(ASSETS.length - 1);
        }
        return;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else if (ASSETS[activeIndex]) {
          commitSelection(ASSETS[activeIndex]);
        }
        return;
      }
      case 'Escape': {
        if (isOpen) {
          event.preventDefault();
          setIsOpen(false);
          // Reset highlight to the currently selected asset on Escape.
          const idx = ASSETS.findIndex((a) => a.code === selectedAsset.code);
          if (idx >= 0) setActiveIndex(idx);
        }
        return;
      }
      case 'Tab': {
        // Closing on Tab keeps focus moving naturally through the form.
        setIsOpen(false);
        return;
      }
      default: {
        // Single-character type-ahead. Per the WAI-ARIA combobox pattern, the
        // first printable key opens the popup and jumps to the matching
        // option — even when the popup is closed.
        if (event.key.length === 1 && /^[a-zA-Z0-9]$/.test(event.key)) {
          if (!isOpen) setIsOpen(true);
          handleTypeAhead(event.key);
        }
      }
    }
  };

  const activeOptionId = optionId(baseId, ASSETS[activeIndex]?.code ?? '');

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center justify-between mb-1">
        <label
          id={labelId}
          htmlFor={buttonId}
          className="block text-xs font-medium text-gray-300"
        >
          {label}
        </label>
        {/* Info button — focusable helper that exposes the issuer explanation
            to screen readers via aria-describedby + to visual users via a
            hover/focus-visible tooltip-style popover. */}
        <button
          type="button"
          aria-describedby={helpId}
          aria-label={`What does the issuer mean?`}
          className="group relative inline-flex items-center text-gray-400 hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-full p-0.5"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <span
            role="tooltip"
            id={helpId}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-700 bg-gray-900 text-xs text-gray-200 p-3 opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus:opacity-100 group-focus:translate-y-0 shadow-xl z-20"
          >
            <span className="block font-semibold text-indigo-300 mb-1">
              About the issuer
            </span>
            Non-native assets on Stellar are issued by a trusted account (the
            &ldquo;issuer&rdquo;). Two tokens with the same code but different
            issuers are <span className="font-medium text-white">different assets</span>.
            Pick the exact issuer you want to send so the recipient&apos;s
            trustline matches. Native XLM has no issuer.
          </span>
        </button>
      </div>

      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-activedescendant={isOpen ? activeOptionId : undefined}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleKeyDown}
        className="w-full bg-gray-800 rounded-lg p-3 text-sm outline-none border border-gray-700/50 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all flex items-center justify-between disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">{selectedAsset.code}</span>
          {selectedAsset.isNative ? (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex-shrink-0">
              Native
            </span>
          ) : (
            <span className="text-xs text-gray-400 truncate">
              {selectedAsset.issuerName}
            </span>
          )}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className="absolute z-10 mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-h-64 overflow-y-auto focus:outline-none"
        >
          {ASSETS.map((asset, idx) => {
            const isActive = idx === activeIndex;
            const isSelected = asset.code === selectedAsset.code;
            const id = optionId(baseId, asset.code);
            // Build a complete label for screen readers and hover tooltips
            // so truncated visual content stays discoverable.
            const fullLabel = asset.isNative
              ? `${asset.code} native asset`
              : `${asset.code} issued by ${asset.issuerName ?? 'unknown issuer'}${
                  asset.issuer ? ` (${asset.issuer})` : ''
                }`;

            return (
              <li
                key={asset.code}
                id={id}
                role="option"
                aria-selected={isSelected}
                title={fullLabel}
                aria-label={fullLabel}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => commitSelection(asset)}
                className={`px-3 py-2.5 text-sm cursor-pointer flex items-start gap-3 transition-colors ${
                  isActive
                    ? 'bg-indigo-500/15 text-white'
                    : 'text-gray-200 hover:bg-gray-800/70'
                }`}
              >
                <span
                  className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 flex items-center justify-center ${
                    isSelected
                      ? 'border-indigo-400 bg-indigo-500'
                      : 'border-gray-600'
                  }`}
                  aria-hidden="true"
                >
                  {isSelected && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold truncate">{asset.code}</span>
                    {asset.isNative && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex-shrink-0">
                        Native
                      </span>
                    )}
                  </span>
                  {asset.isNative ? (
                    <span className="block text-xs text-gray-400">
                      Native Stellar asset — no issuer.
                    </span>
                  ) : (
                    <>
                      <span className="block text-xs text-gray-300 truncate">
                        {asset.issuerName ?? 'Unknown issuer'}
                      </span>
                      {asset.issuer && (
                        <span className="block text-[11px] text-gray-500 font-mono truncate">
                          {truncateAddress(asset.issuer)}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
