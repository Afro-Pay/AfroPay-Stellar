import React, { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Droplets, RefreshCw, ShieldAlert, ArrowRight } from 'lucide-react';

type ReserveHealth = 'HEALTHY' | 'WATCH' | 'CRITICAL';

type CorridorReserve = {
  corridor: string;
  reserveAsset: string;
  reserveAmount: number;
  weeklyDemand: number;
  lastChecked: string;
  health: ReserveHealth;
  rebalanceStatus: 'STABLE' | 'QUEUED' | 'COOLDOWN';
};

const INITIAL_RESERVES: CorridorReserve[] = [
  {
    corridor: 'USDC : NGN',
    reserveAsset: 'NGN',
    reserveAmount: 3850000,
    weeklyDemand: 14500000,
    lastChecked: 'Just now',
    health: 'HEALTHY',
    rebalanceStatus: 'STABLE',
  },
  {
    corridor: 'USDC : GHS',
    reserveAsset: 'GHS',
    reserveAmount: 410000,
    weeklyDemand: 1900000,
    lastChecked: 'Just now',
    health: 'WATCH',
    rebalanceStatus: 'QUEUED',
  },
  {
    corridor: 'EUR : NGN',
    reserveAsset: 'NGN',
    reserveAmount: 820000,
    weeklyDemand: 5900000,
    lastChecked: 'Just now',
    health: 'CRITICAL',
    rebalanceStatus: 'COOLDOWN',
  },
];

const healthStyles: Record<ReserveHealth, string> = {
  HEALTHY: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  WATCH: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  CRITICAL: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
};

export const LiquidityHealthPanel: React.FC = () => {
  const [reserves, setReserves] = useState(INITIAL_RESERVES);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const summary = useMemo(() => ({
    healthy: reserves.filter((reserve) => reserve.health === 'HEALTHY').length,
    critical: reserves.filter((reserve) => reserve.health === 'CRITICAL').length,
    queued: reserves.filter((reserve) => reserve.rebalanceStatus === 'QUEUED').length,
  }), [reserves]);

  const refresh = () => {
    setIsRefreshing(true);
    window.setTimeout(() => {
      setReserves((current) => current.map((reserve) => ({ ...reserve, lastChecked: 'Just now' })));
      setIsRefreshing(false);
    }, 500);
  };

  return (
    <div className="space-y-6">
      <div className="glass-panel-glow rounded-2xl p-6 border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-semibold tracking-wider uppercase text-cyan-400 flex items-center gap-1.5">
              <Droplets className="w-4 h-4" /> Automated liquidity controls
            </span>
            <h1 className="text-2xl font-bold font-display text-white mt-2">Corridor reserve health</h1>
            <p className="text-xs text-slate-400 mt-1">Hourly reserve checks with forecast-based treasury top-ups.</p>
          </div>
          <button
            onClick={refresh}
            disabled={isRefreshing}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-100 transition-all"
          >
            <RefreshCw className={`w-4 h-4 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            Sync reserves
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-5 border-t border-slate-800">
          <div className="bg-slate-950/70 rounded-xl p-3 border border-slate-800">
            <span className="text-[11px] text-slate-400">Corridors healthy</span>
            <strong className="block text-xl text-emerald-400 mt-1">{summary.healthy} / {reserves.length}</strong>
          </div>
          <div className="bg-slate-950/70 rounded-xl p-3 border border-slate-800">
            <span className="text-[11px] text-slate-400">Critical reserves</span>
            <strong className="block text-xl text-rose-400 mt-1">{summary.critical}</strong>
          </div>
          <div className="bg-slate-950/70 rounded-xl p-3 border border-slate-800">
            <span className="text-[11px] text-slate-400">Worker actions queued</span>
            <strong className="block text-xl text-amber-400 mt-1">{summary.queued}</strong>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {reserves.map((reserve) => {
          const threshold = reserve.weeklyDemand * 0.2;
          const reserveRatio = Math.min(100, (reserve.reserveAmount / reserve.weeklyDemand) * 100);
          return (
            <article key={reserve.corridor} className="glass-panel rounded-xl p-5 border border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-slate-500">Corridor</span>
                  <h2 className="text-lg font-bold text-white mt-1">{reserve.corridor}</h2>
                </div>
                <span className={`px-2 py-1 rounded-md border text-[10px] font-bold ${healthStyles[reserve.health]}`}>
                  {reserve.health}
                </span>
              </div>

              <div className="mt-5 space-y-3 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">{reserve.reserveAsset} reserve</span>
                  <strong className="text-slate-100">{reserve.reserveAmount.toLocaleString()}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Weekly forecast</span>
                  <strong className="text-slate-100">{reserve.weeklyDemand.toLocaleString()}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Trigger at 20%</span>
                  <strong className="text-amber-300">{threshold.toLocaleString()}</strong>
                </div>
              </div>

              <div className="mt-5">
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${reserve.health === 'CRITICAL' ? 'bg-rose-400' : reserve.health === 'WATCH' ? 'bg-amber-400' : 'bg-emerald-400'}`}
                    style={{ width: `${reserveRatio}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-[10px] text-slate-500">
                  <span>0%</span>
                  <span>{reserveRatio.toFixed(1)}% of forecast</span>
                  <span>100%</span>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between gap-3 text-[11px]">
                <span className="flex items-center gap-1.5 text-slate-400">
                  {reserve.health === 'HEALTHY' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : reserve.health === 'WATCH' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> : <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />}
                  {reserve.rebalanceStatus}
                </span>
                <span className="flex items-center gap-1 text-slate-500">
                  <Activity className="w-3.5 h-3.5" /> {reserve.lastChecked}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="glass-panel rounded-xl p-5 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-white">Rebalancer safeguards active</h2>
          <p className="text-xs text-slate-400 mt-1">Daily volume cap, three-action limit, distributed lock, and opposite-direction cooldown.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
          Worker online <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </div>
  );
};
