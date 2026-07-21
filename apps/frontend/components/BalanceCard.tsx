interface Props { asset: string; balance: string; }

export default function BalanceCard({ asset, balance }: Props) {
  const formattedBalance = parseFloat(balance).toFixed(2);

  return (
    <div className="bg-gray-800 rounded-xl p-4 text-center" aria-label={`${asset} balance: ${formattedBalance}`}>
      <p className="text-gray-400 text-sm">{asset}</p>
      <p className="text-xl font-bold mt-1">{formattedBalance}</p>
    </div>
  );
}
