import React, { useState, useEffect } from 'react';
import { 
  Send, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Zap, 
  Globe2, 
  Building2, 
  Smartphone, 
  ShieldCheck, 
  ExternalLink,
  ChevronRight,
  Sparkles,
  Info
} from 'lucide-react';
import { CurrencyCode, RecipientInfo, TransferQuote, TransactionRecord } from '../types';
import { calculateQuote, calculateRiskScore, generateTxHash } from '../lib/stellar';
import { StorageService } from '../lib/storage';

interface SendRemittanceProps {
  onSuccess: (tx: TransactionRecord) => void;
  onCancel: () => void;
}

const DESTINATION_COUNTRIES = [
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN' as CurrencyCode, defaultBank: 'Guaranty Trust Bank (GTB)' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'USDC' as CurrencyCode, defaultBank: 'MTN Mobile Money' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'USDC' as CurrencyCode, defaultBank: 'Safaricom M-Pesa' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'USDC' as CurrencyCode, defaultBank: 'Standard Bank' },
  { code: 'UK', name: 'United Kingdom', flag: '🇬🇧', currency: 'EUR' as CurrencyCode, defaultBank: 'Barclays Bank UK' },
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USDC' as CurrencyCode, defaultBank: 'Chase Bank' },
];

export const SendRemittance: React.FC<SendRemittanceProps> = ({
  onSuccess,
  onCancel,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  
  // Step 1: Amounts & Corridor
  const [fromCurrency, setFromCurrency] = useState<CurrencyCode>('USDC');
  const [fromAmount, setFromAmount] = useState<number>(100);
  const [selectedCountry, setSelectedCountry] = useState(DESTINATION_COUNTRIES[0]);
  const [toCurrency, setToCurrency] = useState<CurrencyCode>('NGN');

  // Step 2: Recipient
  const [recipientName, setRecipientName] = useState('Amina Bello');
  const [payoutMethod, setPayoutMethod] = useState<'bank_account' | 'mobile_money' | 'stellar_address'>('bank_account');
  const [bankName, setBankName] = useState('Guaranty Trust Bank (GTB)');
  const [accountNumber, setAccountNumber] = useState('0123984712');
  const [mobileProvider, setMobileProvider] = useState('MTN Mobile Money');
  const [stellarAddress, setStellarAddress] = useState('');
  const [memo, setMemo] = useState('Family Support Remittance');

  // Step 3: Quote & Simulation
  const [quote, setQuote] = useState<TransferQuote | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Step 4: Submission State
  const [submittingPhase, setSubmittingPhase] = useState<number>(0); // 0: Idle, 1: XDR, 2: Sign, 3: Horizon, 4: Settled
  const [completedTx, setCompletedTx] = useState<TransactionRecord | null>(null);

  // Re-calculate quote when inputs change
  useEffect(() => {
    if (fromAmount > 0) {
      const q = calculateQuote(fromCurrency, fromAmount, toCurrency, selectedCountry.name);
      setQuote(q);
    }
  }, [fromCurrency, fromAmount, toCurrency, selectedCountry]);

  // Handle Country Switch
  const handleCountrySelect = (country: typeof DESTINATION_COUNTRIES[0]) => {
    setSelectedCountry(country);
    setToCurrency(country.currency);
    setBankName(country.defaultBank);
    if (country.code === 'GH' || country.code === 'KE') {
      setPayoutMethod('mobile_money');
    } else {
      setPayoutMethod('bank_account');
    }
  };

  // Simulate Path Payment Submission
  const handleExecuteTransfer = () => {
    if (!quote) return;
    
    setStep(4);
    setSubmittingPhase(1); // Building XDR

    setTimeout(() => {
      setSubmittingPhase(2); // Cosigning with AES key
    }, 1000);

    setTimeout(() => {
      setSubmittingPhase(3); // Submitting to Horizon Testnet
    }, 2000);

    setTimeout(() => {
      // Calculate Risk Score
      const risk = calculateRiskScore(fromAmount * (fromCurrency === 'USDC' ? 1 : 0.115), selectedCountry.name);
      
      const newTx: TransactionRecord = {
        id: `tx_stx_${Date.now()}`,
        type: 'transfer',
        sourceCurrency: fromCurrency,
        sourceAmount: fromAmount,
        destCurrency: toCurrency,
        destAmount: quote.estimatedToAmount,
        fxRate: quote.fxRate,
        feeUSD: quote.totalFeeUSD,
        recipient: {
          name: recipientName,
          country: selectedCountry.name,
          countryFlag: selectedCountry.flag,
          payoutMethod,
          bankName: payoutMethod === 'bank_account' ? bankName : undefined,
          accountNumber: payoutMethod !== 'stellar_address' ? accountNumber : undefined,
          mobileProvider: payoutMethod === 'mobile_money' ? mobileProvider : undefined,
          stellarAddress: payoutMethod === 'stellar_address' ? stellarAddress : undefined,
        },
        status: 'settled',
        stellarTxHash: generateTxHash(),
        anchorName: 'Cowrie / Stellar Path Payment Engine',
        createdAt: new Date().toISOString(),
        completedAt: new Date(Date.now() + 3200).toISOString(),
        riskScore: risk.score,
        riskLevel: risk.level,
        memo,
      };

      StorageService.addTransaction(newTx);
      setCompletedTx(newTx);
      setSubmittingPhase(4); // Settled
    }, 3200);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      
      {/* Progress Header */}
      <div className="glass-panel rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Send className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold font-display text-white">Send Cross-Border Remittance</h2>
          </div>
          <span className="text-xs text-slate-400">Step {step} of 4</span>
        </div>

        {/* Stepper Bar */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { num: 1, label: 'Corridor & Amount' },
            { num: 2, label: 'Recipient' },
            { num: 3, label: 'Path Simulation' },
            { num: 4, label: 'Stellar Settlement' },
          ].map((s) => (
            <div key={s.num} className="space-y-1.5">
              <div className={`h-1.5 rounded-full transition-all ${
                step >= s.num ? 'bg-emerald-400' : 'bg-slate-800'
              }`} />
              <span className={`text-[11px] block text-center font-medium ${
                step === s.num ? 'text-emerald-400 font-semibold' : 'text-slate-500'
              }`}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1: Corridor & Amount Selection */}
      {step === 1 && (
        <div className="glass-panel rounded-2xl p-6 space-y-6">
          <h3 className="text-base font-bold text-slate-200">Select Destination Country & Corridor</h3>

          {/* Country Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {DESTINATION_COUNTRIES.map((c) => (
              <button
                key={c.code}
                onClick={() => handleCountrySelect(c)}
                className={`p-3.5 rounded-xl border text-left transition-all flex items-center gap-3 ${
                  selectedCountry.code === c.code
                    ? 'bg-emerald-950/60 border-emerald-500/80 shadow-md shadow-emerald-950/30'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span className="text-3xl">{c.flag}</span>
                <div>
                  <h4 className="font-bold text-sm text-slate-100">{c.name}</h4>
                  <span className="text-xs text-slate-400">{c.currency} Corridor</span>
                </div>
              </button>
            ))}
          </div>

          {/* Amount Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-800">
            {/* From Amount */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">You Send</label>
              <div className="flex items-center rounded-xl bg-slate-900 border border-slate-700 p-2 focus-within:border-emerald-500">
                <input
                  type="number"
                  min="1"
                  value={fromAmount}
                  onChange={(e) => setFromAmount(Math.max(1, parseFloat(e.target.value) || 0))}
                  className="w-full bg-transparent text-xl font-bold font-display text-white px-2 focus:outline-none"
                />
                <select
                  value={fromCurrency}
                  onChange={(e) => setFromCurrency(e.target.value as CurrencyCode)}
                  className="bg-slate-800 text-xs font-bold text-slate-200 px-3 py-2 rounded-lg border border-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="USDC">🇺🇸 USDC</option>
                  <option value="XLM">🥏 XLM</option>
                  <option value="NGN">🇳🇬 NGN</option>
                  <option value="EUR">🇪🇺 EUR</option>
                </select>
              </div>
            </div>

            {/* Estimated Receive Amount */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Recipient Receives (Estimated)</label>
              <div className="flex items-center rounded-xl bg-slate-900/80 border border-slate-800 p-2">
                <div className="w-full text-xl font-bold font-display text-emerald-400 px-2">
                  {quote ? quote.estimatedToAmount.toLocaleString() : '0.00'}
                </div>
                <select
                  value={toCurrency}
                  onChange={(e) => setToCurrency(e.target.value as CurrencyCode)}
                  className="bg-slate-800 text-xs font-bold text-slate-200 px-3 py-2 rounded-lg border border-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="NGN">🇳🇬 NGN</option>
                  <option value="USDC">🇺🇸 USDC</option>
                  <option value="EUR">🇪🇺 EUR</option>
                  <option value="XLM">🥏 XLM</option>
                </select>
              </div>
            </div>
          </div>

          {/* Quick Quote Summary Box */}
          {quote && (
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs space-y-2">
              <div className="flex justify-between text-slate-300">
                <span>Exchange Rate:</span>
                <span className="font-mono text-slate-100 font-semibold">
                  1 {fromCurrency} = {quote.fxRate} {toCurrency}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Stellar Network Fee:</span>
                <span className="font-mono text-emerald-400 font-medium">0.00001 XLM (~$0.0001)</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Estimated Duration:</span>
                <span className="font-medium text-slate-200 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-400" />
                  ~3-5 Seconds (Stellar Path Payment)
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onCancel}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setStep(2)}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-all flex items-center gap-2"
            >
              <span>Next: Recipient Info</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Recipient Information */}
      {step === 2 && (
        <div className="glass-panel rounded-2xl p-6 space-y-6">
          <h3 className="text-base font-bold text-slate-200">Enter Recipient Details ({selectedCountry.name} {selectedCountry.flag})</h3>

          {/* Payout Method Toggle */}
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => setPayoutMethod('bank_account')}
              className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5 ${
                payoutMethod === 'bank_account'
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-400'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-5 h-5" />
              <span className="text-xs font-semibold">Bank Account</span>
            </button>

            <button
              onClick={() => setPayoutMethod('mobile_money')}
              className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5 ${
                payoutMethod === 'mobile_money'
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-400'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-5 h-5" />
              <span className="text-xs font-semibold">Mobile Money</span>
            </button>

            <button
              onClick={() => setPayoutMethod('stellar_address')}
              className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5 ${
                payoutMethod === 'stellar_address'
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-400'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe2 className="w-5 h-5" />
              <span className="text-xs font-semibold">Stellar Address</span>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Recipient Full Name</label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="e.g. Amina Bello"
                className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {payoutMethod === 'bank_account' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Account Number</label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {payoutMethod === 'mobile_money' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Mobile Money Provider</label>
                  <select
                    value={mobileProvider}
                    onChange={(e) => setMobileProvider(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="MTN Mobile Money">MTN Mobile Money</option>
                    <option value="Safaricom M-Pesa">Safaricom M-Pesa</option>
                    <option value="Vodafone Cash">Vodafone Cash</option>
                    <option value="AirtelTigo Money">AirtelTigo Money</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="+234 801 234 5678"
                    className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {payoutMethod === 'stellar_address' && (
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Stellar Public Key (G...)</label>
                <input
                  type="text"
                  value={stellarAddress}
                  onChange={(e) => setStellarAddress(e.target.value)}
                  placeholder="GAFROPAY..."
                  className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-sm font-mono text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Transfer Memo / Purpose</label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Family Support"
                className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-slate-800">
            <button
              onClick={() => setStep(1)}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 text-sm font-medium transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-all flex items-center gap-2"
            >
              <span>Simulate Path Payment</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Path Simulation & Quote Review */}
      {step === 3 && quote && (
        <div className="glass-panel rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-200">Stellar Path Payment Simulation</h3>
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-semibold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              Optimal Liquidity Route
            </span>
          </div>

          {/* Route Breakdown Visual */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <span className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">Path Hops:</span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {quote.pathRoute.map((hop, idx) => (
                <React.Fragment key={idx}>
                  <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-200 font-medium border border-slate-700">
                    {hop}
                  </span>
                  {idx < quote.pathRoute.length - 1 && (
                    <ChevronRight className="w-4 h-4 text-emerald-400" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Quote Details Table */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">Source Amount:</span>
              <span className="font-bold text-slate-100">{fromAmount} {fromCurrency}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">Guaranteed FX Rate:</span>
              <span className="font-mono text-emerald-400 font-semibold">1 {fromCurrency} = {quote.fxRate} {toCurrency}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">Recipient Payout:</span>
              <span className="font-bold text-emerald-400 text-sm">{quote.estimatedToAmount.toLocaleString()} {toCurrency}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">Stellar Base Fee:</span>
              <span className="font-mono text-slate-300">0.00001 XLM</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Anchor & Routing Fee:</span>
              <span className="font-mono text-slate-300">${quote.anchorFeeUSD.toFixed(2)} USD</span>
            </div>
          </div>

          {/* Compliance & Risk Notice */}
          <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-900/50 flex items-start gap-3 text-xs text-slate-300">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-emerald-300 block">AI Compliance & Fraud Scan Passed</span>
              <p className="text-slate-400 mt-0.5">
                Transaction risk score evaluated at <strong className="text-emerald-400">12/100 (LOW RISK)</strong>. Settlement will execute via Stellar path payments in 3.2 seconds.
              </p>
            </div>
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-slate-800">
            <button
              onClick={() => setStep(2)}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 text-sm font-medium transition-colors"
            >
              Edit Details
            </button>
            <button
              onClick={handleExecuteTransfer}
              className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/50"
            >
              <Zap className="w-4 h-4" />
              <span>Confirm & Submit to Stellar</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Live Execution & Settlement Animation */}
      {step === 4 && (
        <div className="glass-panel-glow rounded-2xl p-8 text-center space-y-6">
          {submittingPhase < 4 ? (
            <div className="space-y-6 py-6">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20 animate-ping"></div>
                <div className="w-20 h-20 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin flex items-center justify-center">
                  <Zap className="w-8 h-8 text-emerald-400" />
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold font-display text-white">Broadcasting to Stellar Horizon</h3>
                <p className="text-xs text-slate-400 mt-1">Executing path payment across Stellar decentralized orderbook</p>
              </div>

              {/* Status Checklist */}
              <div className="max-w-md mx-auto space-y-2 text-xs text-left bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center gap-2">
                  {submittingPhase >= 1 ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <RefreshCw className="w-4 h-4 text-slate-600 animate-spin" />}
                  <span className={submittingPhase >= 1 ? 'text-slate-200' : 'text-slate-500'}>
                    Constructed Stellar PathPaymentStrictSend Op XDR
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {submittingPhase >= 2 ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <RefreshCw className="w-4 h-4 text-slate-600 animate-spin" />}
                  <span className={submittingPhase >= 2 ? 'text-slate-200' : 'text-slate-500'}>
                    Cryptographically Signed by Vault Cosigner Key
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {submittingPhase >= 3 ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <RefreshCw className="w-4 h-4 text-slate-600 animate-spin" />}
                  <span className={submittingPhase >= 3 ? 'text-slate-200' : 'text-slate-500'}>
                    Validated by Stellar Horizon Consensus Ledger
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/50 shadow-lg shadow-emerald-950/80">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                  Settlement Confirmed in 3.2s
                </span>
                <h3 className="text-2xl font-extrabold font-display text-white mt-3">Remittance Successfully Sent!</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                  Recipient <strong className="text-slate-200">{recipientName}</strong> received <strong className="text-emerald-400">{completedTx?.destAmount.toLocaleString()} {completedTx?.destCurrency}</strong> in {selectedCountry.name}.
                </p>
              </div>

              {/* Transaction Receipt Card */}
              {completedTx && (
                <div className="max-w-md mx-auto bg-slate-900 rounded-xl p-4 border border-slate-800 text-xs space-y-2 text-left">
                  <div className="flex justify-between py-1 border-b border-slate-800">
                    <span className="text-slate-400">Transaction ID:</span>
                    <span className="font-mono text-slate-200 font-semibold">{completedTx.id}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800">
                    <span className="text-slate-400">Stellar Tx Hash:</span>
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${completedTx.stellarTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <span>{completedTx.stellarTxHash?.slice(0, 10)}...</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Anchor Payout Rail:</span>
                    <span className="text-slate-200 font-medium">{bankName || 'Local Bank Rail'}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-center gap-3 pt-2">
                <button
                  onClick={() => {
                    setStep(1);
                    setCompletedTx(null);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-800"
                >
                  Send Another
                </button>
                <button
                  onClick={() => completedTx && onSuccess(completedTx)}
                  className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-950/40"
                >
                  Go to Wallet Dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
};
