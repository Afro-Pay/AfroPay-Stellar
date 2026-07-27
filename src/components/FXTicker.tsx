import React from 'react';
import { ArrowUpRight, ArrowDownRight, RefreshCw, Zap } from 'lucide-react';

export const FXTicker: React.FC = () => {
  const rates = [
    { pair: 'USD/NGN', rate: '1,520.50', change: '+0.12%', isUp: true },
    { pair: 'EUR/NGN', rate: '1,652.80', change: '+0.08%', isUp: true },
    { pair: 'USDC/XLM', rate: '8.695', change: '-0.24%', isUp: false },
    { pair: 'USD/KES', rate: '129.40', change: '+0.05%', isUp: true },
    { pair: 'USD/GHS', rate: '15.80', change: '-0.10%', isUp: false },
    { pair: 'XLM/NGN', rate: '174.85', change: '+0.45%', isUp: true },
  ];

  return (
    <div className="bg-slate-900/90 border-y border-slate-800/80 py-2 px-4 overflow-hidden text-xs">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-emerald-400 font-bold shrink-0">
          <Zap className="w-3.5 h-3.5" />
          <span className="hidden sm:inline uppercase tracking-wider text-[11px]">Live FX Rates:</span>
        </div>

        <div className="flex items-center gap-6 overflow-x-auto no-scrollbar py-0.5 text-slate-300">
          {rates.map((r, i) => (
            <div key={i} className="flex items-center gap-2 shrink-0 font-mono">
              <span className="font-semibold text-slate-200">{r.pair}</span>
              <span className="text-white font-bold">{r.rate}</span>
              <span className={`text-[10px] font-semibold flex items-center ${
                r.isUp ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {r.isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {r.change}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
