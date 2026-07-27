import React, { useState } from 'react';
import { UserWallet, TransactionRecord, SSELogEvent, KYCTierInfo, Currency } from './types';
import { INITIAL_USER_WALLET, INITIAL_TRANSACTIONS, INITIAL_KYC_TIER } from './data/mockData';
import { Header } from './components/Header';
import { Navigation, NavTab } from './components/Navigation';
import { WalletDashboard } from './components/WalletDashboard';
import { RemittanceForm } from './components/RemittanceForm';
import { AnchorRails } from './components/AnchorRails';
import { ComplianceCenter } from './components/ComplianceCenter';
import { RealTimeTracker } from './components/RealTimeTracker';
import { ApiArchitectureViewer } from './components/ApiArchitectureViewer';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [wallet, setWallet] = useState<UserWallet>(INITIAL_USER_WALLET);
  const [transactions, setTransactions] = useState<TransactionRecord[]>(INITIAL_TRANSACTIONS);
  const [kycTier, setKycTier] = useState<KYCTierInfo>(INITIAL_KYC_TIER);
  const [sseLogs, setSseLogs] = useState<SSELogEvent[]>([
    {
      id: 'log_0',
      timestamp: new Date().toLocaleTimeString(),
      txId: 'tx_afro_98124',
      step: 'NestJS REST API',
      status: 'SUCCESS',
      message: 'Transaction tx_afro_98124 processed and confirmed on Horizon.',
      stellarHash: '4a1b8e92f7c3d1056e8902a4b31e21908472f102e3b1c2098e7f6d5a4b3c2d1e',
    },
  ]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Sync wallet state with Stellar testnet
  const handleRefreshWallet = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 800);
  };

  // Toggle trustline
  const handleToggleTrustline = (currency: Currency) => {
    setWallet((prev) => ({
      ...prev,
      balances: prev.balances.map((b) => {
        if (b.currency === currency) {
          return { ...b, trustlineEstablished: !b.trustlineEstablished };
        }
        return b;
      }),
    }));
  };

  // Handle new remittance submission
  const handleSendTransfer = (transferData: Partial<TransactionRecord>) => {
    const newId = `tx_afro_${Math.floor(10000 + Math.random() * 90000)}`;
    const nowIso = new Date().toISOString();

    const newTx: TransactionRecord = {
      id: newId,
      txHash: undefined,
      type: 'TRANSFER',
      senderPublicKey: wallet.publicKey,
      recipientPublicKey: transferData.recipientPublicKey || 'GDFP5T4...',
      recipientName: transferData.recipientName || 'Recipient',
      sendAmount: transferData.sendAmount || 100,
      sendCurrency: transferData.sendCurrency || 'USDC',
      receiveAmount: transferData.receiveAmount || 150000,
      receiveCurrency: transferData.receiveCurrency || 'NGN',
      exchangeRate: transferData.exchangeRate || 1500,
      feeUsd: 0.15,
      stellarFeeXlm: 0.00001,
      status: 'PENDING',
      createdAt: nowIso,
      memo: transferData.memo || 'AfroPay Remittance',
      riskScore: transferData.riskScore || 8,
      flagged: false,
      pathUsed: transferData.pathUsed || [transferData.sendCurrency || 'USDC', 'XLM', transferData.receiveCurrency || 'NGN'],
      callbackUrl: transferData.callbackUrl,
      callbackStatus: transferData.callbackUrl ? 'PENDING' : undefined,
    };

    setTransactions((prev) => [newTx, ...prev]);

    // Add initial log
    addSseLog(newId, 'NestJS REST API', 'PENDING', `Transfer request received. Ownership check passed for user.`);

    // Automatically navigate to tracker and trigger worker sequence
    setActiveTab('tracker');
    simulateWorkerExecution(newId, newTx);
  };

  // Helper to add SSE log
  const addSseLog = (txId: string, step: string, status: any, message: string, stellarHash?: string) => {
    setSseLogs((prev) => [
      {
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: new Date().toLocaleTimeString(),
        txId,
        step,
        status,
        message,
        stellarHash,
      },
      ...prev,
    ]);
  };

  // Worker pipeline simulation
  const simulateWorkerExecution = (txId: string, txData: TransactionRecord) => {
    // Step 1: BullMQ Queue
    setTimeout(() => {
      addSseLog(txId, 'BullMQ Redis Queue', 'QUEUED', `Job enqueued in queue "transactions". Retry attempt 0/3.`);
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, status: 'QUEUED' } : t)));
    }, 1200);

    // Step 2: Rust Settlement Worker
    setTimeout(() => {
      addSseLog(txId, 'Rust Settlement Worker', 'RETRYING', `Rust worker consumed job. Preparing path payment operation: ${txData.sendCurrency} → XLM → ${txData.receiveCurrency}`);
      setTransactions((prev) => prev.map((t) => (t.id === txId ? { ...t, status: 'RETRYING' } : t)));
    }, 2500);

    // Step 3: Horizon Ledger Confirmed
    setTimeout(() => {
      const mockHash = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      addSseLog(txId, 'Stellar Horizon Ledger', 'SUCCESS', `Path payment transaction submitted and confirmed in ledger #4819203.`, mockHash);

      setTransactions((prev) =>
        prev.map((t) =>
          t.id === txId
            ? {
                ...t,
                status: 'SUCCESS',
                txHash: mockHash,
                callbackStatus: t.callbackUrl ? 'DELIVERED' : undefined,
              }
            : t
        )
      );

      // Deduct balance from wallet
      setWallet((prev) => ({
        ...prev,
        balances: prev.balances.map((b) => {
          if (b.currency === txData.sendCurrency) {
            const newAmount = Math.max(0, b.amount - txData.sendAmount);
            return {
              ...b,
              amount: newAmount,
              usdEquivalent: newAmount * (b.currency === 'XLM' ? 0.11 : b.currency === 'NGN' ? 0.000667 : 1),
            };
          }
          return b;
        }),
      }));
    }, 4000);
  };

  // Anchor deposit handler
  const handleAnchorDeposit = (amount: number, asset: 'NGN' | 'USDC') => {
    const newTxId = `tx_dep_${Math.floor(10000 + Math.random() * 90000)}`;
    const mockHash = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    const newDep: TransactionRecord = {
      id: newTxId,
      txHash: mockHash,
      type: 'DEPOSIT',
      senderPublicKey: 'ANCHOR_BANK_SYSTEM',
      recipientPublicKey: wallet.publicKey,
      recipientName: `SEP-24 Deposit (${asset})`,
      sendAmount: amount,
      sendCurrency: asset,
      receiveAmount: amount,
      receiveCurrency: asset,
      exchangeRate: 1,
      feeUsd: 0.5,
      stellarFeeXlm: 0.00001,
      status: 'SUCCESS',
      createdAt: new Date().toISOString(),
      memo: 'SEP-24 Fiat Deposit',
      riskScore: 5,
      flagged: false,
    };

    setTransactions((prev) => [newDep, ...prev]);

    // Update wallet balance
    setWallet((prev) => ({
      ...prev,
      balances: prev.balances.map((b) => {
        if (b.currency === asset) {
          const newAmt = b.amount + amount;
          return {
            ...b,
            amount: newAmt,
            usdEquivalent: newAmt * (asset === 'USDC' ? 1 : 0.000667),
          };
        }
        return b;
      }),
    }));
  };

  // Anchor withdrawal handler
  const handleAnchorWithdrawal = (amount: number, asset: 'NGN' | 'USDC') => {
    const newTxId = `tx_wth_${Math.floor(10000 + Math.random() * 90000)}`;
    const mockHash = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    const newWth: TransactionRecord = {
      id: newTxId,
      txHash: mockHash,
      type: 'WITHDRAWAL',
      senderPublicKey: wallet.publicKey,
      recipientPublicKey: 'ANCHOR_BANK_SYSTEM',
      recipientName: `SEP-24 Bank Payout (${asset})`,
      sendAmount: amount,
      sendCurrency: asset,
      receiveAmount: amount,
      receiveCurrency: asset,
      exchangeRate: 1,
      feeUsd: 0.5,
      stellarFeeXlm: 0.00001,
      status: 'SUCCESS',
      createdAt: new Date().toISOString(),
      memo: 'SEP-24 Bank Payout',
      riskScore: 8,
      flagged: false,
    };

    setTransactions((prev) => [newWth, ...prev]);

    // Deduct wallet balance
    setWallet((prev) => ({
      ...prev,
      balances: prev.balances.map((b) => {
        if (b.currency === asset) {
          const newAmt = Math.max(0, b.amount - amount);
          return {
            ...b,
            amount: newAmt,
            usdEquivalent: newAmt * (asset === 'USDC' ? 1 : 0.000667),
          };
        }
        return b;
      }),
    }));
  };

  const usdBat = wallet.balances.find((b) => b.currency === 'USDC')?.amount || 0;
  const ngnBat = wallet.balances.find((b) => b.currency === 'NGN')?.amount || 0;
  const xlmBat = wallet.balances.find((b) => b.currency === 'XLM')?.amount || 0;

  const pendingTxCount = transactions.filter((t) => t.status === 'PENDING' || t.status === 'QUEUED' || t.status === 'RETRYING').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      
      {/* Header */}
      <Header
        wallet={wallet}
        onRefreshWallet={handleRefreshWallet}
        isRefreshing={isRefreshing}
      />

      {/* Navigation */}
      <Navigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        pendingTxCount={pendingTxCount}
      />

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {activeTab === 'dashboard' && (
          <WalletDashboard
            wallet={wallet}
            transactions={transactions}
            onNavigateRemittance={() => setActiveTab('remittance')}
            onNavigateAnchors={() => setActiveTab('anchors')}
            onToggleTrustline={handleToggleTrustline}
          />
        )}

        {activeTab === 'remittance' && (
          <RemittanceForm
            onSendTransfer={handleSendTransfer}
            userUsdBalance={usdBat}
            userNgnBalance={ngnBat}
            userXlmBalance={xlmBat}
          />
        )}

        {activeTab === 'anchors' && (
          <AnchorRails
            onSimulateDeposit={handleAnchorDeposit}
            onSimulateWithdrawal={handleAnchorWithdrawal}
          />
        )}

        {activeTab === 'compliance' && (
          <ComplianceCenter
            kycTier={kycTier}
            onUpgradeTier={() =>
              setKycTier({
                tier: 'Tier 3',
                dailyLimitUsd: 50000,
                monthlyLimitUsd: 500000,
                status: 'VERIFIED',
                requirementsMet: [
                  'Email & Phone Verified',
                  'BVN Verified',
                  'Government ID Uploaded',
                  'Selfie Liveness Verified',
                  'Utility Bill / Proof of Address Verified',
                ],
                pendingRequirements: ['Corporate Tax ID (For Enterprise B2B Rails)'],
              })
            }
          />
        )}

        {activeTab === 'tracker' && (
          <RealTimeTracker
            logs={sseLogs}
            transactions={transactions}
            onTriggerStreamSimulation={(txId) => {
              const tx = transactions.find((t) => t.id === txId) || transactions[0];
              simulateWorkerExecution(txId, tx);
            }}
          />
        )}

        {activeTab === 'specs' && <ApiArchitectureViewer />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="font-bold text-slate-300">AfroPay-Stellar</span>
            <span>— Stellar Cross-Border Remittance Protocol</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400">
            <span>Stellar Horizon Testnet</span>
            <span>•</span>
            <span>SEP-24 / SEP-38 Compliant</span>
            <span>•</span>
            <span>NestJS + Rust + Python Stack</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

export default App;
