import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface SendFormProps {
  exchangeRates: Record<string, number>;
}

const SendForm: React.FC<SendFormProps> = ({ exchangeRates }) => {
  const [formData, setFormData] = useState({
    recipientCountry: 'NG',
    fiatAmount: '',
    fiatCurrency: 'NGN',
  });

  const [usdcAmount, setUsdcAmount] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const currencyMap: Record<string, string> = {
    NG: 'NGN',
    GH: 'GHS',
    KE: 'KES',
  };

  // Calculate USDC amount
  useEffect(() => {
    const country = formData.recipientCountry;
    const rate = exchangeRates[currencyMap[country]] || 1;
    const amount = parseFloat(formData.fiatAmount) || 0;
    const calculated = (amount / rate).toFixed(2);
    setUsdcAmount(calculated);
  }, [formData.fiatAmount, formData.recipientCountry, exchangeRates]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      fiatCurrency: currencyMap[value] || prev.fiatCurrency,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await axios.post('/api/transaction/initiate', {
        recipientCountry: formData.recipientCountry,
        fiatAmount: parseFloat(formData.fiatAmount),
        fiatCurrency: formData.fiatCurrency,
      });

      setSuccess(`Transfer initiated! Escrow ID: ${response.data.escrowId}`);
      setFormData({ recipientCountry: 'NG', fiatAmount: '', fiatCurrency: 'NGN' });

      // Redirect to transaction tracking
      setTimeout(() => {
        window.location.href = `/transaction/${response.data.transactionId}`;
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Transfer initiation failed');
    } finally {
      setLoading(false);
    }
  };

  const countryNames: Record<string, string> = {
    NG: 'Nigeria',
    GH: 'Ghana',
    KE: 'Kenya',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Recipient Country */}
      <div>
        <label className="block text-white text-sm font-semibold mb-3">
          Sending to:
        </label>
        <select
          name="recipientCountry"
          value={formData.recipientCountry}
          onChange={handleChange}
          className="w-full px-4 py-3 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          {Object.entries(countryNames).map(([code, name]) => (
            <option key={code} value={code} className="bg-gray-900 text-white">
              {name} ({code})
            </option>
          ))}
        </select>
      </div>

      {/* Fiat Amount */}
      <div>
        <label className="block text-white text-sm font-semibold mb-3">
          Amount ({formData.fiatCurrency}):
        </label>
        <input
          type="number"
          name="fiatAmount"
          value={formData.fiatAmount}
          onChange={handleChange}
          placeholder="Enter amount"
          min="10"
          max="50000"
          step="0.01"
          className="w-full px-4 py-3 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
          required
        />
      </div>

      {/* Conversion Display */}
      {formData.fiatAmount && (
        <div className="bg-white bg-opacity-5 border border-white border-opacity-20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <span className="text-gray-300">You send:</span>
            <span className="text-xl font-bold text-white">${usdcAmount} USDC</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-300">Recipient receives:</span>
            <span className="text-xl font-bold text-green-400">
              {formData.fiatAmount} {formData.fiatCurrency}
            </span>
          </div>
        </div>
      )}

      {/* Fee Info */}
      <div className="bg-blue-500 bg-opacity-20 border border-blue-400 border-opacity-30 rounded-lg p-4">
        <p className="text-blue-200 text-sm">
          💰 <strong>Fee:</strong> Only 0.5% (vs 5-10% with traditional services)
        </p>
        <p className="text-blue-200 text-sm mt-2">
          ⚡ <strong>Speed:</strong> 5-10 minutes (vs 1-5 days)
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-500 bg-opacity-20 border border-red-400 border-opacity-30 rounded-lg p-4">
          <p className="text-red-200 text-sm">❌ {error}</p>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="bg-green-500 bg-opacity-20 border border-green-400 border-opacity-30 rounded-lg p-4">
          <p className="text-green-200 text-sm">✅ {success}</p>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading || !formData.fiatAmount}
        className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition transform hover:scale-105"
      >
        {loading ? 'Processing...' : 'Send Money'}
      </button>

      {/* Disclaimer */}
      <p className="text-xs text-gray-400 text-center">
        By clicking Send, you agree to our Terms of Service and have verified the recipient details.
      </p>
    </form>
  );
};

export default SendForm;
