'use client';

import { useEffect, useState, useCallback } from 'react';
import { subscribe, drainQueue } from '../../lib/syncEngine';
import { getQueuedDrafts, removeDraft, clearQueue } from '../../lib/offlineQueue';
import type { OfflineTransactionDraft } from '../../lib/offlineQueue';

type SyncState = 'idle' | 'syncing' | 'error';

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [queuedCount, setQueuedCount] = useState(0);
  const [failedDrafts, setFailedDrafts] = useState<OfflineTransactionDraft[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Track online/offline status.
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Subscribe to sync state changes.
  useEffect(() => {
    const unsub = subscribe((state, _details) => {
      setSyncState(state);
    });
    return unsub;
  }, []);

  // Refresh queue stats periodically.
  const refreshQueue = useCallback(async () => {
    const drafts = await getQueuedDrafts();
    setQueuedCount(drafts.filter((d) => d.status !== 'failed').length);
    setFailedDrafts(drafts.filter((d) => d.status === 'failed'));
  }, []);

  useEffect(() => {
    refreshQueue();
    const interval = setInterval(refreshQueue, 5_000);
    return () => clearInterval(interval);
  }, [refreshQueue]);

  const handleRetry = async () => {
    await drainQueue();
    setTimeout(refreshQueue, 1_000);
  };

  const handleDiscard = async (id: number) => {
    await removeDraft(id);
    refreshQueue();
  };

  const handleClearAll = async () => {
    await clearQueue();
    refreshQueue();
  };

  const statusIcon = () => {
    if (!isOnline) return '📡';
    if (syncState === 'syncing') return '🔄';
    if (queuedCount > 0) return '📋';
    return '✅';
  };

  const statusText = () => {
    if (!isOnline) return 'You are offline. Transfers will be queued and sent automatically when you reconnect.';
    if (syncState === 'syncing') return `Syncing queued transfers (${queuedCount} remaining)...`;
    if (queuedCount > 0) return `${queuedCount} queued transfer${queuedCount > 1 ? 's' : ''} pending.`;
    return null;
  };

  const showBanner = !isOnline || queuedCount > 0 || syncState === 'syncing';

  if (!showBanner) return null;

  return (
    <div
      className={`sticky top-0 z-40 w-full text-sm transition-all ${
        !isOnline
          ? 'bg-amber-500/10 border-b border-amber-500/20'
          : syncState === 'syncing'
          ? 'bg-blue-500/10 border-b border-blue-500/20'
          : 'bg-gray-800/50 border-b border-gray-700/50'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-3xl mx-auto px-4 py-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between gap-2 text-left"
          aria-expanded={expanded}
        >
          <span className="flex items-center gap-2">
            <span className="text-base">{statusIcon()}</span>
            <span className={!isOnline ? 'text-amber-300' : 'text-gray-300'}>
              {statusText() || 'All transfers synced.'}
            </span>
          </span>
          <span className="text-gray-500 text-xs shrink-0">
            {expanded ? '▲' : '▼'}
          </span>
        </button>

        {expanded && (
          <div className="mt-2 space-y-2 border-t border-gray-700/30 pt-2">
            {/* Failed drafts */}
            {failedDrafts.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-red-400 font-medium">
                  {failedDrafts.length} failed transfer{failedDrafts.length > 1 ? 's' : ''}
                </p>
                {failedDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="flex items-center justify-between gap-2 bg-red-500/5 rounded-lg px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-300 truncate">
                        {draft.amount} {draft.assetCode} → {draft.destinationPublicKey.slice(0, 8)}…
                      </p>
                      {draft.lastError && (
                        <p className="text-red-400/80 truncate mt-0.5">{draft.lastError}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDiscard(draft.id!)}
                        className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-400 text-xs"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleRetry}
                    disabled={syncState === 'syncing'}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium"
                  >
                    {syncState === 'syncing' ? 'Syncing...' : 'Retry All'}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-400 text-xs"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            )}

            {/* Pending count */}
            {queuedCount > 0 && failedDrafts.length === 0 && (
              <p className="text-xs text-gray-500">
                Queued transfers will be sent automatically when you are back online.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}