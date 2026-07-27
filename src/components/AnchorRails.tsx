import React, { useState } from 'react';
import { ANCHOR_PROVIDERS } from '../data/mockData';
import { Anchor, ArrowDownLeft, ArrowUpRight, Building2, Globe, ShieldCheck, CheckCircle2, RefreshCw } from 'lucide-react';

interface AnchorRailsProps {
  onSimulateDeposit: (amount: number, asset: 'NGN' | 'USDC') => void;
  onSimulateWithdrawal: (amount: number, asset: 'NGN' | 'USDC') => void;
}

export const AnchorRails: React.FC<AnchorRailsProps> = ({
  onSimulateDeposit,
  onSimulateWithdrawal,
}) => {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [selectedAnchor, setSelectedAnchor] = useState(ANCHOR_PROVIDERS[0].id);
  const [selectedBank, setSelectedBank] = useState('Guaranty Trust Bank');
  const [amount, setAmount] = useState('150000');
  const [accountNumber, setAccountNumber] = useState('0123456789');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const anchor = ANCHOR_PROVIDERS.find((a) => a.id === selectedAnchor) || ANCHOR_PROVIDERS[0];

  const handleAction = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount) || 0;
    if (numAmount <= 0) return;

    setIsProcessing(true);
    setStatusMessage(null);

    setTimeout(() => {
      if (activeTab === 'deposit') {
        const receivedAsset = anchor.assetCode === 'NGN' ? 'NGN' : 'USDC';
        onSimulateDeposit(numAmount, receivedAsset as 'NGN' | 'USDC');
        setStatusMessage(
          `SEP-24 Deposit Succeeded! Mentored ${numAmount} ${anchor.assetCode} on Stellar Testnet from ${selectedBank}.`
        );
      } else {
        const burnedAsset = anchor.assetCode === 'NGN' ? 'NGN' : 'USDC';
        onSimulateWithdrawal(numAmount, burnedAsset as 'NGN' | 'USDC');
        setStatusMessage(
          `SEP-24 Withdrawal Dispatched! ${numAmount} ${anchor.assetCode} burned on Stellar. ₦${(
            numAmount * (anchor.assetCode === 'USDC' ? 1500 : 1)
          ).toLocaleString()} transferred to ${selectedBank} Acc #${accountNumber}.`
        );
      }
      setIsProcessing(false);
    }, 1000);
  };

  return (
    <div className="space-y-6">
      
      {/* Overview Banner */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
            <Anchor className="w-4 h-4" /> SEP-24 / SEP-6 Anchor Infrastructure
          </div>
          <h2 className="text-xl font-bold font-display text-white">Fiat On-Ramp & Off-Ramp Rails</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Deposit and withdraw local fiat currency (NGN, USD, EUR) directly between Stellar blockchain wallets and local bank accounts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold rounded-xl flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> SEP-24 Compliant
          </span>
          <span className="px-3 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-xs font-bold rounded-xl flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5" /> SEP-38 FX Quotes
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Deposit / Withdraw Interactive Terminal */}
        <div className="lg:col-span-2 glass-panel p-6 sm:p-8 rounded-2xl border border-slate-800 space-y-6">
          
          {/* Mode Switcher */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-4">
            <button
              onClick={() => {
                setActiveTab('deposit');
                setStatusMessage(null);
              }}
              className={`flex-1 py-3 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition ${
                activeTab === 'deposit'
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <ArrowDownLeft className="w-4 h-4" />
              Deposit Fiat → Mint Stellar Asset
            </button>

            <button
              onClick={() => {
                setActiveTab('withdraw');
                setStatusMessage(null);
              }}
              className={`flex-1 py-3 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition ${
                activeTab === 'withdraw'
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" />
              Withdraw Asset → Bank Account
            </button>
          </div>

          <form onSubmit={handleAction} className="space-y-4">
            
            {/* Choose Anchor */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Select Licensed Anchor Provider
              </label>
              <select
                value={selectedAnchor}
                onChange={(e) => setSelectedAnchor(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white text-xs font-bold rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
              >
                {ANCHOR_PROVIDERS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.domain}) — {a.assetCode}
                  </option>
                ))}
              </select>
            </div>

            {/* Select Bank */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Target Nigerian / Partner Bank
                </label>
                <select
                  value={selectedBank}
                  onChange={(e) => setSelectedBank(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-white text-xs rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
                >
                  {anchor.supportedBanks.map((bank) => (
                    <option key={bank} value={bank}>
                      {bank}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Bank Account Number / IBAN
                </label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-emerald-400 font-mono text-xs rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Amount ({anchor.assetCode})
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white text-lg font-bold font-display rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
                required
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Anchor Fee: {anchor.feePercentage}% • Min: ${anchor.minAmountUsd} • Max: ${anchor.maxAmountUsd.toLocaleString()}
              </span>
            </div>

            {statusMessage && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs leading-relaxed flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{statusMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isProcessing}
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing SEP-24 Interactive Handshake...</span>
                </>
              ) : (
                <>
                  <Building2 className="w-4 h-4" />
                  <span>
                    Execute SEP-24 {activeTab === 'deposit' ? 'Deposit' : 'Withdrawal'} ({amount} {anchor.assetCode})
                  </span>
                </>
              )}
            </button>

          </form>
        </div>

        {/* Anchor Networks Directory */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Building2 className="w-4 h-4 text-emerald-400" /> Active SEP Anchor Nodes
          </h3>

          <div className="space-y-3">
            {ANCHOR_PROVIDERS.map((a) => (
              <div key={a.id} className="glass-card p-4 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-white">{a.name}</span>
                  <span className="text-[10px] bg-slate-800 text-emerald-400 font-bold px-2 py-0.5 rounded">
                    {a.assetCode}
                  </span>
                </div>

                <div className="text-[11px] text-slate-400 font-mono">
                  Domain: <span className="text-cyan-400">{a.domain}</span>
                </div>

                <div className="flex flex-wrap gap-1 pt-1">
                  {a.sepVersions.map((sep) => (
                    <span key={sep} className="px-1.5 py-0.5 bg-slate-900 border border-slate-800 rounded text-[9px] font-mono text-slate-300">
                      {sep}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400 leading-relaxed space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-white">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> SEP Compliance Checklist
            </div>
            <p>
              AfroPay anchors use SEP-10 JWT authentication, SEP-24 interactive deposit/withdrawal webviews, and SEP-38 RFQ market-maker pathing.
            </p>
          </div>
        </div>

      </div>

    </div>
  );
};
