/**
 * Client-side SEP-10 authentication helpers.
 *
 * Flow:
 *   1. fetchChallenge(account)   → GET /api/auth/sep10/challenge
 *   2. signWithFreighter(xdr, passphrase) → Freighter wallet signs the XDR
 *   3. submitSignedChallenge(signedXdr)   → POST /api/auth/sep10/verify → JWT
 *   4. sep10Login(account) orchestrates all three steps.
 *
 * Freighter API is loaded lazily so it never breaks server-side rendering.
 */

import axios from 'axios';
import { storeSessionTokens } from './api';

const baseURL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const unauthApi = axios.create({ baseURL });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Sep10ChallengeResponse {
  transaction: string;       // Base64-encoded unsigned XDR
  network_passphrase: string;
}

export interface Sep10TokenResponse {
  token: string;
  stellar_account: string;
  expires_in: number;
}

export interface Sep10LoginResult {
  token: string;
  stellarAccount: string;
}

// ---------------------------------------------------------------------------
// Step 1 — Fetch challenge from the server
// ---------------------------------------------------------------------------

/**
 * Requests a SEP-10 challenge transaction for the given Stellar public key.
 * Returns the unsigned XDR and the network passphrase.
 */
export async function fetchChallenge(
  account: string,
): Promise<Sep10ChallengeResponse> {
  const { data } = await unauthApi.get<Sep10ChallengeResponse>(
    '/api/auth/sep10/challenge',
    { params: { account } },
  );
  return data;
}

// ---------------------------------------------------------------------------
// Step 2 — Sign the challenge with Freighter
// ---------------------------------------------------------------------------

/**
 * Asks Freighter to sign the challenge XDR.
 *
 * Freighter's `signTransaction` API is only available in the browser. This
 * function throws a clear error when called outside a browser context or when
 * Freighter is not installed.
 *
 * @param xdr               Base64-encoded unsigned transaction XDR
 * @param networkPassphrase The Stellar network passphrase (must match the server's)
 * @returns                 Base64-encoded signed transaction XDR
 */
export async function signWithFreighter(
  xdr: string,
  networkPassphrase: string,
): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('Freighter signing is only available in the browser');
  }

  // Dynamic import so the module is never bundled into SSR output.
  const freighter = await import('@stellar/freighter-api');

  // isConnected() was renamed to isAllowed() in newer versions; support both.
  const connected =
    typeof (freighter as any).isAllowed === 'function'
      ? await (freighter as any).isAllowed()
      : typeof freighter.isConnected === 'function'
      ? await freighter.isConnected()
      : false;

  if (!connected) {
    throw new FreighterNotConnectedError(
      'Freighter wallet is not connected. Please install the Freighter browser extension and allow this site.',
    );
  }

  // signTransaction returns the signed XDR string.
  const result = await freighter.signTransaction(xdr, {
    networkPassphrase,
  });

  // Freighter v2+ returns { signedTxXdr: string }, older versions return the string directly.
  if (typeof result === 'string') {
    return result;
  }
  if (result && typeof (result as any).signedTxXdr === 'string') {
    return (result as any).signedTxXdr;
  }

  throw new Error(
    'Unexpected response format from Freighter signTransaction. ' +
      'Ensure @stellar/freighter-api is up to date.',
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Submit signed challenge to get JWT
// ---------------------------------------------------------------------------

/**
 * Submits the signed challenge XDR to the server for verification.
 * On success, returns the JWT token response.
 */
export async function submitSignedChallenge(
  signedXdr: string,
): Promise<Sep10TokenResponse> {
  const { data } = await unauthApi.post<Sep10TokenResponse>(
    '/api/auth/sep10/verify',
    { transaction: signedXdr },
  );
  return data;
}

// ---------------------------------------------------------------------------
// Orchestrator — complete SEP-10 login in one call
// ---------------------------------------------------------------------------

/**
 * Runs the full SEP-10 authentication flow:
 *   1. Fetch challenge from server
 *   2. Sign with Freighter
 *   3. Submit to server for verification
 *   4. Store JWT in localStorage (via storeSessionTokens)
 *
 * @param account  The user's Stellar public key from Freighter
 * @returns        The authenticated stellar account and JWT token
 */
export async function sep10Login(account: string): Promise<Sep10LoginResult> {
  // 1. Fetch the unsigned challenge XDR.
  const { transaction: challengeXdr, network_passphrase } =
    await fetchChallenge(account);

  // 2. Sign with Freighter.
  const signedXdr = await signWithFreighter(challengeXdr, network_passphrase);

  // 3. Verify and obtain JWT.
  const { token, stellar_account } = await submitSignedChallenge(signedXdr);

  // 4. Store token in localStorage so the api.ts interceptor picks it up.
  storeSessionTokens({ access_token: token });

  // Also persist the public key for the walletStore.
  if (typeof window !== 'undefined') {
    localStorage.setItem('publicKey', stellar_account);
  }

  return { token, stellarAccount: stellar_account };
}

// ---------------------------------------------------------------------------
// Freighter public key helper
// ---------------------------------------------------------------------------

/**
 * Retrieves the currently active Stellar public key from Freighter.
 * Returns null if Freighter is not installed or no account is active.
 */
export async function getFreighterPublicKey(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    const freighter = await import('@stellar/freighter-api');
    // getPublicKey() throws or returns empty string when not connected.
    const publicKey = await freighter.getPublicKey();
    return publicKey && publicKey.startsWith('G') ? publicKey : null;
  } catch {
    return null;
  }
}

/**
 * Returns true when the Freighter extension is installed in the browser.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const freighter = await import('@stellar/freighter-api');
    return typeof freighter.isConnected === 'function'
      ? Boolean(await freighter.isConnected())
      : Boolean(await (freighter as any).isAllowed?.());
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class FreighterNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FreighterNotConnectedError';
  }
}

export class Sep10AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'Sep10AuthError';
  }
}
