/**
 * Friendbot funding helper for Stellar testnet.
 *
 * The Stellar testnet provides a "Friendbot" service that funds a new account
 * with 10,000 XLM so tests can run without real funds.
 *
 * Usage in tests:
 *   import { fundTestnetAccount } from './friendbot';
 *   await fundTestnetAccount('G...');
 *
 * When STELLAR_NETWORK !== 'testnet' or SKIP_FRIENDBOT=true the call is a
 * no-op so the same suite can run against an already-funded account in CI.
 *
 * The function retries up to MAX_ATTEMPTS times with exponential back-off;
 * accounts that have already been funded return a 400 from Friendbot and
 * those are silently ignored.
 */

import axios from 'axios';

const FRIENDBOT_URL =
  process.env.FRIENDBOT_URL ?? 'https://friendbot.stellar.org';
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;

/** Fund a testnet account via Stellar Friendbot. */
export async function fundTestnetAccount(publicKey: string): Promise<void> {
  if (
    process.env.STELLAR_NETWORK !== 'testnet' ||
    process.env.SKIP_FRIENDBOT === 'true'
  ) {
    return;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await axios.get(FRIENDBOT_URL, {
        params: { addr: publicKey },
        timeout: 15_000,
      });
      return; // success
    } catch (err: any) {
      // HTTP 400 means "already funded" — perfectly fine, treat as success.
      if (err?.response?.status === 400) {
        return;
      }
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Friendbot failed after ${MAX_ATTEMPTS} attempts for ${publicKey}: ${String(lastError)}`,
  );
}

/**
 * Poll Horizon until the account shows at least `minXlm` XLM balance (or
 * `timeoutMs` elapses).  Useful after Friendbot to wait for ledger close.
 */
export async function waitForBalance(
  publicKey: string,
  minXlm = 1,
  timeoutMs = 30_000,
): Promise<void> {
  if (
    process.env.STELLAR_NETWORK !== 'testnet' ||
    process.env.SKIP_FRIENDBOT === 'true'
  ) {
    return;
  }

  const horizonUrl =
    process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL = 2_000;

  while (Date.now() < deadline) {
    try {
      const { data } = await axios.get(
        `${horizonUrl}/accounts/${publicKey}`,
        { timeout: 10_000 },
      );
      const xlmBalance = (data.balances ?? []).find(
        (b: any) => b.asset_type === 'native',
      );
      if (xlmBalance && parseFloat(xlmBalance.balance) >= minXlm) {
        return;
      }
    } catch {
      // Account may not exist yet — keep polling
    }
    await sleep(POLL_INTERVAL);
  }

  throw new Error(
    `Account ${publicKey} did not reach ${minXlm} XLM within ${timeoutMs}ms`,
  );
}

/**
 * Poll Horizon until a transaction hash appears in the ledger.
 * Returns when the hash is confirmed or throws after timeoutMs.
 */
export async function waitForTxConfirmation(
  txHash: string,
  timeoutMs = 30_000,
): Promise<void> {
  if (process.env.SKIP_HORIZON_POLL === 'true') {
    return;
  }

  const horizonUrl =
    process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL = 2_000;

  while (Date.now() < deadline) {
    try {
      const { data } = await axios.get(
        `${horizonUrl}/transactions/${txHash}`,
        { timeout: 10_000 },
      );
      if (data.successful === true) return;
    } catch (err: any) {
      if (err?.response?.status !== 404) {
        // Non-404 errors are unexpected; keep polling but don't swallow them.
      }
    }
    await sleep(POLL_INTERVAL);
  }

  throw new Error(
    `Transaction ${txHash} was not confirmed on Horizon within ${timeoutMs}ms`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
