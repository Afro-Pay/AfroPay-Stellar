import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  CheckCircle2, 
  Upload, 
  FileCheck, 
  Lock, 
  UserCheck, 
  AlertCircle,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { KYC_TIERS } from '../lib/constants';

export const KYCPanel: React.FC = () => {
  const [bvn, setBvn] = useState('22198471920');
  const [nin, setNin] = useState('1092847192');
  const [verifyingNIN, setVerifyingNIN] = useState(false);
  const [ninSuccess, setNinSuccess] = useState(true);
  
  const [documentUploaded, setDocumentUploaded] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const handleVerifyNIN = () => {
    setVerifyingNIN(true);
    setTimeout(() => {
      setVerifyingNIN(false);
      setNinSuccess(true);
    }, 1200);
  };

  const handleUploadDoc = () => {
    setUploadingDoc(true);
    setTimeout(() => {
      setUploadingDoc(false);
      setDocumentUploaded(true);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner */}
      <div className="glass-panel rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/50 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-display text-white">KYC & Compliance Verification</h2>
              <p className="text-xs text-slate-400">Tiered verification engine powered by African identity registries (BVN / NIN)</p>
            </div>
          </div>

          <span className="text-xs font-bold text-emerald-400 bg-emerald-950 px-3 py-1.5 rounded-full border border-emerald-800 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            Tier 1 Verified
          </span>
        </div>
      </div>

      {/* KYC Tiers Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {KYC_TIERS.map((tier) => (
          <div 
            key={tier.tier}
            className={`glass-panel rounded-2xl p-6 space-y-4 flex flex-col justify-between relative border ${
              tier.status === 'verified' ? 'border-emerald-500/60' : 'border-slate-800'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{tier.title}</span>
                {tier.status === 'verified' && (
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                    ACTIVE
                  </span>
                )}
              </div>

              <div className="space-y-1 mb-4">
                <span className="text-2xl font-extrabold font-display text-white">
                  ${tier.dailyLimitUSD.toLocaleString()} <span className="text-xs font-normal text-slate-400">/ day</span>
                </span>
                <p className="text-xs text-slate-400">
                  Monthly Limit: ${tier.monthlyLimitUSD.toLocaleString()} USD
                </p>
              </div>

              <div className="space-y-2 pt-3 border-t border-slate-800 text-xs">
                <span className="text-slate-400 font-semibold block">Requirements:</span>
                <ul className="space-y-1.5">
                  {tier.requirements.map((req, i) => (
                    <li key={i} className="flex items-center gap-2 text-slate-300">
                      <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${tier.status === 'verified' ? 'text-emerald-400' : 'text-slate-600'}`} />
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="pt-4">
              {tier.tier === 1 ? (
                <button disabled className="w-full py-2 bg-emerald-950 text-emerald-400 font-bold text-xs rounded-xl border border-emerald-800">
                  Tier 1 Complete
                </button>
              ) : tier.tier === 2 ? (
                <button 
                  onClick={handleUploadDoc}
                  disabled={documentUploaded}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition-all"
                >
                  {documentUploaded ? 'Tier 2 Under Review' : 'Upgrade to Tier 2'}
                </button>
              ) : (
                <button disabled className="w-full py-2 bg-slate-900 text-slate-600 font-bold text-xs rounded-xl border border-slate-800">
                  Institutional Verification
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Identity Verification Form & AI Risk Scanner */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Nigerian BVN / NIN Check */}
        <div className="glass-panel rounded-2xl p-6 space-y-4">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-emerald-400" />
            <span>NIN / BVN Verification Engine</span>
          </h3>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">Bank Verification Number (BVN)</label>
              <input
                type="text"
                value={bvn}
                onChange={(e) => setBvn(e.target.value)}
                className="w-full rounded-xl bg-slate-900 border border-slate-700 p-2.5 font-mono text-white focus:outline-none"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">National Identity Number (NIN)</label>
              <input
                type="text"
                value={nin}
                onChange={(e) => setNin(e.target.value)}
                className="w-full rounded-xl bg-slate-900 border border-slate-700 p-2.5 font-mono text-white focus:outline-none"
              />
            </div>

            <button
              onClick={handleVerifyNIN}
              disabled={verifyingNIN}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold text-xs rounded-xl border border-slate-700 transition-all flex items-center justify-center gap-2"
            >
              {verifyingNIN ? <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" /> : 'Re-verify Identity with NIMC API'}
            </button>

            {ninSuccess && (
              <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>NIMC Identity Match Confirmed: <strong>Oluwaseun Adewale</strong></span>
              </div>
            )}
          </div>
        </div>

        {/* Python Analytics Risk Engine */}
        <div className="glass-panel rounded-2xl p-6 space-y-4">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <span>Fraud Analytics & Risk Service</span>
          </h3>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Account Safety Score:</span>
              <span className="font-extrabold text-emerald-400 text-lg">94 / 100</span>
            </div>

            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-400 h-full w-[94%]"></div>
            </div>

            <div className="space-y-1.5 text-slate-300 pt-2 border-t border-slate-800">
              <div className="flex justify-between">
                <span>IP Location Match:</span>
                <span className="text-emerald-400 font-medium">Lagos, Nigeria (Verified)</span>
              </div>
              <div className="flex justify-between">
                <span>Velocity Check:</span>
                <span className="text-emerald-400 font-medium">3 transfers / 24h (Normal)</span>
              </div>
              <div className="flex justify-between">
                <span>AML Sanctions List:</span>
                <span className="text-emerald-400 font-medium">Passed (OFAC/PEP Clear)</span>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
