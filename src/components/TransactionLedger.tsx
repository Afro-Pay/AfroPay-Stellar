import React, { useState } from 'react';
import { 
  History, 
  Search, 
  Filter, 
  ExternalLink, 
  Send, 
  ArrowDownLeft, 
  ShieldCheck, 
  Building2, 
  Smartphone, 
  Globe2,
  FileText,
  X,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { TransactionRecord, TransactionStatus, TransactionType } from '../types';

interface TransactionLedgerProps {
  transactions: TransactionRecord[];
}

export const TransactionLedger: React.FC<TransactionLedgerProps> = ({ transactions }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedTx, setSelectedTx] = useState<TransactionRecord | null>(null);

  const filtered = transactions.filter((tx) => {
    const matchesSearch = 
      tx.recipient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.stellarTxHash && tx.stellarTxHash.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (tx.anchorName && tx.anchorName.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesStatus = statusFilter === 'all' || tx.status === statusFilter;
    const matchesType = typeFilter === 'all' || tx.type === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  return (
    <div className="space-y-6">
      
      {/* Search & Filters Header */}
      <div className="glass-panel rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold font-display text-white flex items-center gap-2">
              <History className="w-5 h-5 text-emerald-400" />
              <span>Stellar Remittance Ledger & Audit Log</span>
            </h2>
            <p className="text-xs text-slate-400">Immutable transaction history on Stellar Testnet</p>
          </div>

          <span className="text-xs font-mono bg-slate-900 text-slate-300 px-3 py-1 rounded-lg border border-slate-800">
            Total Records: {transactions.length}
          </span>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by recipient, ID, or hash..."
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="settled">Settled</option>
            <option value="pending">Pending</option>
            <option value="flagged">Flagged</option>
          </select>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none cursor-pointer"
          >
            <option value="all">All Transaction Types</option>
            <option value="transfer">Cross-Border Remittance</option>
            <option value="deposit">Anchor Deposit</option>
            <option value="withdrawal">Bank Off-Ramp</option>
          </select>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-4">Type</th>
                <th className="p-4">Recipient / Party</th>
                <th className="p-4">Send Amount</th>
                <th className="p-4">Receive Amount</th>
                <th className="p-4">Risk & Compliance</th>
                <th className="p-4">Status</th>
                <th className="p-4">Date</th>
                <th className="p-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filtered.length > 0 ? (
                filtered.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          tx.type === 'transfer' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-sky-950 text-sky-400 border border-sky-800'
                        }`}>
                          {tx.type === 'transfer' ? <Send className="w-3.5 h-3.5" /> : <ArrowDownLeft className="w-3.5 h-3.5" />}
                        </div>
                        <span className="font-semibold text-slate-200 capitalize">{tx.type}</span>
                      </div>
                    </td>

                    <td className="p-4">
                      <div className="flex items-center gap-1.5 font-medium text-slate-100">
                        <span>{tx.recipient.name}</span>
                        <span>{tx.recipient.countryFlag}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 block">{tx.recipient.bankName || 'Stellar Account'}</span>
                    </td>

                    <td className="p-4 font-mono font-bold text-slate-200">
                      {tx.sourceAmount} {tx.sourceCurrency}
                    </td>

                    <td className="p-4 font-mono font-bold text-emerald-400">
                      {tx.destAmount.toLocaleString()} {tx.destCurrency}
                    </td>

                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border ${
                        tx.riskLevel === 'LOW' ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : 'bg-amber-950 text-amber-400 border-amber-800'
                      }`}>
                        <ShieldCheck className="w-3 h-3" />
                        Risk: {tx.riskScore}/100
                      </span>
                    </td>

                    <td className="p-4">
                      <span className="text-[10px] font-bold uppercase text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                        {tx.status}
                      </span>
                    </td>

                    <td className="p-4 text-slate-400 font-mono text-[11px]">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>

                    <td className="p-4 text-right">
                      <button
                        onClick={() => setSelectedTx(tx)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg border border-slate-700 transition-colors"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No transactions found matching your filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details Drawer / Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel rounded-2xl max-w-lg w-full p-6 space-y-6 relative border border-slate-700">
            <button
              onClick={() => setSelectedTx(null)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-slate-900 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-950 text-emerald-400 flex items-center justify-center border border-emerald-800">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">Stellar Remittance Audit Record</h3>
                <span className="text-xs font-mono text-slate-400">{selectedTx.id}</span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Recipient Name:</span>
                  <span className="font-bold text-slate-100">{selectedTx.recipient.name} ({selectedTx.recipient.countryFlag} {selectedTx.recipient.country})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Payout Rail:</span>
                  <span className="text-slate-200">{selectedTx.recipient.bankName || 'Stellar Wallet'}</span>
                </div>
                {selectedTx.recipient.accountNumber && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Account Number:</span>
                    <span className="font-mono text-slate-200">{selectedTx.recipient.accountNumber}</span>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Sent Amount:</span>
                  <span className="text-slate-200">{selectedTx.sourceAmount} {selectedTx.sourceCurrency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Converted Payout:</span>
                  <span className="text-emerald-400 font-bold">{selectedTx.destAmount.toLocaleString()} {selectedTx.destCurrency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">FX Rate Used:</span>
                  <span className="text-slate-300">1 {selectedTx.sourceCurrency} = {selectedTx.fxRate} {selectedTx.destCurrency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Stellar Fee:</span>
                  <span className="text-amber-400">${selectedTx.feeUSD.toFixed(3)} USD</span>
                </div>
              </div>

              {selectedTx.stellarTxHash && (
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-400 block">Stellar Blockchain Transaction Hash:</span>
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${selectedTx.stellarTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-emerald-400 hover:underline text-[11px] break-all flex items-center gap-1"
                  >
                    <span>{selectedTx.stellarTxHash}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedTx(null)}
              className="w-full py-2.5 bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl"
            >
              Close Record
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
