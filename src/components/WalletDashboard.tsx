import React, { useState } from 'react';
import { UserWallet, TransactionRecord, Currency } from '../types';
import { Wallet, ShieldCheck, ArrowUpRight, ArrowDownLeft, PlusCircle, CheckCircle2, AlertCircle, ExternalLink, RefreshCw, Lock, Zap } from 'lucide-react';

interface WalletDashboardProps {
  wallet: UserWallet;
  transactions: TransactionRecord[];
  onNavigateRemittance: () => void;
  onNavigateAnchors: () => void;
  onToggleTrustline: (currency: Currency) => void;
}

export const WalletDashboard: React.FC<WalletDashboardProps> = ({
  wallet,
  transactions,
  onNavigateRemittance,
  onNavigateAnchors,
  onToggleTrustline,
}) => {
  const [filterType, setFilterType] = useState<string>('ALL');

  const totalUsd = wallet.balances.reduce((acc, b) => acc + b.usdEquivalent, 0);
  const totalNgn = totalUsd * 1500;

  const filteredTransactions = transactions.filter((tx) => {
    if (filterType === 'ALL') return true;
    return tx.type === filterType;
  });

  return (
    <div className="space-y-6">
      
      {/* Top Net Worth Summary & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Balance Banner */}
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl relative overflow-hidden border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Wallet className="w-3.5 h-3.5" /> Stellar Wallet Net Worth
              </span>
              <div className="text-3xl sm:text-4xl font-black font-display text-white mt-1">
                ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-sm font-normal text-slate-400 ml-2">USD</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                ≈ ₦{totalNgn.toLocaleString('en-NG', { maximumFractionDigits: 0 })} NGN (Official FX Rate)
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onNavigateRemittance}
                className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
              >
                <ArrowUpRight className="w-4 h-4" />
                Send Remittance
              </button>
              <button
                onClick={onNavigateAnchors}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl flex items-center gap-2 border border-slate-700 transition-all cursor-pointer"
              >
                <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                Deposit / Withdraw
              </button>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-800/80 text-xs">
            <div>
              <span className="text-slate-400">Account Type</span>
              <p className="font-semibold text-white mt-0.5">Stellar Keypair</p>
            </div>
            <div>
              <span className="text-slate-400">Active Trustlines</span>
              <p className="font-semibold text-emerald-400 mt-0.5">
                {wallet.balances.filter((b) => b.trustlineEstablished).length} / {wallet.balances.length} Active
              </p>
            </div>
            <div>
              <span className="text-slate-400">KYC Status</span>
              <p className="font-semibold text-emerald-400 mt-0.5 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Tier 2 Verified
              </p>
            </div>
            <div>
              <span className="text-slate-400">Settlement Speed</span>
              <p className="font-semibold text-cyan-400 mt-0.5 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" /> 3.2 Seconds
              </p>
            </div>
          </div>
        </div>

        {/* Security & Key Storage Card */}
        <div className="glass-card p-6 rounded-2xl border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" /> Key Custody
              </span>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                AES-256
              </span>
            </div>
            <h3 className="text-sm font-bold text-white mb-1">Encrypted PostgreSQL Key Storage</h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Private keys are generated on user registration, encrypted using AES-256 before database insertion, and decrypted in-memory solely during transaction signing.
            </p>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 text-xs font-mono">
            <div className="flex justify-between text-slate-400 mb-1">
              <span>Horizon Network:</span>
              <span className="text-emerald-400">Testnet</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Base Fee:</span>
              <span className="text-cyan-400">0.00001 XLM (100 stroops)</span>
            </div>
          </div>
        </div>

      </div>

      {/* Assets & Trustlines Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold font-display text-white">Stellar Assets & Trustlines</h2>
            <p className="text-xs text-slate-400">Managed multi-currency assets on Stellar testnet</p>
          </div>
          <span className="text-xs text-slate-400">Click trustline to toggle on/off</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {wallet.balances.map((b) => (
            <div
              key={b.currency}
              className={`glass-card p-5 rounded-2xl border transition-all ${
                b.trustlineEstablished
                  ? 'border-slate-800 hover:border-slate-700'
                  : 'border-amber-500/30 bg-amber-500/5'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-sm text-emerald-400">
                    {b.currency === 'XLM' ? '⚡' : b.currency === 'USDC' ? '💵' : b.currency === 'NGN' ? '🇳🇬' : '🇪🇺'}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">{b.code}</h3>
                    <span className="text-[10px] text-slate-400">{b.currency === 'XLM' ? 'Native Asset' : 'Issued Credit'}</span>
                  </div>
                </div>

                <button
                  onClick={() => onToggleTrustline(b.currency)}
                  className={`px-2 py-1 text-[10px] font-bold rounded-lg flex items-center gap-1 transition ${
                    b.trustlineEstablished
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                  }`}
                  title={b.trustlineEstablished ? 'Trustline Active on Horizon' : 'Establish Trustline'}
                >
                  {b.trustlineEstablished ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      Established
                    </>
                  ) : (
                    <>
                      <PlusCircle className="w-3 h-3 text-amber-300" />
                      Add Trustline
                    </>
                  )}
                </button>
              </div>

              <div className="mt-2">
                <div className="text-xl font-bold font-display text-white">
                  {b.currency === 'NGN' ? '₦' : b.currency === 'EUR' ? '€' : '$'}
                  {b.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  ≈ ${b.usdEquivalent.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                </div>
              </div>

              {b.assetIssuer && (
                <div className="mt-3 pt-3 border-t border-slate-800/80 text-[10px] text-slate-500 font-mono truncate">
                  Issuer: {b.assetIssuer.slice(0, 8)}...{b.assetIssuer.slice(-6)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity Section */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold font-display text-white">Transaction History</h2>
            <p className="text-xs text-slate-400">All cross-border remittances, deposits & trustline events</p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            {['ALL', 'TRANSFER', 'DEPOSIT', 'TRUSTLINE'].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filterType === type ? 'bg-slate-800 text-emerald-400 font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Transactions Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/60 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Transaction ID</th>
                <th className="py-3 px-4">Type & Recipient</th>
                <th className="py-3 px-4">Send / Receive</th>
                <th className="py-3 px-4">Path & FX Rate</th>
                <th className="py-3 px-4">Risk & Webhook</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Explorer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-800/30 transition">
                  <td className="py-3.5 px-4 font-mono text-emerald-400 font-semibold">
                    {tx.id}
                    <span className="block text-[10px] text-slate-500 font-normal">
                      {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="font-semibold text-white block">{tx.recipientName}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{tx.memo || 'No memo'}</span>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="text-white font-bold block">
                      {tx.sendAmount} {tx.sendCurrency}
                    </span>
                    <span className="text-slate-400 text-[10px]">
                      → {tx.receiveAmount.toLocaleString()} {tx.receiveCurrency}
                    </span>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="text-slate-300 font-mono">
                      1 {tx.sendCurrency} = {tx.exchangeRate} {tx.receiveCurrency}
                    </span>
                    {tx.pathUsed && (
                      <div className="text-[10px] text-emerald-400/80 font-mono mt-0.5">
                        Path: {tx.pathUsed.join(' → ')}
                      </div>
                    )}
                  </td>

                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        tx.riskScore < 20 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                      }`}>
                        Risk: {tx.riskScore}
                      </span>
                      {tx.callbackStatus && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                          Webhook: {tx.callbackStatus}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      tx.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                      tx.status === 'PENDING' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' :
                      'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      {tx.status}
                    </span>
                  </td>

                  <td className="py-3.5 px-4 text-right">
                    {tx.txHash ? (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-mono text-[11px] hover:underline"
                      >
                        <span>{tx.txHash.slice(0, 6)}...</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-slate-500 font-mono text-[11px]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
