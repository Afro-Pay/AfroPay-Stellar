import { useState, useEffect, useCallback } from 'react';
import {
  sep10Login,
  getFreighterPublicKey,
  isFreighterInstalled,
  FreighterNotConnectedError,
  Sep10AuthError,
} from '../lib/sep10';

interface Sep10LoginButtonProps {
  /** Called on successful authentication with the Stellar public key and JWT. */
  onSuccess: (stellarAccount: string, token: string) => void;
  /** Called when authentication fails. */
  onError?: (message: string) => void;
  /** Extra Tailwind classes appended to the button wrapper. */
  className?: string;
}

type ButtonState =
  | 'idle'
  | 'checking'      // probing Freighter
  | 'connecting'    // waiting for Freighter permission
  | 'signing'       // waiting for Freighter signature
  | 'verifying'     // POST /auth/sep10/verify in flight
  | 'success';

/**
 * Self-contained Freighter wallet connect + SEP-10 login button.
 *
 * State machine:
 *   idle → checking → connecting → signing → verifying → success
 *
 * Each state has its own label and disabled state to prevent double-submission.
 */
export default function Sep10LoginButton({
  onSuccess,
  onError,
  className = '',
}: Sep10LoginButtonProps) {
  const [state, setState] = useState<ButtonState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [freighterAvailable, setFreighterAvailable] = useState<boolean | null>(null);

  // Probe for Freighter on mount (without blocking render).
  useEffect(() => {
    let cancelled = false;
    isFreighterInstalled().then((installed) => {
      if (!cancelled) setFreighterAvailable(installed);
    });
    return () => { cancelled = true; };
  }, []);

  const handleClick = useCallback(async () => {
    if (state !== 'idle') return;

    setError(null);
    setState('checking');

    try {
      // 1. Retrieve the active Freighter public key.
      setState('connecting');
      const publicKey = await getFreighterPublicKey();

      if (!publicKey) {
        throw new FreighterNotConnectedError(
          'No Stellar account found in Freighter. ' +
            'Please open Freighter and ensure an account is active.',
        );
      }

      // 2. Run the full SEP-10 challenge/sign/verify flow.
      setState('signing');
      const { token, stellarAccount } = await sep10Login(publicKey);

      setState('success');
      onSuccess(stellarAccount, token);
    } catch (err: any) {
      setState('idle');

      let message: string;

      if (err instanceof FreighterNotConnectedError) {
        message = err.message;
      } else if (err instanceof Sep10AuthError) {
        message = err.message;
      } else if (err?.response?.data?.message) {
        // Axios error from the API
        const apiMsg = err.response.data.message;
        message = Array.isArray(apiMsg) ? apiMsg.join(', ') : String(apiMsg);
      } else if (err?.message) {
        message = err.message;
      } else {
        message = 'Authentication failed. Please try again.';
      }

      setError(message);
      onError?.(message);
    }
  }, [state, onSuccess, onError]);

  const labels: Record<ButtonState, string> = {
    idle: 'Connect Freighter Wallet',
    checking: 'Checking wallet…',
    connecting: 'Connecting to Freighter…',
    signing: 'Sign the challenge in Freighter…',
    verifying: 'Verifying signature…',
    success: 'Authenticated ✓',
  };

  const isDisabled = state !== 'idle';

  return (
    <div className={`space-y-2 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        aria-busy={isDisabled && state !== 'success'}
        aria-label={labels[state]}
        className={[
          'w-full flex items-center justify-center gap-3 rounded-lg p-3 font-semibold text-sm',
          'transition-all active:scale-[0.99]',
          'focus:outline-none focus:ring-2 focus:ring-indigo-400',
          'border',
          isDisabled
            ? 'bg-gray-800 border-gray-700 text-gray-400 cursor-not-allowed'
            : 'bg-gray-900 border-gray-700 text-white hover:border-indigo-500 hover:bg-indigo-500/10',
        ].join(' ')}
      >
        {/* Freighter / Stellar icon */}
        <FreighterIcon spinning={isDisabled && state !== 'success'} />
        <span>{labels[state]}</span>
      </button>

      {/* Freighter not installed notice */}
      {freighterAvailable === false && state === 'idle' && (
        <p className="text-xs text-center text-amber-400/80">
          Freighter wallet not detected.{' '}
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-400 rounded"
          >
            Install Freighter
          </a>{' '}
          to use wallet login.
        </p>
      )}

      {/* Error message */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-300 space-y-0.5"
        >
          <p className="font-semibold text-red-400">Wallet authentication failed</p>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline icon component
// ---------------------------------------------------------------------------

function FreighterIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`h-5 w-5 shrink-0 ${spinning ? 'animate-spin opacity-60' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
    >
      {spinning ? (
        // Spinner arc
        <path
          strokeLinecap="round"
          d="M12 2a10 10 0 0 1 10 10"
        />
      ) : (
        // Stellar-style star / wallet icon
        <>
          <circle cx="12" cy="12" r="9" strokeOpacity="0.4" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 7v5l3 3"
          />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}
