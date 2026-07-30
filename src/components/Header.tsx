import React, { useState } from 'react';
import { Globe, Shield, Copy, Check, Key, Activity, RefreshCw } from 'lucide-react';
import { UserWallet } from '../types';

interface HeaderProps {
  wallet: UserWallet;
  onRefreshWallet: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({ wallet, onRefreshWallet, isRefreshing }) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);

  const copyPublicKey = () => {
    navigator.clipboard.writeText(wallet.publicKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const truncatedKey = `${wallet.publicKey.slice(0, 6)}...${wallet.publicKey.slice(-6)}`;

  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Logo & Network */}
          <div className="flex items-center justify-between md:justify-start gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-emerald-500/20">
                🌍
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold font-display tracking-tight text-white">
                    AfroPay <span className="text-emerald-400 font-light">Stellar</span>
                  </h1>
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Testnet
                  </span>
                </div>
                <p className="text-xs text-slate-400 hidden sm:block">
                  Cross-Border Remittance & Liquidity Rail for Africa
                </p>
              </div>
            </div>

            {/* Refresh Button */}
            <button
              onClick={onRefreshWallet}
              disabled={isRefreshing}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-all text-xs flex items-center gap-1.5"
              title="Refresh Stellar Horizon state"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
            </button>
          </div>

          {/* Ticker & Wallet Bar */}
          <div className="flex items-center justify-between md:justify-end gap-3 flex-wrap">
            
            {/* Live FX Ticker */}
            <div className="hidden xl:flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
              <span className="text-slate-400 flex items-center gap-1">
                <Globe className="w-3 h-3 text-emerald-400" />
                FX Rates:
              </span>
              <span className="text-emerald-400 font-medium">USD/NGN ₦1,500</span>
              <span className="text-slate-600">•</span>
              <span className="text-cyan-400 font-medium">XLM $0.11</span>
              <span className="text-slate-600">•</span>
              <span className="text-purple-400 font-medium">EUR $1.08</span>
            </div>

            {/* Wallet Key Address */}
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-1.5 px-3 text-xs">
              <span className="text-slate-400 font-mono hidden sm:inline">Key:</span>
              <code className="text-emerald-300 font-mono font-semibold" title={wallet.publicKey}>
                {truncatedKey}
              </code>
              <button
                onClick={copyPublicKey}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
                title="Copy Stellar Public Key"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setShowKeyModal(true)}
                className="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                title="View Encrypted Key Vault"
              >
                <Key className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Health status */}
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-800">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Horizon & BullMQ</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            </div>
          </div>

        </div>
      </div>

      {/* Secret Key Vault Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <Shield className="w-5 h-5" />
                <span>Stellar Account Keys</span>
              </div>
              <button
                onClick={() => setShowKeyModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4">
              In AfroPay production, user private keys are encrypted at rest using AES-256 with a system key in PostgreSQL.
            </p>

            <div className="space-y-3 font-mono text-xs mb-4">
              <div className="bg-slate-950 p-3 rounded border border-slate-800">
                <span className="text-slate-500 block mb-1">PUBLIC KEY (G...):</span>
                <span className="text-emerald-400 break-all">{wallet.publicKey}</span>
              </div>

              <div className="bg-slate-950 p-3 rounded border border-slate-800">
                <span className="text-slate-500 block mb-1">ENCRYPTED SECRET KEY STORAGE:</span>
                <span className="text-amber-300 break-all">{wallet.secretKeyEncrypted}</span>
              </div>

              <div className="bg-slate-950 p-3 rounded border border-slate-800">
                <span className="text-slate-500 block mb-1">STELLAR NETWORK SEQUENCE #:</span>
                <span className="text-cyan-400">{wallet.sequenceNumber}</span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition"
              >
                Close Vault
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
