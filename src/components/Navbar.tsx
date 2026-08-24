import React, { useState } from 'react';
import { 
  Zap, 
  Send, 
  Wallet, 
  ArrowLeftRight, 
  History, 
  ShieldCheck, 
  Copy, 
  Check, 
  QrCode, 
  Globe, 
  ExternalLink,
  ChevronDown
} from 'lucide-react';
import { WalletState } from '../types';

interface NavbarProps {
  activeTab: 'dashboard' | 'send' | 'anchor' | 'history' | 'kyc';
  setActiveTab: (tab: 'dashboard' | 'send' | 'anchor' | 'history' | 'kyc') => void;
  wallet: WalletState;
  onOpenQR: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  wallet,
  onOpenQR,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(wallet.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncatedKey = `${wallet.publicKey.slice(0, 5)}...${wallet.publicKey.slice(-5)}`;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
      {/* Top Ticker / Status Bar */}
      <div className="bg-emerald-950/40 border-b border-emerald-900/30 px-4 py-1.5 text-xs text-slate-300">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Stellar Testnet: Horizon Online
            </span>
            <span className="hidden sm:inline text-slate-600">|</span>
            <span className="hidden sm:inline text-slate-400">Avg Settlement: <strong className="text-slate-200">3.2s</strong></span>
            <span className="hidden sm:inline text-slate-600">|</span>
            <span className="hidden md:inline text-slate-400">Path Payment Router: <span className="text-emerald-400">Active</span></span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <a 
              href={`https://stellar.expert/explorer/testnet/account/${wallet.publicKey}`} 
              target="_blank" 
              rel="noreferrer"
              className="hover:text-emerald-400 flex items-center gap-1 transition-colors"
            >
              <span>Stellar.Expert</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <span className="text-slate-600">|</span>
            <span className="text-slate-300">Base Fee: <strong className="text-amber-400">0.00001 XLM</strong></span>
          </div>
        </div>
      </div>

      {/* Main Nav */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Brand */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/50">
              <Zap className="w-6 h-6 text-slate-950 fill-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold font-display tracking-tight text-white">Afro<span className="text-emerald-400">Pay</span></span>
                <span className="text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 uppercase">
                  Stellar
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">Cross-Border African Remittance</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>Wallet Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('send')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'send'
                  ? 'bg-emerald-600 text-slate-950 font-semibold shadow-md shadow-emerald-900/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Send className="w-4 h-4" />
              <span>Send Remittance</span>
            </button>

            <button
              onClick={() => setActiveTab('anchor')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'anchor'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>Fiat Anchors</span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'history'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <History className="w-4 h-4" />
              <span>Ledger & History</span>
            </button>

            <button
              onClick={() => setActiveTab('kyc')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'kyc'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>KYC & Risk</span>
            </button>
          </nav>

          {/* Wallet Address & Controls */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
              <div className="flex items-center gap-2 px-2.5 py-1 text-xs text-slate-300 font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>{truncatedKey}</span>
              </div>
              <button
                onClick={handleCopy}
                title="Copy Stellar Public Key"
                className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={onOpenQR}
                title="Show QR Code"
                className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-emerald-400 transition-colors"
              >
                <QrCode className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={() => setActiveTab('send')}
              className="md:hidden flex items-center justify-center p-2.5 rounded-lg bg-emerald-500 text-slate-950 font-bold"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>

      {/* Mobile Sub-Nav */}
      <div className="md:hidden border-t border-slate-800/80 bg-slate-950/95 px-2 py-1.5 flex items-center justify-around text-xs">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center py-1 px-2.5 rounded ${
            activeTab === 'dashboard' ? 'text-emerald-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Wallet</span>
        </button>
        <button
          onClick={() => setActiveTab('send')}
          className={`flex flex-col items-center py-1 px-2.5 rounded ${
            activeTab === 'send' ? 'text-emerald-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <Send className="w-4 h-4" />
          <span>Send</span>
        </button>
        <button
          onClick={() => setActiveTab('anchor')}
          className={`flex flex-col items-center py-1 px-2.5 rounded ${
            activeTab === 'anchor' ? 'text-emerald-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>Anchors</span>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center py-1 px-2.5 rounded ${
            activeTab === 'history' ? 'text-emerald-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Ledger</span>
        </button>
        <button
          onClick={() => setActiveTab('kyc')}
          className={`flex flex-col items-center py-1 px-2.5 rounded ${
            activeTab === 'kyc' ? 'text-emerald-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>KYC</span>
        </button>
      </div>
    </header>
  );
};
