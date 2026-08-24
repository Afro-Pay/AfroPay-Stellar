import { useState } from 'react';
import { Copy, ExternalLink, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { Transaction } from '../hooks/useWalletData';

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: 'text-green-400',
  PENDING: 'text-yellow-400',
  FAILED: 'text-red-400',
  RETRYING: 'text-orange-400',
};

function SkeletonRow() {
  return (
    <tr className="bg-gray-900 animate-pulse" aria-hidden="true">
      <td className="rounded-l-xl p-4"><span className="block h-4 bg-gray-700 rounded w-20">&nbsp;</span></td>
      <td className="p-4"><span className="block h-4 bg-gray-700 rounded w-32">&nbsp;</span></td>
      <td className="p-4"><span className="block h-4 bg-gray-700 rounded w-24">&nbsp;</span></td>
      <td className="rounded-r-xl p-4"><span className="block h-4 bg-gray-700 rounded w-16">&nbsp;</span></td>
    </tr>
  );
}

function TransactionTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-y-2 text-left" aria-label="Transaction history">
        <thead className="sr-only">
          <tr>
            <th scope="col">Amount</th>
            <th scope="col">Destination</th>
            <th scope="col">Date</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Builds a Stellar Expert URL for the given transaction hash.
 * Uses the public (mainnet) explorer by default. When NEXT_PUBLIC_STELLAR_NETWORK
 * is set to "testnet" the testnet explorer is used instead.
 */
function stellarExplorerUrl(txHash: string): string {
  const network =
    typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_STELLAR_NETWORK === 'testnet'
      ? 'testnet'
      : 'public';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

type ExpandedRowProps = {
  tx: Transaction;
  isExpanded: boolean;
  onToggle: () => void;
};

function ExpandedRow({ tx, isExpanded, onToggle }: ExpandedRowProps) {
  const [copyStatus, setCopyStatus] = useState('');
  const detailsId = `tx-details-${tx.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;

  const copyHash = async () => {
    if (!tx.stellarTxHash) return;
    await navigator.clipboard.writeText(tx.stellarTxHash);
    setCopyStatus('Transaction hash copied.');
    setTimeout(() => setCopyStatus(''), 2000);
  };

  return (
    <>
      <tr className="bg-gray-900 text-sm hover:bg-gray-800/50 transition-colors">
        <td className="rounded-l-xl p-4 font-medium whitespace-nowrap">
          <button
            type="button"
            className="inline-flex items-center gap-2 w-full text-left hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-controls={detailsId}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for transaction ${tx.amount} ${tx.assetCode} to ${tx.destination}`}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" /> : <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />}
            <span>{tx.amount} {tx.assetCode}</span>
          </button>
        </td>
        <td className="p-4 text-xs text-gray-400 truncate max-w-[200px]">{tx.destination}</td>
        <td className="p-4 text-xs text-gray-500 whitespace-nowrap">{new Date(tx.createdAt).toLocaleString()}</td>
        <td className={`rounded-r-xl p-4 text-xs font-semibold ${STATUS_COLORS[tx.status] ?? 'text-gray-400'}`}>
          {tx.status}
        </td>
      </tr>
      {isExpanded && (
        <tr id={detailsId} role="region" aria-label={`Details for transaction ${tx.id}`}>
          <td colSpan={4} className="p-0">
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl mx-2 mb-2 p-4 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Stellar Transaction Hash */}
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 mb-1">Stellar Tx Hash</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gray-300 truncate font-mono text-xs max-w-[200px] sm:max-w-[280px]" title={tx.stellarTxHash || 'N/A'}>
                      {tx.stellarTxHash || 'N/A'}
                    </span>
                    {tx.stellarTxHash && (
                      <>
                        <button
                          type="button"
                          onClick={copyHash}
                          className="text-gray-500 hover:text-indigo-400 shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                          title="Copy hash"
                          aria-label="Copy Stellar transaction hash"
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <a
                          href={stellarExplorerUrl(tx.stellarTxHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                          aria-label="View transaction on Stellar Expert"
                        >
                          <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          View on Explorer
                        </a>
                      </>
                    )}
                  </div>
                  {copyStatus && (
                    <p className="text-xs text-green-400 mt-1" role="status" aria-live="polite">
                      {copyStatus}
                    </p>
                  )}
                </div>

                {/* Fee */}
                <div>
                  <p className="text-xs text-gray-500 mb-1">Fee</p>
                  <p className="text-gray-300 font-medium">{tx.fee || 'N/A'}</p>
                </div>

                {/* Anchor Info */}
                {tx.anchorInfo && (
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Anchor Info</p>
                    <p className="text-gray-300">{tx.anchorInfo}</p>
                  </div>
                )}

                {/* Empty state when no extra data is available */}
                {!tx.stellarTxHash && !tx.fee && !tx.anchorInfo && (
                  <div className="md:col-span-2 flex items-center gap-2 text-gray-400 text-xs">
                    <Search className="w-3.5 h-3.5" aria-hidden="true" />
                    No on-chain details available for this transaction yet.
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function TransactionList({ transactions, isLoading }: { transactions: Transaction[]; isLoading?: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <TransactionTable>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </TransactionTable>
    );
  }

  if (!transactions.length) return <p className="text-gray-500 text-sm">No transactions yet.</p>;

  const toggleRow = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <TransactionTable>
      {transactions.map((tx) => (
        <ExpandedRow
          key={tx.id}
          tx={tx}
          isExpanded={expandedId === tx.id}
          onToggle={() => toggleRow(tx.id)}
        />
      ))}
    </TransactionTable>
  );
}