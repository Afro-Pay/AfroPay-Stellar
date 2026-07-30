import React, { useState } from 'react';
import { KYCTierInfo } from '../types';
import { ShieldCheck, Upload, FileText, CheckCircle2, AlertTriangle, Cpu, Lock, Check } from 'lucide-react';

interface ComplianceCenterProps {
  kycTier: KYCTierInfo;
  onUpgradeTier: () => void;
}

export const ComplianceCenter: React.FC<ComplianceCenterProps> = ({ kycTier, onUpgradeTier }) => {
  const [bvnNumber, setBvnNumber] = useState('22198048201');
  const [docType, setDocType] = useState('National Identity Number (NIN)');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);

  // Risk calculator tool state
  const [testAmount, setTestAmount] = useState('8500');
  const [testCountry, setTestCountry] = useState('Nigeria (NGN)');
  const [testRecipientAgeDays, setTestRecipientAgeDays] = useState('45');
  const [calculatedRisk, setCalculatedRisk] = useState<{ score: number; flagged: boolean; reason: string } | null>(null);

  const handleDocumentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setVerificationSuccess(false);

    setTimeout(() => {
      setIsVerifying(false);
      setVerificationSuccess(true);
      onUpgradeTier();
    }, 1200);
  };

  const calculateRiskScore = () => {
    const amt = parseFloat(testAmount) || 0;
    const age = parseInt(testRecipientAgeDays) || 0;

    let score = 5;
    if (amt > 5000) score += 25;
    if (amt > 20000) score += 40;
    if (age < 7) score += 30;

    const flagged = score >= 50;
    let reason = 'Low risk transaction pattern. Verified sender & recipient history.';
    if (flagged) {
      reason = 'FLAGGED: High-value transaction to newly created account (< 7 days old). Requires compliance manager manual review.';
    } else if (score > 25) {
      reason = 'MODERATE: Elevated transaction value. Secondary automated check passed.';
    }

    setCalculatedRisk({ score, flagged, reason });
  };

  return (
    <div className="space-y-6">
      
      {/* Tier Summary Banner */}
      <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4" /> KYC & AML Verification Status
          </div>
          <h2 className="text-2xl font-bold font-display text-white">
            Current Status: <span className="text-emerald-400">{kycTier.tier}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Limits: <strong className="text-white">${kycTier.dailyLimitUsd.toLocaleString()} / Day</strong> • <strong className="text-white">${kycTier.monthlyLimitUsd.toLocaleString()} / Month</strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs text-right font-mono">
            <span className="text-slate-400 block">AML Risk Index:</span>
            <span className="text-emerald-400 font-bold">12 / 100 (Clean)</span>
          </div>
          <span className="px-3 py-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-bold rounded-xl flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> {kycTier.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Document & BVN Upload Center */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-400" /> Identity Verification (Tier 3 Upgrade)
            </h3>
            <span className="text-xs text-slate-400">NIBSS & NIMC Live Connect</span>
          </div>

          <form onSubmit={handleDocumentSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Bank Verification Number (BVN)
              </label>
              <input
                type="text"
                value={bvnNumber}
                onChange={(e) => setBvnNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-emerald-400 font-mono text-xs rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
                placeholder="22..."
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Government Document Type
              </label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white text-xs rounded-xl p-3 focus:border-emerald-500 focus:outline-none"
              >
                <option value="National Identity Number (NIN)">National Identity Number (NIN)</option>
                <option value="International Passport">International Passport</option>
                <option value="Drivers License">Driver's License</option>
                <option value="Voters Card">Voter's Card</option>
              </select>
            </div>

            <div className="border-2 border-dashed border-slate-800 hover:border-slate-700 bg-slate-950/60 p-6 rounded-xl text-center space-y-2 cursor-pointer transition">
              <FileText className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-300 font-medium">Click to upload document photo or PDF</p>
              <span className="text-[10px] text-slate-500 block">Accepted formats: JPG, PNG, PDF (Max 10MB)</span>
            </div>

            {verificationSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs rounded-xl flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Verification successful! Upgraded to Tier 3 ($500,000/mo limit).</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifying}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition cursor-pointer"
            >
              {isVerifying ? 'Verifying with NIMC/NIBSS API...' : 'Submit Documents for Tier 3 Upgrade'}
            </button>
          </form>

          {/* Checklist Requirements */}
          <div className="pt-2 text-xs space-y-2">
            <h4 className="font-bold text-slate-300">Tier Requirements Checklist:</h4>
            <div className="space-y-1.5">
              {kycTier.requirementsMet.map((req) => (
                <div key={req} className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{req}</span>
                </div>
              ))}
              {kycTier.pendingRequirements.map((req) => (
                <div key={req} className="flex items-center gap-2 text-slate-500">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>{req}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Python Analytics Fraud Risk Scoring Calculator */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" /> Python Analytics Risk Engine
            </h3>
            <span className="text-xs text-amber-400 font-mono">services/python-analytics</span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Simulate the fraud analytics microservice scoring algorithm used by AfroPay-Stellar before transactions are submitted to Stellar.
          </p>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Transfer Amount ($ USD)</label>
              <input
                type="number"
                value={testAmount}
                onChange={(e) => setTestAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl p-3 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Destination Corridor</label>
                <select
                  value={testCountry}
                  onChange={(e) => setTestCountry(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl p-3 focus:outline-none"
                >
                  <option value="Nigeria (NGN)">Nigeria (NGN)</option>
                  <option value="Kenya (KES)">Kenya (KES)</option>
                  <option value="Ghana (GHS)">Ghana (GHS)</option>
                  <option value="Europe (EUR)">Europe (EUR)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Recipient Account Age (Days)</label>
                <input
                  type="number"
                  value={testRecipientAgeDays}
                  onChange={(e) => setTestRecipientAgeDays(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl p-3 focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={calculateRiskScore}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl border border-slate-700 transition cursor-pointer"
            >
              Run Python Risk Score Analytics
            </button>

            {calculatedRisk && (
              <div
                className={`p-4 rounded-xl border text-xs space-y-2 ${
                  calculatedRisk.flagged
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    : calculatedRisk.score > 25
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                }`}
              >
                <div className="flex items-center justify-between font-bold">
                  <span>Risk Score Result: {calculatedRisk.score} / 100</span>
                  <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono">
                    {calculatedRisk.flagged ? 'FLAGGED' : 'PASSED'}
                  </span>
                </div>
                <p className="leading-relaxed">{calculatedRisk.reason}</p>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
