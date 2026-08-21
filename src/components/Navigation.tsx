import React from 'react';
import { LayoutDashboard, Send, Anchor, ShieldCheck, Radio, FileCode } from 'lucide-react';

export type NavTab = 'dashboard' | 'remittance' | 'anchors' | 'compliance' | 'tracker' | 'specs';

interface NavigationProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  pendingTxCount?: number;
}

export const Navigation: React.FC<NavigationProps> = ({ activeTab, onTabChange, pendingTxCount = 0 }) => {
  const navItems: { id: NavTab; label: string; icon: React.FC<{ className?: string }>; badge?: number | string }[] = [
    { id: 'dashboard', label: 'Wallet & Balances', icon: LayoutDashboard },
    { id: 'remittance', label: 'Send Remittance', icon: Send },
    { id: 'anchors', label: 'Anchor Fiat Rails', icon: Anchor },
    { id: 'compliance', label: 'KYC & Compliance', icon: ShieldCheck },
    { id: 'tracker', label: 'Real-Time SSE Stream', icon: Radio, badge: pendingTxCount > 0 ? pendingTxCount : undefined },
    { id: 'specs', label: 'API & Specs', icon: FileCode },
  ];

  return (
    <nav className="bg-slate-900/80 border-b border-slate-800 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-1 overflow-x-auto py-2 no-scrollbar">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm shadow-emerald-500/10'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500 text-slate-950 animate-pulse">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
