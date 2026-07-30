import React, { useState } from 'react';
import { 
  ArrowLeftRight, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Building2, 
  CheckCircle2, 
  ExternalLink, 
  ShieldCheck, 
  Zap, 
  AlertCircle,
  RefreshCw,
  Search,
  Globe,
  Layers
} from 'lucide-react';
import { ANCHOR_PARTNERS } from '../lib/constants';
import { CurrencyCode, WalletState, TransactionRecord } from '../types';
import { StorageService } from '../lib/storage';
import { generateTxHash } from '../lib/stellar';

interface AnchorRailsProps {
  wallet: WalletState;
  onRefreshWallet: () => void;
  onSuccessTransaction: (tx: TransactionRecord) => void;
}

const NIGERIAN_BANKS = [
  'Guaranty Trust Bank (GTB)',
  'Access Bank',
  'Zenith Bank',
  'First Bank of Nigeria',
  'Kuda Microfinance Bank',
  'Moniepoint MFB',
  'Opay Digital Services',
  'United Bank for Africa (UBA)',
  'Fidelity Bank',
];

export const AnchorRails: React.FC<AnchorRailsProps> = ({
  wallet,
  onRefreshWallet,
  onSuccessTransaction,
}) => {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  
  // Deposit state
  const [depositCurrency, setDepositCurrency] = useState<CurrencyCode>('NGN');
  const [depositAmount, setDepositAmount] = useState<number>(100000);
  const [selectedAnchor, setSelectedAnchor] = useState(ANCHOR_PARTNERS[0]);
  const [isProcessingDeposit, setIsProcessingDeposit] = useState(false);
  const [depositComplete, setDepositComplete] = useState(false);

  // Withdraw state
  const [withdrawCurrency, setWithdrawCurrency] = useState<CurrencyCode>('NGN');
  const [withdrawAmount, setWithdrawAmount] = useState<number>(50000);
  const [selectedBank, setSelectedBank] = useState(NIGERIAN_BANKS[0]);
  const [accountNumber, setAccountNumber] = useState('0129847120');
  const [verifyingAccount, setVerifyingAccount] = useState(false);
  const [verifiedName, setVerifiedName] = useState<string | null>('Oluwaseun Adewale');
  const [isProcessingWithdraw, setIsProcessingWithdraw] = useState(false);

  // Verify Bank Account
  const handleVerifyAccount = () => {
    if (accountNumber.length < 10) return;
    setVerifyingAccount(true);
    setVerifiedName(null);
    setTimeout(() => {
      setVerifyingAccount(false);
      setVerifiedName('Oluwaseun Adewale');
    }, 800);
  };

  // Execute Deposit (Mint asset on Stellar)
  const handleExecuteDeposit = () => {
    setIsProcessingDeposit(true);
    setTimeout(() => {
      const destAmount = depositCurrency === 'NGN' ? depositAmount / 1520.50 : depositAmount;
      const tx: TransactionRecord = {
        id: `dep_stx_${Date.now()}`,
        type: 'deposit',
        sourceCurrency: depositCurrency,
        sourceAmount: depositAmount,
        destCurrency: 'USDC',
        destAmount: Number(destAmount.toFixed(2)),
        fxRate: 1 / 1520.50,
        feeUSD: 0.50,
        recipient: {
          name: 'Self (AfroPay Stellar Wallet)',
          country: 'Nigeria',
          countryFlag: '🇳🇬',
          payoutMethod: 'stellar_address',
          stellarAddress: wallet.publicKey,
        },
        status: 'settled',
        stellarTxHash: generateTxHash(),
        anchorName: selectedAnchor.name,
        createdAt: new Date().toISOString(),
        completedAt: new Date(Date.now() + 2500).toISOString(),
        riskScore: 5,
        riskLevel: 'LOW',
        memo: 'SEP-24 Anchor Deposit',
      };

      StorageService.addTransaction(tx);
      onRefreshWallet();
      onSuccessTransaction(tx);
      setIsProcessingDeposit(false);
      setDepositComplete(true);
    }, 2000);
  };

  // Execute Withdrawal (Off-ramp to bank)
  const handleExecuteWithdrawal = () => {
    setIsProcessingWithdraw(true);
    setTimeout(() => {
      const tx: TransactionRecord = {
        id: `wd_stx_${Date.now()}`,
        type: 'withdrawal',
        sourceCurrency: 'USDC',
        sourceAmount: withdrawAmount / 1520.50,
        destCurrency: withdrawCurrency,
        destAmount: withdrawAmount,
        fxRate: 1520.50,
        feeUSD: 0.75,
        recipient: {
          name: verifiedName || 'Bank Account Holder',
          country: 'Nigeria',
          countryFlag: '🇳🇬',
          payoutMethod: 'bank_account',
          bankName: selectedBank,
          accountNumber,
        },
        status: 'settled',
        stellarTxHash: generateTxHash(),
        anchorName: 'Cowrie / NIBSS Local Bank Off-ramp',
        createdAt: new Date().toISOString(),
        completedAt: new Date(Date.now() + 2800).toISOString(),
        riskScore: 10,
        riskLevel: 'LOW',
        memo: 'SEP-31 Anchor Bank Off-Ramp',
      };

      StorageService.addTransaction(tx);
      onRefreshWallet();
      onSuccessTransaction(tx);
      setIsProcessingWithdraw(false);
    }, 2500);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Explanation Banner */}
      <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/50 flex items-center justify-center text-emerald-400">
              <ArrowLeftRight className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-display text-white">Stellar SEP-24 & SEP-31 Fiat Rails</h2>
              <p className="text-xs text-slate-400">Seamless deposit and off-ramp between African fiat currencies & Stellar tokens</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('deposit')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'deposit'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-950/40'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Deposit Fiat
            </button>
            <button
              onClick={() => setActiveTab('withdraw')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'withdraw'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-950/40'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Withdraw to Bank
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Flow Form */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-6 space-y-6">
          {activeTab === 'deposit' ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <h3 className="text-lg font-bold font-display text-white flex items-center gap-2">
                  <ArrowDownLeft className="w-5 h-5 text-emerald-400" />
                  <span>Fiat Deposit (On-Ramp)</span>
                </h3>
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-950 px-2.5 py-1 rounded-full border border-emerald-800">
                  SEP-24 Compliant
                </span>
              </div>

              {/* Deposit Inputs */}
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Select Anchor Gateway</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {ANCHOR_PARTNERS.map((anchor) => (
                      <button
                        key={anchor.id}
                        onClick={() => setSelectedAnchor(anchor)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          selectedAnchor.id === anchor.id
                            ? 'bg-emerald-950/60 border-emerald-500 text-slate-100'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-white">{anchor.name}</span>
                          <span>{anchor.flag}</span>
                        </div>
                        <span className="text-[11px] text-slate-400 block">Fee: {anchor.feePercentage}% • {anchor.avgProcessTime}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">Deposit Fiat Amount</label>
                    <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-2">
                      <input
                        type="number"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(parseFloat(e.target.value) || 0)}
                        className="w-full bg-transparent text-lg font-bold text-white px-2 focus:outline-none"
                      />
                      <select
                        value={depositCurrency}
                        onChange={(e) => setDepositCurrency(e.target.value as CurrencyCode)}
                        className="bg-slate-800 text-xs font-bold text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700"
                      >
                        <option value="NGN">🇳🇬 NGN</option>
                        <option value="USDC">🇺🇸 USDC</option>
                        <option value="EUR">🇪🇺 EUR</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">Estimated Minted Stellar Tokens</label>
                    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 font-bold font-display text-emerald-400 text-lg">
                      ≈ ${(depositCurrency === 'NGN' ? depositAmount / 1520.50 : depositAmount).toFixed(2)} USDC
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-2">
                  <span className="font-semibold text-slate-200 block">Virtual Bank Account Details for Transfer:</span>
                  <div className="grid grid-cols-2 gap-2 text-slate-400 pt-1">
                    <div>Bank Name: <strong className="text-slate-200">Providus Bank / Cowrie Anchor</strong></div>
                    <div>Account Number: <strong className="text-emerald-400 font-mono">9928104820</strong></div>
                    <div>Account Name: <strong className="text-slate-200">AfroPay-Stellar Vault</strong></div>
                    <div>Reference Memo: <strong className="text-amber-400 font-mono">STX-DEP-9821</strong></div>
                  </div>
                </div>

                <button
                  onClick={handleExecuteDeposit}
                  disabled={isProcessingDeposit}
                  className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40"
                >
                  {isProcessingDeposit ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Verifying Bank Deposit on Horizon...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      <span>Simulate Fiat Bank Deposit</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <h3 className="text-lg font-bold font-display text-white flex items-center gap-2">
                  <ArrowUpRight className="w-5 h-5 text-emerald-400" />
                  <span>Withdrawal to Local Bank (Off-Ramp)</span>
                </h3>
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-950 px-2.5 py-1 rounded-full border border-emerald-800">
                  SEP-31 Compliant
                </span>
              </div>

              {/* Withdraw Inputs */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">Select Bank</label>
                    <select
                      value={selectedBank}
                      onChange={(e) => setSelectedBank(e.target.value)}
                      className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-sm text-white focus:outline-none"
                    >
                      {NIGERIAN_BANKS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">Account Number</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        placeholder="0123456789"
                        className="w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-sm font-mono text-white focus:outline-none"
                      />
                      <button
                        onClick={handleVerifyAccount}
                        disabled={verifyingAccount}
                        className="px-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 shrink-0"
                      >
                        {verifyingAccount ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Verify'}
                      </button>
                    </div>
                  </div>
                </div>

                {verifiedName && (
                  <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/60 flex items-center gap-2 text-xs text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Account Holder Verified: <strong>{verifiedName}</strong></span>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Withdrawal Amount (NGN)</label>
                  <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-2">
                    <input
                      type="number"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(parseFloat(e.target.value) || 0)}
                      className="w-full bg-transparent text-lg font-bold text-white px-2 focus:outline-none"
                    />
                    <span className="text-xs font-bold text-slate-400 px-3">🇳🇬 NGN</span>
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Deducted from Stellar Wallet: ≈ ${(withdrawAmount / 1520.50).toFixed(2)} USDC
                  </span>
                </div>

                <button
                  onClick={handleExecuteWithdrawal}
                  disabled={isProcessingWithdraw || !verifiedName}
                  className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40"
                >
                  {isProcessingWithdraw ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Initiating NIBSS Bank Payout...</span>
                    </>
                  ) : (
                    <>
                      <Building2 className="w-4 h-4" />
                      <span>Execute Bank Off-Ramp</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Anchor Network Status Side Panel */}
        <div className="glass-panel rounded-2xl p-6 space-y-4">
          <h3 className="font-bold text-slate-200 text-base flex items-center gap-2">
            <Globe className="w-4 h-4 text-emerald-400" />
            <span>Supported SEP Anchors</span>
          </h3>

          <div className="space-y-3">
            {ANCHOR_PARTNERS.map((partner) => (
              <div key={partner.id} className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <span>{partner.flag}</span>
                    <span>{partner.name}</span>
                  </span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                </div>
                <div className="text-slate-400 flex justify-between">
                  <span>Currencies:</span>
                  <span className="text-slate-200 font-mono">{partner.supportedCurrencies.join(', ')}</span>
                </div>
                <div className="text-slate-400 flex justify-between">
                  <span>Speed:</span>
                  <span className="text-emerald-400 font-medium">{partner.avgProcessTime}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400 space-y-1">
            <span className="font-semibold text-slate-300 block">What are Stellar Anchors?</span>
            <p className="text-[11px] leading-relaxed">
              Anchors bridge local bank rails to the Stellar DEX, converting fiat currencies into 1:1 backed digital assets.
            </p>
          </div>
        </div>

      </div>

    </div>
  );
};
