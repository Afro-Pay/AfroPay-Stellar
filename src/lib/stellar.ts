import { CurrencyCode, TransferQuote } from '../types';

// Utility for generating authentic-looking Stellar keypairs (G... for Public Key, S... for Secret Key)
export function generateStellarKeypair(): { publicKey: string; secretKey: string } {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let pub = 'G';
  let sec = 'S';
  
  for (let i = 0; i < 55; i++) {
    pub += chars.charAt(Math.floor(Math.random() * chars.length));
    sec += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return { publicKey: pub, secretKey: sec };
}

export function generateTxHash(): string {
  const hexChars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += hexChars.charAt(Math.floor(Math.random() * hexChars.length));
  }
  return hash;
}

// Current FX Rates to USD
export const BASE_RATES_TO_USD: Record<CurrencyCode, number> = {
  USDC: 1.00,
  XLM: 0.115,    // 1 XLM = $0.115
  NGN: 0.000657, // 1 NGN = ~$0.000657 USD (1 USD = ~1520.50 NGN)
  EUR: 1.087,    // 1 EUR = $1.087
};

export function getFXRate(from: CurrencyCode, to: CurrencyCode): number {
  if (from === to) return 1.0;
  const fromUsd = BASE_RATES_TO_USD[from];
  const toUsd = BASE_RATES_TO_USD[to];
  
  // Convert from -> USD -> to
  return (fromUsd / toUsd);
}

export function calculateQuote(fromCurrency: CurrencyCode, fromAmount: number, toCurrency: CurrencyCode, country: string): TransferQuote {
  const rate = getFXRate(fromCurrency, toCurrency);
  const rawDestAmount = fromAmount * rate;
  
  // Calculate Stellar base network fee (0.00001 XLM) + anchor fee (0.1% or minimum $0.10)
  const stellarFeeXLM = 0.00001;
  const anchorFeeUSD = Math.max(0.10, (fromAmount * BASE_RATES_TO_USD[fromCurrency]) * 0.001);
  const totalFeeUSD = anchorFeeUSD + (stellarFeeXLM * BASE_RATES_TO_USD.XLM);
  
  // Deduct fee from estimated payout
  const feeInDestCurrency = totalFeeUSD / BASE_RATES_TO_USD[toCurrency];
  const estimatedToAmount = Math.max(0, rawDestAmount - feeInDestCurrency);

  // Dynamic path payments logic based on currencies
  const pathRoute: string[] = [];
  if (fromCurrency === 'NGN') pathRoute.push('Cowrie NGN Anchor');
  pathRoute.push(`${fromCurrency} Asset Trustline`);
  
  if (fromCurrency !== 'USDC' && toCurrency !== 'USDC') {
    pathRoute.push('Stellar DEX (DEX Order Book)');
  }
  
  pathRoute.push(`${toCurrency} Asset Trustline`);
  if (toCurrency === 'NGN') pathRoute.push('Local Nigerian Bank Rail (NIBSS / NGN Anchor)');
  else if (toCurrency === 'EUR') pathRoute.push('SEPA Instant Anchor Rail');

  return {
    fromCurrency,
    fromAmount,
    toCurrency,
    estimatedToAmount: Number(estimatedToAmount.toFixed(toCurrency === 'NGN' ? 2 : 4)),
    fxRate: Number(rate.toFixed(fromCurrency === 'NGN' || toCurrency === 'NGN' ? 4 : 6)),
    inverseFxRate: Number((1 / rate).toFixed(4)),
    pathRoute,
    stellarFeeXLM,
    anchorFeeUSD: Number(anchorFeeUSD.toFixed(3)),
    totalFeeUSD: Number(totalFeeUSD.toFixed(3)),
    estimatedDurationSeconds: 3.2,
    expiresAt: Date.now() + 60000, // 60 seconds quote validity
    corridor: `${fromCurrency} ➔ ${toCurrency} (${country})`,
  };
}

export function calculateRiskScore(amountUSD: number, country: string): { score: number; level: 'LOW' | 'MEDIUM' | 'HIGH' } {
  let score = Math.floor(Math.random() * 10) + 5; // Base 5-15
  
  if (amountUSD > 5000) score += 35;
  else if (amountUSD > 1000) score += 15;
  
  if (country === 'High Risk Region') score += 40;
  
  if (score > 60) return { score, level: 'HIGH' };
  if (score > 30) return { score, level: 'MEDIUM' };
  return { score, level: 'LOW' };
}
