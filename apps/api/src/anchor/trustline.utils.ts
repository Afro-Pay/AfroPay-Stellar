/**
 * Trustline management utilities for Stellar assets (TypeScript / NestJS layer).
 *
 * Provides detection of existing trustlines, safe creation of missing
 * trustlines, and structured error handling for authorisation / limit issues.
 *
 * Designed to be consumed by AnchorService, WalletService, or any other
 * NestJS service that needs to interact with Stellar non-native assets.
 *
 * @example
 * ```ts
 * import { checkTrustline, ensureTrustline, KNOWN_ASSETS } from './trustline.utils';
 *
 * const status = await checkTrustline(horizonUrl, publicKey, KNOWN_ASSETS.USDC);
 * await ensureTrustline(horizonUrl, keypair, KNOWN_ASSETS.NGN);
 * ```
 */

import { Horizon, Keypair, Asset, TransactionBuilder, Operation, Networks, BASE_FEE } from 'stellar-sdk';
import { Logger } from '@nestjs/common';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TrustlineAsset {
  code: string;
  issuer: string;
}

export type TrustlineStatusType = 'exists' | 'missing' | 'unauthorised' | 'zero_limit';

export interface TrustlineStatus {
  status: TrustlineStatusType;
  /** Present when status is 'exists'. */
  balance?: string;
  /** Present when status is 'exists'. */
  limit?: string;
  asset: TrustlineAsset;
}

export interface TrustlineError {
  code:
    | 'ACCOUNT_NOT_FOUND'
    | 'AUTHORISATION_REQUIRED'
    | 'ZERO_LIMIT'
    | 'INSUFFICIENT_RESERVE'
    | 'HORIZON_ERROR'
    | 'UNKNOWN';
  message: string;
  asset: TrustlineAsset;
  horizonStatus?: number;
}

export interface EnsureTrustlineResult {
  created: boolean;
  txHash?: string;
  status: TrustlineStatus;
}

// ── Well-known assets ────────────────────────────────────────────────────────

/** Pre-configured assets for common use cases. Override via env if needed. */
export const KNOWN_ASSETS: Record<string, TrustlineAsset> = {
  USDC: {
    code: 'USDC',
    issuer:
      process.env.USDC_ISSUER ??
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  NGN: {
    code: 'NGN',
    issuer:
      process.env.NGN_ISSUER ??
      'GABJLI7NOEIY6IXOIQV66XNXNXNXNXNXNXNXNXNXNXNXNXNXNXNXNXN',
  },
};

// ── Core utilities ────────────────────────────────────────────────────────────

const logger = new Logger('TrustlineUtils');

/**
 * Check whether `publicKey` has a trustline for `asset` on Horizon.
 *
 * @returns A `TrustlineStatus` describing the current state.
 * @throws `TrustlineError` when the account does not exist or Horizon returns an error.
 */
export async function checkTrustline(
  horizonUrl: string,
  publicKey: string,
  asset: TrustlineAsset,
): Promise<TrustlineStatus> {
  const server = new Horizon.Server(horizonUrl);

  let account: Horizon.AccountResponse;
  try {
    account = await server.loadAccount(publicKey);
  } catch (err: any) {
    if (err?.response?.status === 404 || err?.name === 'NotFoundError') {
      throw buildError('ACCOUNT_NOT_FOUND', `Account ${publicKey} not found on Horizon`, asset);
    }
    throw buildError('HORIZON_ERROR', `Horizon request failed: ${err?.message}`, asset, err?.response?.status);
  }

  const balance = account.balances.find(
    (b): b is Horizon.HorizonApi.BalanceLine =>
      b.asset_type !== 'native' &&
      (b as any).asset_code === asset.code &&
      (b as any).asset_issuer === asset.issuer,
  ) as any;

  if (!balance) {
    logger.debug(`Trustline missing: ${asset.code} on ${publicKey}`);
    return { status: 'missing', asset };
  }

  const limitVal = parseFloat(balance.limit ?? '0');
  if (limitVal === 0) {
    logger.warn(`Trustline zero limit: ${asset.code} on ${publicKey}`);
    return { status: 'zero_limit', asset };
  }

  if (balance.is_authorized === false) {
    logger.warn(`Trustline unauthorised: ${asset.code} on ${publicKey}`);
    return { status: 'unauthorised', asset };
  }

  logger.debug(`Trustline exists: ${asset.code} on ${publicKey}, balance=${balance.balance}`);
  return {
    status: 'exists',
    balance: balance.balance,
    limit: balance.limit,
    asset,
  };
}

/**
 * Ensure a trustline exists for `asset` on the account controlled by `keypair`.
 *
 * - If the trustline already exists and is usable, this is a **no-op**.
 * - If it is missing, a `ChangeTrust` transaction is submitted.
 * - If it is `unauthorised` or `zero_limit`, a `TrustlineError` is thrown
 *   without attempting submission.
 *
 * @returns `EnsureTrustlineResult` indicating whether a new trustline was created.
 * @throws `TrustlineError` for authorisation, limit, or reserve issues.
 */
export async function ensureTrustline(
  horizonUrl: string,
  keypair: Keypair,
  asset: TrustlineAsset,
  networkPassphrase: string = Networks.TESTNET,
): Promise<EnsureTrustlineResult> {
  const publicKey = keypair.publicKey();
  const current = await checkTrustline(horizonUrl, publicKey, asset);

  if (current.status === 'exists') {
    logger.log(`Trustline already exists for ${asset.code} on ${publicKey}, skipping`);
    return { created: false, status: current };
  }

  if (current.status === 'unauthorised') {
    throw buildError(
      'AUTHORISATION_REQUIRED',
      `Asset ${asset.code} requires issuer authorisation; account is not yet authorised`,
      asset,
    );
  }

  if (current.status === 'zero_limit') {
    throw buildError(
      'ZERO_LIMIT',
      `Trustline limit for ${asset.code} is zero; transfers will be rejected`,
      asset,
    );
  }

  // status === 'missing' — submit ChangeTrust
  logger.log(`Creating trustline for ${asset.code} on ${publicKey}`);
  const txHash = await submitChangeTrust(horizonUrl, keypair, asset, networkPassphrase);

  const updated = await checkTrustline(horizonUrl, publicKey, asset);
  return { created: true, txHash, status: updated };
}

/**
 * Check multiple assets at once.
 * Failures for one asset do not prevent others from being checked.
 */
export async function checkTrustlinesBatch(
  horizonUrl: string,
  publicKey: string,
  assets: TrustlineAsset[],
): Promise<Array<{ asset: TrustlineAsset; result: TrustlineStatus | TrustlineError }>> {
  return Promise.all(
    assets.map(async (asset) => {
      try {
        const result = await checkTrustline(horizonUrl, publicKey, asset);
        return { asset, result };
      } catch (err) {
        return { asset, result: err as TrustlineError };
      }
    }),
  );
}

/**
 * Determine whether a value returned from `checkTrustlinesBatch` is an error.
 */
export function isTrustlineError(value: TrustlineStatus | TrustlineError): value is TrustlineError {
  return 'code' in value && 'message' in value;
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function submitChangeTrust(
  horizonUrl: string,
  keypair: Keypair,
  asset: TrustlineAsset,
  networkPassphrase: string,
): Promise<string> {
  const server = new Horizon.Server(horizonUrl);
  const account = await server.loadAccount(keypair.publicKey());

  const stellarAsset = new Asset(asset.code, asset.issuer);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: stellarAsset }))
    .setTimeout(30)
    .build();

  tx.sign(keypair);

  try {
    const result = await server.submitTransaction(tx);
    return (result as any).hash as string;
  } catch (err: any) {
    const resultCodes = err?.response?.data?.extras?.result_codes;
    const opCode: string = resultCodes?.operations?.[0] ?? '';

    if (opCode === 'op_low_reserve') {
      throw buildError(
        'INSUFFICIENT_RESERVE',
        'Insufficient XLM reserve to create trustline (op_low_reserve)',
        asset,
        err?.response?.status,
      );
    }
    if (opCode === 'op_not_authorized') {
      throw buildError(
        'AUTHORISATION_REQUIRED',
        `Asset ${asset.code} requires issuer authorisation`,
        asset,
        err?.response?.status,
      );
    }
    throw buildError(
      'HORIZON_ERROR',
      `ChangeTrust submission failed: ${opCode || err?.message}`,
      asset,
      err?.response?.status,
    );
  }
}

function buildError(
  code: TrustlineError['code'],
  message: string,
  asset: TrustlineAsset,
  horizonStatus?: number,
): TrustlineError {
  return { code, message, asset, horizonStatus };
}
