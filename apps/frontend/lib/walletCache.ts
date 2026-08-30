import { openDB, type DBSchema } from 'idb';
import type { Balance, Transaction } from '../hooks/useWalletData';

interface WalletCacheSchema extends DBSchema {
  state: {
    key: string;
    value: Record<string, unknown>;
  };
}

const DB_NAME = 'remitx-wallet-cache';
const STORE_NAME = 'state';

function cacheKey(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('publicKey');
}

function getDatabase() {
  if (typeof indexedDB === 'undefined') return null;
  return openDB<WalletCacheSchema>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME);
    },
  });
}

export async function readWalletState(): Promise<Record<string, unknown> | null> {
  const key = cacheKey();
  const db = getDatabase();
  if (!key || !db) return null;
  return (await db).get(STORE_NAME, key);
}

export async function writeWalletState(state: Record<string, unknown>): Promise<void> {
  const key = cacheKey();
  const db = getDatabase();
  if (!key || !db) return;
  await (await db).put(STORE_NAME, {
    balances: Array.isArray(state.balances) ? state.balances : [],
    transactions: Array.isArray(state.transactions) ? state.transactions.slice(0, 50) : [],
    balancesUpdatedAt: state.balancesUpdatedAt ?? null,
    transactionsUpdatedAt: state.transactionsUpdatedAt ?? null,
  }, key);
}

export function getWalletCacheKey(): string | null {
  return cacheKey();
}

export type CachedWalletState = {
  balances: Balance[];
  transactions: Transaction[];
  balancesUpdatedAt: number | null;
  transactionsUpdatedAt: number | null;
};