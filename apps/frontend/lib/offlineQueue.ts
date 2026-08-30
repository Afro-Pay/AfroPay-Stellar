/**
 * IndexedDB-backed offline queue for transaction drafts.
 *
 * Drafts are persisted locally so a user can fill and submit a transfer form
 * while offline. The queue is drained by the sync engine once connectivity is
 * restored (see `./syncEngine.ts`).
 *
 * The store keeps `status` on each record so the sync engine can claim records
 * without double-posting them:
 *   - "pending"  — waiting to be synced
 *   - "syncing"  — currently being POSTed (claimed); a crashed tab leaves these
 *                  stale, so the engine resets them after the lock expires
 *   - "failed"   — the server rejected the draft; surfaced in the UI, retried
 *                  manually, or discarded
 */

export interface OfflineTransactionDraft {
  id?: number;
  destinationPublicKey: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
  /** ISO timestamp of when the draft was created locally. */
  createdAt: string;
  status: 'pending' | 'syncing' | 'failed';
  /** Allowed to flip back to "pending" only past this ISO timestamp. */
  lockExpiresAt?: string;
  lastError?: string;
 /** Number of failed delivery attempts so far. */
  attemptCount: number;
}

const DB_NAME = 'remitx-offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        // Index by status so pending/syncing scans are cheap.
        store.createIndex('status', 'status', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = fn(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** Save a new draft to the queue. Returns the auto-generated id. */
export function enqueueDraft(
  draft: Omit<OfflineTransactionDraft, 'id' | 'createdAt' | 'status' | 'attemptCount'>,
): Promise<IDBValidKey> {
  const record = {
    ...draft,
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
    attemptCount: 0,
  };
  return withStore<IDBValidKey>('readwrite', (store) => store.add(record));
}

/** List every queued draft, ordered by insertion (oldest first). */
export function getQueuedDrafts(): Promise<OfflineTransactionDraft[]> {
  return openDb().then(
    (db) =>
      new Promise<OfflineTransactionDraft[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
          const all = (request.result as OfflineTransactionDraft[]).sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          );
          resolve(all);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

/** Count of drafts that still need to reach the server. */
export function getPendingCount(): Promise<number> {
  return getQueuedDrafts().then(
    (all) => all.filter((d) => d.status !== 'failed').length,
  );
}

/** Atomically claim a draft for delivery so parallel workers never double-post. */
export function claimDraft(id: number, lockMs = 60_000): Promise<void> {
  return withStore<void>('readwrite', (store) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const draft = getReq.result as OfflineTransactionDraft | undefined;
      if (!draft) return;
      draft.status = 'syncing';
      draft.lockExpiresAt = new Date(Date.now() + lockMs).toISOString();
      store.put(draft);
    };
    return getReq as unknown as IDBRequest<void>;
  });
}

/** Reset a stale "syncing" lock back to "pending"; returns count reset. */
export function releaseExpiredLocks(): Promise<number> {
  return openDb().then(
    (db) =>
      new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getAllReq = store.getAll();
        let reset = 0;
        const now = Date.now();

        getAllReq.onsuccess = () => {
          const records = getAllReq.result as OfflineTransactionDraft[];
          for (const record of records) {
            if (
              record.status === 'syncing' &&
              record.lockExpiresAt &&
              new Date(record.lockExpiresAt).getTime() < now
            ) {
              record.status = 'pending';
              delete record.lockExpiresAt;
              store.put(record);
              reset += 1;
            }
          }
        };
        getAllReq.onerror = () => reject(getAllReq.error);
        tx.oncomplete = () => resolve(reset);
      }),
  );
}

/** Mark a draft as failed with the server-provided message. */
export function markDraftFailed(id: number, lastError: string): Promise<void> {
  return withStore<void>('readwrite', (store) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const draft = getReq.result as OfflineTransactionDraft | undefined;
      if (!draft) return;
      draft.status = 'failed';
      delete draft.lockExpiresAt;
      draft.lastError = lastError;
      draft.attemptCount += 1;
      store.put(draft);
    };
    return getReq as unknown as IDBRequest<void>;
  });
}

/** Push a draft back to the pending queue after a transient network failure. */
export function requeueDraft(id: number, lastError: string): Promise<void> {
  return withStore<void>('readwrite', (store) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const draft = getReq.result as OfflineTransactionDraft | undefined;
      if (!draft) return;
      draft.status = 'pending';
      delete draft.lockExpiresAt;
      draft.lastError = lastError;
      draft.attemptCount += 1;
      store.put(draft);
    };
    return getReq as unknown as IDBRequest<void>;
  });
}

/** Remove a draft from the queue (delivered or user-discarded). */
export function removeDraft(id: number): Promise<void> {
  return withStore<void>('readwrite', (store) => store.delete(id));
}

export function clearQueue(): Promise<void> {
  return withStore<void>('readwrite', (store) => store.clear());
}