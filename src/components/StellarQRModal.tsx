import React, { useState } from 'react';
import { X, Copy, Check, QrCode, ExternalLink, ShieldCheck } from 'lucide-react';

interface StellarQRModalProps {
  publicKey: string;
  onClose: () => void;
}

export const StellarQRModal: React.FC<StellarQRModalProps> = ({ publicKey, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel rounded-2xl max-w-sm w-full p-6 text-center space-y-5 relative border border-slate-700">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg bg-slate-900 text-slate-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>

        <div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-950 text-emerald-400 flex items-center justify-center mx-auto mb-2 border border-emerald-800">
            <QrCode className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-lg text-white">Stellar Wallet QR Code</h3>
          <p className="text-xs text-slate-400">Scan to deposit XLM or Stellar assets</p>
        </div>

        {/* Mock QR Code Graphic */}
        <div className="bg-white p-4 rounded-xl max-w-[200px] mx-auto shadow-xl">
          <div className="w-full aspect-square bg-slate-950 p-2 rounded flex flex-col justify-between items-center relative overflow-hidden">
            <div className="grid grid-cols-5 gap-1.5 w-full h-full p-1 bg-white">
              {Array.from({ length: 25 }).map((_, i) => (
                <div
                  key={i}
                  className={`rounded-sm ${
                    i % 2 === 0 || i % 7 === 0 || i % 3 === 0 ? 'bg-slate-950' : 'bg-emerald-600'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Key Display */}
        <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-2 text-left">
          <span className="text-[11px] text-slate-400 font-semibold block">Public Key (G...):</span>
          <p className="font-mono text-xs text-emerald-400 break-all bg-slate-950 p-2 rounded border border-slate-800">
            {publicKey}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied Address!' : 'Copy Address'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
