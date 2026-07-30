import React, { useState } from 'react';
import { 
  Wallet, 
  Send, 
  ArrowDownLeft, 
  ShieldAlert, 
  CheckCircle2, 
  ExternalLink, 
  KeyRound, 
  Zap, 
  RefreshCw,
  PlusCircle,
  Layers,
  Sparkles,
  ArrowUpRight
} from 'lucide-react';
import { WalletState, TransactionRecord, CurrencyCode } from '../types';
import { StorageService } from '../lib/storage';

interface WalletSummaryProps {
  wallet: WalletState;
  onRefreshWallet: () => void;
  onNavigateToSend: () => void;
  onNavigateToAnchor: () => void;
  onNavigateToHistory: () => void;
  transactions: TransactionRecord[];
}

export const WalletSummary: React.FC<WalletSummaryProps> = ({
  wallet,
  onRefreshWallet,
  onNavigateToSend,
  onNavigateToAnchor,
  onNavigateToHistory,
  transactions,
}) => {
  const [togglingCode, setTogglingCode] = useState<string | null>(null);

  // Total balance in USD
  const totalUsd = Object.values(wallet.balances).reduce((acc, curr) => acc + curr.usdValue, 0);
  const totalNgn = totalUsd * 1520.50;

  const handleToggleTrustline = (code: 'USDC' | 'NGN' | 'EUR') => {
    setTogglingCode(code);
    setTimeout(() => {
      StorageService.toggleTrustline(code);
      onRefreshWallet();
      setTogglingCode(null);
    }, 600);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Quick Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Balance Panel */}
        <div className="lg:col-span-2 glass-panel-glow rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 -mt-8 -mr-8 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold tracking-wider uppercase text-emerald-400 flex items-center gap-1.5">
                <Zap className="w-4 h-4" />
                Stellar Account Balance
              </span>
              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-slate-900 text-slate-300 border border-slate-700">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                Keypair Active
              </span>
            </div>

            <div className="mt-4">
              <p className="text-sm text-slate-400">Total Portfolio Net Worth</p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-4xl sm:text-5xl font-extrabold font-display text-white tracking-tight">
                  ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-sm font-medium text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-md border border-emerald-800/40">
                  ≈ ₦{totalNgn.toLocaleString('en-NG', { maximumFractionDigits: 0 })} NGN
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-8">
            <button
              onClick={onNavigateToSend}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition-all shadow-lg shadow-emerald-950/40"
            >
              <Send className="w-4 h-4" />
              <span>Send Money</span>
            </button>

            <button
              onClick={onNavigateToAnchor}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold border border-slate-700 transition-all"
            >
              <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
              <span>Deposit / Off-Ramp</span>
            </button>

            <button
              onClick={onRefreshWallet}
              className="col-span-2 sm:col-span-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-medium border border-slate-800 transition-all"
            >
              <RefreshCw className="w-4 h-4 text-slate-400" />
              <span>Sync Horizon</span>
            </button>
          </div>
        </div>

        {/* Security & Keypair Box */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <KeyRound className="w-5 h-5 text-amber-400" />
              <h3 className="font-semibold text-slate-200">Stellar Vault Security</h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Encrypted Keypair Storage:</span>
                <span className="font-mono text-emerald-400 break-all bg-slate-950 px-2 py-1 rounded block border border-slate-800">
                  AES-256-GCM Encrypted
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Horizon Sequence #:</span>
                <span className="font-mono text-slate-200">{wallet.sequenceNumber}</span>
              </div>

              <div className="flex items-center justify-between text-slate-400 px-1 pt-1">
                <span>Account Status:</span>
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Funded & Operational
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">Network: Stellar Testnet</span>
            <a 
              href={`https://stellar.expert/explorer/testnet/account/${wallet.publicKey}`} 
              target="_blank" 
              rel="noreferrer"
              className="text-emerald-400 hover:underline flex items-center gap-1 font-medium"
            >
              <span>View Explorer</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

      </div>

      {/* Multi-Asset Holdings & Stellar Trustlines */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold font-display text-white">Stellar Assets & Trustlines</h2>
            <p className="text-xs text-slate-400">Multi-currency balances issued via trusted Stellar anchors</p>
          </div>
          <span className="text-xs font-mono bg-slate-900 text-slate-400 px-3 py-1 rounded-lg border border-slate-800">
            Path Payments Supported
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(wallet.balances).map(([code, asset]) => {
            const isCodeEditable = code !== 'XLM';
            return (
              <div 
                key={code}
                className="glass-panel hover:border-slate-700 transition-all rounded-xl p-5 flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{asset.flag}</span>
                      <div>
                        <h4 className="font-bold text-slate-100">{code}</h4>
                        <span className="text-[11px] text-slate-400 block">{asset.name}</span>
                      </div>
                    </div>
                    {asset.trustlineActive ? (
                      <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Trustline Active
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-amber-400 bg-amber-950/80 border border-amber-800/60 px-2 py-0.5 rounded-full">
                        No Trustline
                      </span>
                    )}
                  </div>

                  <div className="space-y-0.5 mt-2">
                    <div className="text-2xl font-bold font-display text-white">
                      {asset.symbol} {asset.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <p className="text-xs text-slate-400">
                      ≈ ${asset.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  {isCodeEditable ? (
                    <button
                      onClick={() => handleToggleTrustline(code as any)}
                      disabled={togglingCode === code}
                      className="w-full text-center py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 font-medium border border-slate-800 hover:border-slate-700 transition-all flex items-center justify-center gap-1.5"
                    >
                      {togglingCode === code ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                      ) : (
                        <Layers className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span>{asset.trustlineActive ? 'Manage Trustline' : 'Establish Trustline'}</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500 italic">Native Stellar Lumens</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Ledger Activity Preview */}
      <div className="glass-panel rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold font-display text-white">Recent Remittance Ledger</h3>
            <p className="text-xs text-slate-400">Latest cross-border transactions processed on Stellar</p>
          </div>
          <button
            onClick={onNavigateToHistory}
            className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
          >
            <span>Full Ledger</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>

        <div className="divide-y divide-slate-800/80">
          {transactions.slice(0, 3).map((tx) => (
            <div key={tx.id} className="py-3.5 flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  tx.type === 'transfer' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50' : 'bg-sky-950/80 text-sky-400 border border-sky-800/50'
                }`}>
                  {tx.type === 'transfer' ? <Send className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-100">{tx.recipient.name}</span>
                    <span className="text-xs">{tx.recipient.countryFlag}</span>
                  </div>
                  <span className="text-xs text-slate-400 block">
                    {new Date(tx.createdAt).toLocaleDateString()} • {tx.anchorName || 'Stellar Network'}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <div className="font-semibold text-slate-100">
                  {tx.sourceAmount} {tx.sourceCurrency} ➔ {tx.destAmount.toLocaleString()} {tx.destCurrency}
                </div>
                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800/40">
                    {tx.status}
                  </span>
                  {tx.stellarTxHash && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${tx.stellarTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-400 hover:text-emerald-400 transition-colors"
                      title="View on Stellar Explorer"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
