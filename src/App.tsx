import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { FXTicker } from './components/FXTicker';
import { WalletSummary } from './components/WalletSummary';
import { SendRemittance } from './components/SendRemittance';
import { AnchorRails } from './components/AnchorRails';
import { TransactionLedger } from './components/TransactionLedger';
import { KYCPanel } from './components/KYCPanel';
import { StellarQRModal } from './components/StellarQRModal';
import { LiquidityHealthPanel } from './components/LiquidityHealthPanel';
import { StorageService } from './lib/storage';
import { WalletState, TransactionRecord } from './types';
import { ShieldCheck, Zap, Globe, Github } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'send' | 'anchor' | 'history' | 'kyc' | 'liquidity'>('dashboard');
  const [wallet, setWallet] = useState<WalletState>(StorageService.getWallet());
  const [transactions, setTransactions] = useState<TransactionRecord[]>(StorageService.getTransactions());
  const [qrModalOpen, setQrModalOpen] = useState(false);

  const refreshWallet = () => {
    setWallet(StorageService.getWallet());
    setTransactions(StorageService.getTransactions());
  };

  useEffect(() => {
    refreshWallet();
  }, []);

  const handleTransactionSuccess = (tx: TransactionRecord) => {
    refreshWallet();
    setActiveTab('history');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      
      {/* Top Header */}
      <div>
        <Navbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          wallet={wallet}
          onOpenQR={() => setQrModalOpen(true)}
        />
        
        {/* Real-time FX Ticker Marquee */}
        <FXTicker />

        {/* Main Content Area */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
          {activeTab === 'dashboard' && (
            <WalletSummary
              wallet={wallet}
              onRefreshWallet={refreshWallet}
              onNavigateToSend={() => setActiveTab('send')}
              onNavigateToAnchor={() => setActiveTab('anchor')}
              onNavigateToHistory={() => setActiveTab('history')}
              transactions={transactions}
            />
          )}

          {activeTab === 'send' && (
            <SendRemittance
              onSuccess={handleTransactionSuccess}
              onCancel={() => setActiveTab('dashboard')}
            />
          )}

          {activeTab === 'anchor' && (
            <AnchorRails
              wallet={wallet}
              onRefreshWallet={refreshWallet}
              onSuccessTransaction={handleTransactionSuccess}
            />
          )}

          {activeTab === 'history' && (
            <TransactionLedger
              transactions={transactions}
            />
          )}

          {activeTab === 'kyc' && (
            <KYCPanel />
          )}

          {activeTab === 'liquidity' && (
            <LiquidityHealthPanel />
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-8 px-4 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
              ⚡
            </div>
            <span className="font-semibold text-slate-300">AfroPay-Stellar</span>
            <span>— Cross-Border African Remittance Engine</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              Stellar Testnet Consensus
            </span>
            <span>•</span>
            <span>SEP-24 & SEP-31 Rails</span>
          </div>
        </div>
      </footer>

      {/* QR Modal */}
      {qrModalOpen && (
        <StellarQRModal
          publicKey={wallet.publicKey}
          onClose={() => setQrModalOpen(false)}
        />
      )}

    </div>
  );
}

export default App;
