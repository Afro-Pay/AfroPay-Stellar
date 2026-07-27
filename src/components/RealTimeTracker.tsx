import React, { useState } from 'react';
import { SSELogEvent, TransactionRecord } from '../types';
import { Radio, Play, CheckCircle2, RefreshCw, Server, Cpu, Layers, Terminal } from 'lucide-react';

interface RealTimeTrackerProps {
  logs: SSELogEvent[];
  transactions: TransactionRecord[];
  onTriggerStreamSimulation: (txId: string) => void;
}

export const RealTimeTracker: React.FC<RealTimeTrackerProps> = ({
  logs,
  transactions,
  onTriggerStreamSimulation,
}) => {
  const [selectedTxId, setSelectedTxId] = useState<string>(transactions[0]?.id || 'tx_afro_98124');
  const [isSimulatingStream, setIsSimulatingStream] = useState(false);

  const handleStartStream = () => {
    setIsSimulatingStream(true);
    onTriggerStreamSimulation(selectedTxId);
    setTimeout(() => {
      setIsSimulatingStream(false);
    }, 4500);
  };

  return (
    <div className="space-y-6">
      
      {/* Banner */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
            <Radio className="w-4 h-4 animate-pulse" /> Server-Sent Events (SSE) Stream
          </div>
          <h2 className="text-xl font-bold font-display text-white">
            Real-Time Settlement Pipeline Tracker
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Streaming status updates from NestJS EventEmitter2 → BullMQ Redis → Rust Worker → Stellar Horizon.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs text-slate-300 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span>SSE Endpoint: <strong className="text-emerald-400">/api/v1/transactions/:id/stream</strong></span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Stream Trigger Controls */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-5">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" /> SSE Stream Test Console
          </h3>

          <p className="text-xs text-slate-400 leading-relaxed">
            Select a transaction ID to connect a mock EventSource client. This simulates the backend processor emitting status events through the pipeline.
          </p>

          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-300">Select Transaction to Watch</label>
            <select
              value={selectedTxId}
              onChange={(e) => setSelectedTxId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 text-emerald-400 font-mono text-xs rounded-xl p-3 focus:outline-none"
            >
              {transactions.map((tx) => (
                <option key={tx.id} value={tx.id}>
                  {tx.id} — {tx.sendAmount} {tx.sendCurrency} → {tx.receiveCurrency} ({tx.status})
                </option>
              ))}
            </select>

            <button
              onClick={handleStartStream}
              disabled={isSimulatingStream}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition cursor-pointer"
            >
              {isSimulatingStream ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Streaming Events (EventSource Active)...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Simulate Full SSE Stream Lifecycle</span>
                </>
              )}
            </button>
          </div>

          {/* Architecture Pipeline Map */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
            <div className="font-bold text-slate-300">Microservice Pipeline Stages:</div>
            
            <div className="space-y-2 text-[11px] font-mono">
              <div className="flex items-center gap-2 text-slate-400">
                <Server className="w-3.5 h-3.5 text-cyan-400" />
                <span>1. NestJS Controller (REST POST)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400 pl-4 border-l border-slate-800">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                <span>2. BullMQ Redis Queue (enqueue job)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400 pl-4 border-l border-slate-800">
                <Cpu className="w-3.5 h-3.5 text-purple-400" />
                <span>3. Rust Settlement Worker (sign tx)</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-400 pl-4 border-l border-slate-800 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>4. Stellar Horizon Ledger (Confirmed)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Terminal Log Feed */}
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500"></span>
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-mono text-slate-400 ml-2">sse_event_stream.log</span>
            </div>
            <span className="text-xs font-mono text-slate-500">{logs.length} events logged</span>
          </div>

          {/* Terminal Console */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-900 font-mono text-xs h-96 overflow-y-auto space-y-3">
            {logs.length === 0 ? (
              <div className="text-slate-600 italic py-12 text-center">
                No SSE events recorded yet. Click "Simulate Full SSE Stream Lifecycle" or send a remittance to watch events live.
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="space-y-1 pb-2 border-b border-slate-900">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>[{log.timestamp}]</span>
                    <span className="text-emerald-400 font-semibold">{log.step}</span>
                  </div>

                  <div className="flex items-start gap-2 text-slate-300">
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                      log.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400' :
                      log.status === 'PENDING' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-cyan-500/20 text-cyan-400'
                    }`}>
                      {log.status}
                    </span>
                    <span className="text-slate-200">{log.message}</span>
                  </div>

                  {log.stellarHash && (
                    <div className="text-[10px] text-slate-500 truncate">
                      Hash: <span className="text-emerald-400">{log.stellarHash}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
