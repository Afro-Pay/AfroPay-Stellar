import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import BalanceCard from '../components/BalanceCard';
import TransactionDashboard from '../components/TransactionDashboard';
import { useWalletStore } from '../store/walletStore';

const DashboardPage: React.FC = () => {
  const router = useRouter();
  const { publicKey } = useWalletStore();
  const [balances, setBalances] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicKey) {
      router.push('/login');
      return;
    }

    const fetchBalances = async () => {
      try {
        const response = await fetch('/api/wallet/balances');
        if (!response.ok) throw new Error('Failed to fetch balances');
        const data = await response.json();
        setBalances(data);
      } catch (error) {
        console.error('Failed to fetch balances:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [publicKey, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-purple-500 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-black p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl font-bold text-white mb-2">Welcome to AfroPay</h1>
          <p className="text-gray-300 text-lg">Your global remittance dashboard</p>
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {balances && (
            <>
              <BalanceCard
                asset="USDC"
                balance={balances.usdc || '0'}
                icon="💵"
              />
              <BalanceCard
                asset="XLM"
                balance={balances.xlm || '0'}
                icon="⭐"
              />
              <BalanceCard
                asset="Total Value"
                balance={balances.totalValue || '$0'}
                icon="💎"
              />
            </>
          )}
        </div>

        {/* Transaction Dashboard */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <TransactionDashboard />
          </div>

          {/* Quick Actions */}
          <div className="space-y-4">
            <div className="bg-white bg-opacity-10 backdrop-blur-lg rounded-3xl p-6 border border-white border-opacity-20">
              <h3 className="text-xl font-bold text-white mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <button
                  onClick={() => router.push('/send')}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition transform hover:scale-105"
                >
                  Send Money
                </button>
                <button className="w-full bg-white bg-opacity-5 hover:bg-opacity-10 text-white font-semibold py-3 px-6 rounded-lg border border-white border-opacity-20 transition">
                  Request Money
                </button>
                <button className="w-full bg-white bg-opacity-5 hover:bg-opacity-10 text-white font-semibold py-3 px-6 rounded-lg border border-white border-opacity-20 transition">
                  View History
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="bg-white bg-opacity-10 backdrop-blur-lg rounded-3xl p-6 border border-white border-opacity-20">
              <h3 className="text-xl font-bold text-white mb-4">Stats</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-gray-300">
                  <span>Total Sent</span>
                  <span className="text-white font-semibold">$5,234</span>
                </div>
                <div className="flex justify-between text-gray-300">
                  <span>Fees Saved</span>
                  <span className="text-white font-semibold">$312</span>
                </div>
                <div className="flex justify-between text-gray-300">
                  <span>Transfer Speed</span>
                  <span className="text-white font-semibold">5 sec avg</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
