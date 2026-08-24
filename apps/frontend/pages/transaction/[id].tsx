import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';

const TransactionDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const [transaction, setTransaction] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;

    const fetchTransaction = async () => {
      try {
        const response = await axios.get(`/api/transaction/${id}`);
        setTransaction(response.data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to fetch transaction');
      } finally {
        setLoading(false);
      }
    };

    fetchTransaction();
    const interval = setInterval(fetchTransaction, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-purple-500 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading transaction details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-black p-6 flex items-center justify-center">
        <div className="bg-red-500 bg-opacity-20 border border-red-400 border-opacity-30 rounded-lg p-6 max-w-md">
          <p className="text-red-200 text-center">{error}</p>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-500',
    COMPLETED: 'bg-green-500',
    FAILED: 'bg-red-500',
    REFUNDED: 'bg-blue-500',
  };

  const statusIcons: Record<string, string> = {
    PENDING: '⏳',
    COMPLETED: '✅',
    FAILED: '❌',
    REFUNDED: '↩️',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-black p-6">
      <div className="max-w-3xl mx-auto">
        {transaction && (
          <>
            {/* Header */}
            <button
              onClick={() => router.push('/dashboard')}
              className="text-purple-300 hover:text-white transition mb-6 flex items-center gap-2"
            >
              ← Back to Dashboard
            </button>

            {/* Transaction Card */}
            <div className="bg-white bg-opacity-10 backdrop-blur-lg rounded-3xl p-8 border border-white border-opacity-20">
              {/* Status */}
              <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-white">Transfer Details</h1>
                <div className={`px-4 py-2 rounded-full text-white font-semibold flex items-center gap-2 ${statusColors[transaction.status]} bg-opacity-20 border ${statusColors[transaction.status]} border-opacity-30`}>
                  {statusIcons[transaction.status]} {transaction.status}
                </div>
              </div>

              {/* Main Transaction Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="bg-white bg-opacity-5 rounded-lg p-6 border border-white border-opacity-10">
                  <p className="text-gray-400 text-sm mb-2">You're Sending</p>
                  <p className="text-3xl font-bold text-blue-400">${transaction.usdcAmount}</p>
                  <p className="text-gray-400 text-sm mt-2">USDC on Stellar</p>
                </div>

                <div className="bg-white bg-opacity-5 rounded-lg p-6 border border-white border-opacity-10">
                  <p className="text-gray-400 text-sm mb-2">Recipient Receives</p>
                  <p className="text-3xl font-bold text-green-400">{transaction.fiatAmount}</p>
                  <p className="text-gray-400 text-sm mt-2">{transaction.fiatCurrency}</p>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center pb-4 border-b border-white border-opacity-10">
                  <span className="text-gray-400">Escrow ID:</span>
                  <span className="text-white font-mono text-sm">{transaction.memo}</span>
                </div>

                <div className="flex justify-between items-center pb-4 border-b border-white border-opacity-10">
                  <span className="text-gray-400">Recipient Country:</span>
                  <span className="text-white">{transaction.destination}</span>
                </div>

                <div className="flex justify-between items-center pb-4 border-b border-white border-opacity-10">
                  <span className="text-gray-400">Exchange Rate:</span>
                  <span className="text-white">{transaction.exchangeRate} {transaction.fiatCurrency}/USD</span>
                </div>

                <div className="flex justify-between items-center pb-4 border-b border-white border-opacity-10">
                  <span className="text-gray-400">Fee (0.5%):</span>
                  <span className="text-white">${(parseFloat(transaction.usdcAmount) * 0.005).toFixed(2)}</span>
                </div>

                <div className="flex justify-between items-center pb-4 border-b border-white border-opacity-10">
                  <span className="text-gray-400">Created:</span>
                  <span className="text-white text-sm">{new Date(transaction.createdAt).toLocaleString()}</span>
                </div>

                {transaction.status === 'COMPLETED' && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Completed:</span>
                    <span className="text-green-400 text-sm">{new Date(transaction.updatedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Timeline */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-white mb-4">Transfer Timeline</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-4">
                    <div className="w-3 h-3 bg-green-500 rounded-full mt-2"></div>
                    <div>
                      <p className="text-white font-semibold">Funds Locked</p>
                      <p className="text-gray-400 text-sm">{new Date(transaction.createdAt).toLocaleTimeString()}</p>
                    </div>
                  </div>

                  {transaction.status === 'PENDING' && (
                    <>
                      <div className="flex items-start gap-4">
                        <div className="w-3 h-3 bg-yellow-500 rounded-full mt-2 animate-pulse"></div>
                        <div>
                          <p className="text-white font-semibold">Waiting for Oracle Confirmation</p>
                          <p className="text-gray-400 text-sm">Off-ramp agent is verifying delivery...</p>
                        </div>
                      </div>
                    </>
                  )}

                  {transaction.status === 'COMPLETED' && (
                    <>
                      <div className="flex items-start gap-4">
                        <div className="w-3 h-3 bg-green-500 rounded-full mt-2"></div>
                        <div>
                          <p className="text-white font-semibold">Delivered to Recipient</p>
                          <p className="text-gray-400 text-sm">Oracle confirmed fiat delivery</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="w-3 h-3 bg-green-500 rounded-full mt-2"></div>
                        <div>
                          <p className="text-white font-semibold">Funds Released to Agent</p>
                          <p className="text-gray-400 text-sm">{new Date(transaction.updatedAt).toLocaleTimeString()}</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Actions */}
              {transaction.status === 'PENDING' && (
                <div className="bg-blue-500 bg-opacity-10 border border-blue-400 border-opacity-30 rounded-lg p-4">
                  <p className="text-blue-200 text-sm mb-4">
                    ⏳ Transfer in progress. Off-ramp agent is processing your delivery.
                  </p>
                  <button className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg transition">
                    View Live Status
                  </button>
                </div>
              )}

              {transaction.status === 'COMPLETED' && (
                <div className="bg-green-500 bg-opacity-10 border border-green-400 border-opacity-30 rounded-lg p-4">
                  <p className="text-green-200 text-sm">
                    ✅ Transfer completed successfully! Recipient has received {transaction.fiatAmount} {transaction.fiatCurrency}.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TransactionDetailPage;
