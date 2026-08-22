import { enqueueDraft, getQueuedDrafts, claimDraft, markDraftFailed, removeDraft, releaseExpiredLocks, requeueDraft } from './offlineQueue';
import api from './api';
import type { OfflineTransactionDraft } from './offlineQueue';

type SyncState = 'idle' | 'syncing' | 'error';
type SyncListener = (state: SyncState, details: { completed: number; failed: number; total: number }) => void;

let syncState: SyncState = 'idle';
let isSyncingNow = false;
const listeners = new Set<SyncListener>();

function notify(state: SyncState, details: { completed: number; failed: number; total: number }) {
  syncState = state;
  listeners.forEach((fn) => fn(state, details));
}

export function subscribe(fn: SyncListener): () => void {
  listeners.add(fn);
  // Immediately emit current state.
  fn(syncState, { completed: 0, failed: 0, total: 0 });
  return () => listeners.delete(fn);
}

/**
 * Process one falling-offline queue insertion.
 * Returns the auto-generated ID of the queued draft.
 */
export async function queueOfflineDraft(
  payload: Omit<OfflineTransactionDraft, 'id' | 'createdAt' | 'status' | 'attemptCount'>,
): Promise<IDBValidKey> {
  return enqueueDraft(payload);
}

/**
 * Drain the queue: POST each pending draft to the server in FIFO order.
 *
 * The engine uses a simple lock via `claimDraft` to prevent double-posting if
 * two tabs both come online at the same time.
 */
export async function drainQueue(): Promise<void> {
  if (isSyncingNow) return;
  isSyncingNow = true;
  notify('syncing', { completed: 0, failed: 0, total: 0 });

  // First, release any stale locks from a crashed tab.
  await releaseExpiredLocks();

  const drafts = await getQueuedDrafts();
  // Only pending drafts are eligible; failed drafts are retried manually via
  // the UI ("Retry All") or by clearing the queue.
  const pending = drafts.filter((d) => d.status === 'pending');
  const total = pending.length;
  let completed = 0;
  let failed = 0;

  try {
    for (const draft of pending) {
      if (!draft.id) continue;

      // Claim this draft atomically.
      try {
        await claimDraft(draft.id);
      } catch {
        // Another tab may have claimed it first.
        continue;
      }

      try {
        await api.post('/transactions/send', {
          destinationPublicKey: draft.destinationPublicKey,
          amount: draft.amount,
          assetCode: draft.assetCode,
          assetIssuer: draft.assetIssuer,
          memo: draft.memo,
        });
        // Success — remove from the queue.
        await removeDraft(draft.id);
        completed += 1;
      } catch (error: any) {
        const status = error?.response?.status;
        // 4xx = permanent failure (bad request, invalid destination, etc.) —
        // surface in the UI for manual retry/discard.
        if (status && status >= 400 && status < 500) {
          await markDraftFailed(draft.id, error?.response?.data?.message ?? `HTTP ${status}`);
          failed += 1;
        } else {
          // Transient error (5xx / network) — requeue so the next drain cycle
          // (online event or 2-minute interval) retries it.
          await requeueDraft(draft.id, error?.response?.data?.message ?? 'Network error');
        }
      }
    }
  } finally {
    isSyncingNow = false;
    notify(failed > 0 ? 'error' : 'idle', { completed, failed, total });
  }
}

/**
 * Create and start the sync engine. Call once from `_app.tsx`.
 *
 * It listens to `online`/`offline` events and drains the queue when the
 * browser reconnects. It also runs once on mount to catch any leftover drafts.
 */
export function startSyncEngine(): () => void {
  // Drain on mount (catches drafts left from a previous session).
  if (navigator.onLine) {
    drainQueue();
  }

  const handleOnline = () => drainQueue();
  window.addEventListener('online', handleOnline);

  // Periodically retry failed drafts while online (every 2 minutes).
  const interval = setInterval(() => {
    if (navigator.onLine) drainQueue();
  }, 120_000);

  return () => {
    window.removeEventListener('online', handleOnline);
    clearInterval(interval);
  };
}