import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { Transaction } from '../store/walletStore';

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: 'text-green-400 bg-green-400/10',
  PENDING: 'text-yellow-400 bg-yellow-400/10',
  FAILED: 'text-red-400 bg-red-400/10',
  RETRYING: 'text-orange-400 bg-orange-400/10',
};

export default function TransactionRow({ tx }: { tx: Transaction }) {
  const [expanded, setExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  const statusStyle = STATUS_COLORS[tx.status] ?? 'text-gray-400 bg-gray-400/10';
  const detailsId = `transaction-details-${tx.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;

  const copyHash = async () => {
    if (!tx.stellarTxHash) return;

    await navigator.clipboard.writeText(tx.stellarTxHash);
    setCopyStatus('Transaction hash copied.');
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden transition-all duration-200">
      <button
        type="button"
        className="w-full p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center text-left hover:bg-gray-800/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} transaction ${tx.amount} ${tx.assetCode} to ${tx.destination}, status ${tx.status}`}
      >
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold shrink-0" aria-hidden="true">
            {tx.assetCode.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-100">{tx.amount} {tx.assetCode}</p>
            <p className="text-xs text-gray-400 truncate max-w-[200px] sm:max-w-[300px]" title={tx.destination}>
              To: {tx.destination}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{new Date(tx.createdAt).toLocaleString()}</p>
          </div>
        </div>
        
        <div className="flex items-center justify-between w-full sm:w-auto mt-4 sm:mt-0 shrink-0">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusStyle}`}>
            {tx.status}
          </span>
          <span className="ml-4 text-gray-500 transition-colors" aria-hidden="true">
            {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </span>
        </div>
      </button>

      {expanded && (
        <div id={detailsId} className="p-4 border-t border-gray-800 bg-gray-900/50 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="min-w-0">
              <p className="text-xs text-gray-500 mb-1">Stellar Tx Hash</p>
              <div className="flex items-center gap-2">
                <p className="text-gray-300 truncate font-mono text-xs" title={tx.stellarTxHash || 'N/A'}>
                  {tx.stellarTxHash || 'N/A'}
                </p>
                {tx.stellarTxHash && (
                  <button
                    type="button"
                    onClick={copyHash}
                    className="text-gray-500 hover:text-indigo-400 shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                    title="Copy hash"
                    aria-label="Copy Stellar transaction hash"
                  >
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              {copyStatus && (
                <p className="sr-only" role="status" aria-live="polite">
                  {copyStatus}
                </p>
              )}
            </div>
            
            <div>
              <p className="text-xs text-gray-500 mb-1">Fee Breakdown</p>
              <p className="text-gray-300 font-medium">{tx.fee || '0 XLM'}</p>
            </div>

            <div className="md:col-span-2">
              <p className="text-xs text-gray-500 mb-1">Anchor Info</p>
              <p className="text-gray-300">{tx.anchorInfo || 'No anchor details available.'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
