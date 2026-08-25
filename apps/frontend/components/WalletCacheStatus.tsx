import { CloudOff } from 'lucide-react';

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function WalletCacheStatus({ updatedAt }: { updatedAt: number | null }) {
  if (!updatedAt) return null;
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <p className={`mb-3 flex items-center gap-1 text-xs ${offline ? 'text-amber-600 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`} role="status" aria-live="polite">
      {offline && <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />}
      Last updated {relativeTime(updatedAt)}
    </p>
  );
}