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

export default function TransactionList({ transactions, isLoading }: { transactions: Transaction[]; isLoading?: boolean }) {
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

  return (
    <TransactionTable>
      {transactions.map((tx) => (
        <tr key={tx.id} className="bg-gray-900 text-sm">
          <td className="rounded-l-xl p-4 font-medium whitespace-nowrap">{tx.amount} {tx.assetCode}</td>
          <td className="p-4 text-xs text-gray-400 truncate max-w-[200px]">{tx.destination}</td>
          <td className="p-4 text-xs text-gray-500 whitespace-nowrap">{new Date(tx.createdAt).toLocaleString()}</td>
          <td className={`rounded-r-xl p-4 text-xs font-semibold ${STATUS_COLORS[tx.status] ?? 'text-gray-400'}`}>
            {tx.status}
          </td>
        </tr>
      ))}
    </TransactionTable>
  );
}
