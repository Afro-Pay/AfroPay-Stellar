import React, { useState } from 'react';
import { FileCode, Database, Server, CheckCircle2, Copy, Check, Terminal, Play } from 'lucide-react';

export const ApiArchitectureViewer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'architecture' | 'endpoints' | 'schema' | 'checklist'>('architecture');
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  // Mock API test runner
  const [selectedEndpoint, setSelectedEndpoint] = useState('/api/v1/transactions/quote');
  const [apiResponse, setApiResponse] = useState<string | null>(null);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(key);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  const handleRunApiTest = () => {
    if (selectedEndpoint === '/api/v1/transactions/quote') {
      setApiResponse(
        JSON.stringify(
          {
            sourceCurrency: 'USDC',
            destinationCurrency: 'NGN',
            sourceAmount: 500,
            destinationAmount: 750000,
            exchangeRate: 1500,
            pathPayment: ['USDC', 'XLM', 'NGN'],
            feeUsd: 0.15,
            stellarFeeXlm: 0.00001,
            expiresInSeconds: 30,
          },
          null,
          2
        )
      );
    } else if (selectedEndpoint === '/api/v1/wallet/balance') {
      setApiResponse(
        JSON.stringify(
          {
            publicKey: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFSRJDICTZARF7CJW34EFTITXL2YQ5',
            balances: [
              { asset_type: 'native', balance: '12500.5000000' },
              { asset_code: 'USDC', balance: '2450.000000', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
              { asset_code: 'NGN', balance: '3850000.000000', issuer: 'GAREDFW46K4H2O6K2Q35P5R2E7R2P4G45P6F7G8H9J1K2L3M4N5O6P7Q' },
            ],
          },
          null,
          2
        )
      );
    } else {
      setApiResponse(
        JSON.stringify(
          {
            status: 'HEALTHY',
            version: '1.0.0',
            services: {
              postgres: 'CONNECTED',
              redis: 'CONNECTED',
              stellar_horizon: 'CONNECTED',
            },
          },
          null,
          2
        )
      );
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Navigation Header */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
            <FileCode className="w-4 h-4" /> System Architecture & NestJS API Reference
          </div>
          <h2 className="text-xl font-bold font-display text-white">AfroPay-Stellar Platform Specifications</h2>
        </div>

        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
          {[
            { id: 'architecture', label: 'Architecture' },
            { id: 'endpoints', label: 'API Playground' },
            { id: 'schema', label: 'Prisma DB' },
            { id: 'checklist', label: 'Checklist' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === item.id ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'architecture' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" /> Polyglot Microservices Stack
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              AfroPay-Stellar combines high-throughput asynchronous workers with NestJS API orchestrators and Python ML fraud detection.
            </p>

            <div className="space-y-3 text-xs font-mono">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-emerald-400 font-bold block">1. API Gateway (NestJS / TypeScript)</span>
                <span className="text-slate-400">JWT auth, AES-256 wallet key store, transfer simulation, SSE stream</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-amber-400 font-bold block">2. Settlement Engine (Rust Worker)</span>
                <span className="text-slate-400">Consumes queued BullMQ jobs, constructs Stellar path payments, signs txs</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-cyan-400 font-bold block">3. Fraud Intelligence (Python Analytics)</span>
                <span className="text-slate-400">Real-time risk scoring, pattern monitoring, compliance alerts</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-purple-400 font-bold block">4. Persistence Layer (PostgreSQL 16 + Prisma)</span>
                <span className="text-slate-400">User records, encrypted wallet keys, transaction status, audit log</span>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-cyan-400" /> Key Stellar Features
            </h3>

            <div className="space-y-3 text-xs leading-relaxed text-slate-300">
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800">
                <strong className="text-white block">⚡ Stellar Path Payments (DEX Orderbooks):</strong>
                Path payments find optimal liquidity pools to swap source assets (e.g., USDC) into target assets (e.g., NGN) in a single atomic transaction.
              </div>
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800">
                <strong className="text-white block">🔒 SEP-24 / SEP-6 Fiat Anchors:</strong>
                Supports standardized deposit and withdrawal flows with regulated financial institutions in Nigeria (GTBank, Access Bank, Zenith).
              </div>
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800">
                <strong className="text-white block">🛡️ AES-256 Private Key Custody:</strong>
                User private keypairs are encrypted before database persistence using an encryption key provided at server boot.
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'endpoints' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" /> Interactive REST API Tester
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Select Endpoint</label>
                <select
                  value={selectedEndpoint}
                  onChange={(e) => {
                    setSelectedEndpoint(e.target.value);
                    setApiResponse(null);
                  }}
                  className="w-full bg-slate-900 border border-slate-800 text-emerald-400 font-mono text-xs rounded-xl p-3 focus:outline-none"
                >
                  <option value="/api/v1/transactions/quote">GET /api/v1/transactions/quote (FX Path Rate)</option>
                  <option value="/api/v1/wallet/balance">GET /api/v1/wallet/balance (Horizon Balances)</option>
                  <option value="/api/v1/health">GET /api/v1/health (Microservice Status)</option>
                </select>
              </div>

              <button
                onClick={handleRunApiTest}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Play className="w-4 h-4" /> Execute Request
              </button>

              {apiResponse && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono text-slate-400">
                    <span>Response JSON (200 OK)</span>
                    <button
                      onClick={() => copyText(apiResponse, 'response')}
                      className="text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      {copiedEndpoint === 'response' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      Copy
                    </button>
                  </div>
                  <pre className="bg-slate-950 p-4 rounded-xl border border-slate-900 font-mono text-xs text-emerald-300 overflow-x-auto max-h-64">
                    {apiResponse}
                  </pre>
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-3">
            <h3 className="text-base font-bold text-white">NestJS Controller Routes</h3>
            <div className="space-y-2 text-xs font-mono">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px] mr-2">POST</span>
                  <span className="text-white">/api/v1/auth/register</span>
                </div>
                <span className="text-slate-500 text-[10px]">Create User & Wallet</span>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px] mr-2">POST</span>
                  <span className="text-white">/api/v1/transactions/send</span>
                </div>
                <span className="text-slate-500 text-[10px]">Enqueue Transfer</span>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-bold text-[10px] mr-2">GET</span>
                  <span className="text-white">/api/v1/transactions/:id/stream</span>
                </div>
                <span className="text-emerald-400 text-[10px]">SSE Stream</span>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px] mr-2">POST</span>
                  <span className="text-white">/api/v1/anchor/deposit</span>
                </div>
                <span className="text-slate-500 text-[10px]">SEP-24 Deposit</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'schema' && (
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" /> Prisma ORM Schema Preview
          </h3>

          <pre className="bg-slate-950 p-4 rounded-xl border border-slate-900 font-mono text-xs text-slate-300 overflow-x-auto">
{`model User {
  id            String        @id @default(uuid())
  email         String        @unique
  passwordHash  String
  kycTier       String        @default("Tier 1")
  wallet        Wallet?
  transactions  Transaction[]
  createdAt     DateTime      @default(now())
}

model Wallet {
  id                 String   @id @default(uuid())
  userId             String   @unique
  user               User     @relation(fields: [userId], references: [id])
  publicKey          String   @unique
  secretKeyEncrypted String   // AES-256 Encrypted
  network            String   @default("testnet")
  createdAt          DateTime @default(now())
}

model Transaction {
  id               String      @id @default(uuid())
  userId           String
  user             User        @relation(fields: [userId], references: [id])
  stellarTxHash    String?
  sendAmount       Decimal
  sendCurrency     String
  receiveAmount    Decimal
  receiveCurrency  String
  exchangeRate     Decimal
  status           TxStatus    @default(PENDING)
  riskScore        Int         @default(0)
  flagged          Boolean     @default(false)
  callbackUrl      String?
  callbackStatus   String?
  createdAt        DateTime    @default(now())
}`}
          </pre>
        </div>
      )}

      {activeTab === 'checklist' && (
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Implementation Checklist Progress
          </h3>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
              <span className="text-emerald-400 font-bold">Phase 1: Authorization & Ownership Checks</span>
              <span className="text-emerald-400 flex items-center gap-1 font-bold"><Check className="w-4 h-4" /> Completed</span>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
              <span className="text-emerald-400 font-bold">Phase 2: Real-Time SSE Endpoint (/stream)</span>
              <span className="text-emerald-400 flex items-center gap-1 font-bold"><Check className="w-4 h-4" /> Completed</span>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
              <span className="text-emerald-400 font-bold">Phase 3: Processor Event Emission (BullMQ / Rust)</span>
              <span className="text-emerald-400 flex items-center gap-1 font-bold"><Check className="w-4 h-4" /> Completed</span>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
              <span className="text-emerald-400 font-bold">Phase 4: Webhook Callbacks for Merchants</span>
              <span className="text-emerald-400 flex items-center gap-1 font-bold"><Check className="w-4 h-4" /> Completed</span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
