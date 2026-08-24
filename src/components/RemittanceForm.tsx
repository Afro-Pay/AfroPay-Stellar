import React, { useState, useEffect } from 'react';
import { Currency, TransactionRecord, FXQuote } from '../types';
import { FX_RATES } from '../data/mockData';
import { Send, ArrowRight, RefreshCw, ShieldAlert, CheckCircle2, Play, Zap, Info, Lock } from 'lucide-react';

interface RemittanceFormProps {
  onSendTransfer: (transferData: Partial<TransactionRecord>) => void;
  userUsdBalance: number;
  userNgnBalance: number;
  userXlmBalance: number;
}

export const RemittanceForm: React.FC<RemittanceFormProps> = ({
  onSendTransfer,
  userUsdBalance,
  userNgnBalance,
  userXlmBalance,
}) => {
  const [sourceCurrency, setSourceCurrency] = useState<Currency>('USDC');
  const [destCurrency, setDestCurrency] = useState<Currency>('NGN');
  const [amount, setAmount] = useState<string>('250');
  const [recipientName, setRecipientName] = useState<string>('Emeka Nwosu (Lagos, GTBank)');
  const [recipientKey, setRecipientKey] = useState<string>('GDFP5T43O4B3C2D1E0F1G2H3I4J5K6L7M8N9O0P1Q2R3S4T5U6V7W8X9');
  const [memo, setMemo] = useState<string>('Monthly Remittance - AfroPay');
  const [callbackUrl, setCallbackUrl] = useState<string>('https://merchant-app.com/api/webhooks/transfer');

  const [simulationResult, setSimulationResult] = useState<{
    valid: boolean;
    trustlineOk: boolean;
    balanceOk: boolean;
    riskScore: number;
    message: string;
  } | null>(null);

  const [isSimulating, setIsSimulating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quote calculation
  const numAmount = parseFloat(amount) || 0;
  const pairKey = `${sourceCurrency}_${destCurrency}`;
  const rate = FX_RATES[pairKey] || 1;
  const receiveAmount = numAmount * rate;

  const [quoteTimer, setQuoteTimer] = useState(28);

  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteTimer((prev) => (prev > 1 ? prev - 1 : 30));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSimulate = () => {
    setIsSimulating(true);
    setSimulationResult(null);

    setTimeout(() => {
      let balanceCheck = true;
      if (sourceCurrency === 'USDC' && numAmount > userUsdBalance) balanceCheck = false;
      if (sourceCurrency === 'NGN' && numAmount > userNgnBalance) balanceCheck = false;
      if (sourceCurrency === 'XLM' && numAmount > userXlmBalance) balanceCheck = false;

      const riskScore = Math.floor(Math.random() * 15) + 5; // Low risk mock score

      if (!balanceCheck) {
        setSimulationResult({
          valid: false,
          trustlineOk: true,
          balanceOk: false,
          riskScore,
          message: `Insufficient ${sourceCurrency} balance for this transaction.`,
        });
      } else {
        setSimulationResult({
          valid: true,
          trustlineOk: true,
          balanceOk: true,
          riskScore,
          message: `Simulation Successful! Trustline verified. Path: ${sourceCurrency} → XLM → ${destCurrency}. Guaranteed FX rate locked.`,
        });
      }
      setIsSimulating(false);
    }, 600);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (numAmount <= 0) return;

    setIsSubmitting(true);

    const newTx: Partial<TransactionRecord> = {
      type: 'TRANSFER',
      recipientName,
      recipientPublicKey: recipientKey,
      sendAmount: numAmount,
      sendCurrency: sourceCurrency,
      receiveAmount,
      receiveCurrency: destCurrency,
      exchangeRate: rate,
      feeUsd: 0.15,
      stellarFeeXlm: 0.00001,
      memo,
      status: 'PENDING',
      riskScore: simulationResult?.riskScore || 12,
      flagged: false,
      pathUsed: [sourceCurrency, 'XLM', destCurrency],
      callbackUrl: callbackUrl || undefined,
      callbackStatus: callbackUrl ? 'PENDING' : undefined,
    };

    setTimeout(() => {
      onSendTransfer(newTx);
      setIsSubmitting(false);
    }, 800);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* Main Transfer Form */}
      <div className="lg:col-span-2 glass-panel p-6 sm:p-8 rounded-2xl border border-slate-800 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-xl font-bold font-display text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-emerald-400" /> Cross-Border Remittance
            </h2>
            <p className="text-xs text-slate-400">Instant multi-currency transfer via Stellar Path Payments</p>
          </div>

          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
            <span className="text-slate-400">Locked Rate Timer:</span>
            <span className="text-emerald-400 font-mono font-bold">{quoteTimer}s</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          
          {/* Send & Receive Currency Amounts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Source Currency */}
            <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-2">
              <label className="text-xs font-semibold text-slate-400 flex justify-between">
                <span>You Send</span>
                <span className="text-emerald-400 font-mono">
                  Bal: {sourceCurrency === 'USDC' ? `$${userUsdBalance}` : sourceCurrency === 'NGN' ? `₦${userNgnBalance.toLocaleString()}` : `${userXlmBalance} XLM`}
                </span>
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setSimulationResult(null);
                  }}
                  className="w-full bg-transparent text-2xl font-bold font-display text-white focus:outline-none"
                  placeholder="0.00"
                  required
                />

                <select
                  value={sourceCurrency}
                  onChange={(e) => {
                    setSourceCurrency(e.target.value as Currency);
                    setSimulationResult(null);
                  }}
                  className="bg-slate-800 border border-slate-700 text-white text-xs font-bold px-3 py-2 rounded-lg focus:outline-none cursor-pointer"
                >
                  <option value="USDC">USDC (USD)</option>
                  <option value="NGN">NGN (Naira)</option>
                  <option value="XLM">XLM (Stellar)</option>
                  <option value="EUR">EUR (Euro)</option>
                </select>
              </div>
            </div>

            {/* Destination Currency */}
            <div className="bg-slate-900/90 p-4 rounded-xl border border-slate-800 space-y-2">
              <label className="text-xs font-semibold text-slate-400 flex justify-between">
                <span>Recipient Gets (Estimated)</span>
                <span className="text-cyan-400 font-mono">Rate: 1 {sourceCurrency} = {rate} {destCurrency}</span>
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={receiveAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  className="w-full bg-transparent text-2xl font-bold font-display text-emerald-400 focus:outline-none"
                />

                <select
                  value={destCurrency}
                  onChange={(e) => {
                    setDestCurrency(e.target.value as Currency);
                    setSimulationResult(null);
                  }}
                  className="bg-slate-800 border border-slate-700 text-white text-xs font-bold px-3 py-2 rounded-lg focus:outline-none cursor-pointer"
                >
                  <option value="NGN">NGN (Naira)</option>
                  <option value="USDC">USDC (USD)</option>
                  <option value="XLM">XLM (Stellar)</option>
                  <option value="EUR">EUR (Euro)</option>
                </select>
              </div>
            </div>

          </div>

          {/* Recipient Information */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Recipient Name / Description
              </label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white text-xs rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
                placeholder="e.g., Emeka Nwosu (GTBank Nigeria)"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Stellar Destination Public Key (or Anchor NIP Bridge Key)
              </label>
              <input
                type="text"
                value={recipientKey}
                onChange={(e) => setRecipientKey(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-emerald-400 font-mono text-xs rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
                placeholder="G..."
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Transaction Memo (Optional)
                </label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-white text-xs rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
                  placeholder="e.g., AfroPay Remittance #901"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Webhook Callback URL (Optional)
                </label>
                <input
                  type="url"
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-300 font-mono text-xs rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
                  placeholder="https://your-api.com/webhooks"
                />
              </div>
            </div>
          </div>

          {/* Simulation Output Banner */}
          {simulationResult && (
            <div
              className={`p-4 rounded-xl border text-xs leading-relaxed flex items-start gap-3 ${
                simulationResult.valid
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              {simulationResult.valid ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div>
                <span className="font-bold block mb-0.5">
                  {simulationResult.valid ? 'Pre-Transfer Dry-Run Simulation Passed' : 'Dry-Run Check Warning'}
                </span>
                <p>{simulationResult.message}</p>
                <div className="mt-2 flex items-center gap-3 text-[11px] font-mono">
                  <span>Trustline: Verified ✓</span>
                  <span>•</span>
                  <span>Risk Score: {simulationResult.riskScore}/100 (Safe)</span>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSimulate}
              disabled={isSimulating || numAmount <= 0}
              className="w-full sm:w-auto px-5 py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Play className={`w-3.5 h-3.5 text-cyan-400 ${isSimulating ? 'animate-spin' : ''}`} />
              <span>{isSimulating ? 'Simulating Dry-Run...' : 'Dry-Run Simulation'}</span>
            </button>

            <button
              type="submit"
              disabled={isSubmitting || numAmount <= 0}
              className="w-full sm:flex-1 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Submitting to BullMQ Queue...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Submit Remittance ({numAmount} {sourceCurrency})</span>
                </>
              )}
            </button>
          </div>

        </form>
      </div>

      {/* Side Info & Routing Details */}
      <div className="space-y-4">
        
        {/* Stellar Path Payment Visualizer */}
        <div className="glass-card p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-emerald-400" /> Path Payment Engine
            </span>
            <span className="text-[10px] bg-slate-800 text-emerald-400 px-2 py-0.5 rounded font-mono">
              Horizon Orderbook
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Stellar automatically finds the best liquidity route across DEX orderbooks in real time to swap {sourceCurrency} into {destCurrency}.
          </p>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between text-slate-300">
              <span>Source Asset:</span>
              <span className="text-emerald-400 font-bold">{sourceCurrency}</span>
            </div>

            <div className="flex items-center justify-center gap-2 text-slate-500 text-[11px] py-1 bg-slate-900 rounded border border-slate-800/80">
              <span>{sourceCurrency}</span>
              <ArrowRight className="w-3 h-3 text-emerald-400" />
              <span className="text-slate-300">XLM (Bridge)</span>
              <ArrowRight className="w-3 h-3 text-emerald-400" />
              <span>{destCurrency}</span>
            </div>

            <div className="flex items-center justify-between text-slate-300">
              <span>Destination Asset:</span>
              <span className="text-cyan-400 font-bold">{destCurrency}</span>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex justify-between text-[11px] text-slate-400">
              <span>Stellar Horizon Fee:</span>
              <span className="text-white">0.00001 XLM</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Estimated Settlement:</span>
              <span className="text-emerald-400">3-5 Seconds</span>
            </div>
          </div>
        </div>

        {/* Security & KYC Check Notice */}
        <div className="glass-card p-5 rounded-2xl border border-slate-800 text-xs space-y-3">
          <div className="flex items-center gap-2 text-amber-400 font-bold">
            <Lock className="w-4 h-4" /> Compliance & AML Screening
          </div>
          <p className="text-slate-400 leading-relaxed">
            Transactions above $1,000 USD trigger automatic Python analytics fraud scoring. The NestJS API gateway verifies sender risk scores before enqueuing settlement jobs to Rust workers.
          </p>
        </div>

      </div>

    </div>
  );
};
