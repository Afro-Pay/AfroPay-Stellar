interface Transaction {
  id: string; destination: string; amount: string;
  assetCode: string; status: string; createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: 'text-green-400',
  PENDING: 'text-yellow-400',
  FAILED: 'text-red-400',
  RETRYING: 'text-orange-400',
};

function SkeletonRow() {
  return (
    <li className="bg-gray-900 rounded-xl p-4 flex justify-between items-center animate-pulse">
      <div className="flex-1 space-y-2">
        <p className="text-sm font-medium h-4 bg-gray-700 rounded">&nbsp;</p>
        <p className="text-xs text-gray-400 h-3 bg-gray-700 rounded w-24">&nbsp;</p>
      </div>
      <span className="text-xs font-semibold h-4 bg-gray-700 rounded w-16">&nbsp;</span>
    </li>
  );
}

export default function TransactionList({ transactions, isLoading }: { transactions: Transaction[]; isLoading?: boolean }) {
  if (isLoading) {
    return (
      <ul className="space-y-2">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </ul>
    );
  }

  if (!transactions.length) return <p className="text-gray-500 text-sm">No transactions yet.</p>;

  return (
    <ul className="space-y-2">
      {transactions.map((tx) => (
        <li key={tx.id} className="bg-gray-900 rounded-xl p-4 flex justify-between items-center">
          <div>
            <p className="text-sm font-medium">{tx.amount} {tx.assetCode}</p>
            <p className="text-xs text-gray-400 truncate max-w-[200px]">To: {tx.destination}</p>
            <p className="text-xs text-gray-500">{new Date(tx.createdAt).toLocaleString()}</p>
          </div>
          <span className={`text-xs font-semibold ${STATUS_COLORS[tx.status] ?? 'text-gray-400'}`}>
            {tx.status}
          </span>
        </li>
      ))}
    </ul>
  );
}
