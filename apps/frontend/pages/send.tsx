import React, { useState, useEffect } from 'react';
import { useWalletStore } from '../store/walletStore';
import SendForm from '../components/SendForm';

const SendPage: React.FC = () => {
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch current exchange rates
    const fetchRates = async () => {
      try {
        const response = await fetch('/api/rates');
        const data = await response.json();
        setExchangeRates(data);
      } catch (error) {
        console.error('Failed to fetch rates:', error);
      }
    };

    fetchRates();
    const interval = setInterval(fetchRates, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-black p-6">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white bg-opacity-10 backdrop-blur-lg rounded-3xl p-8 border border-white border-opacity-20">
          <h1 className="text-4xl font-bold text-white mb-2">Send Money Worldwide</h1>
          <p className="text-gray-300 mb-8">
            Fast, borderless, and secure remittances powered by Stellar
          </p>

          <SendForm exchangeRates={exchangeRates} />

          {/* Exchange Rate Display */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(exchangeRates).map(([currency, rate]) => (
              <div
                key={currency}
                className="bg-white bg-opacity-5 rounded-lg p-4 border border-white border-opacity-10"
              >
                <p className="text-gray-300 text-sm">USD → {currency}</p>
                <p className="text-2xl font-bold text-white">{rate.toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SendPage;
