import { INITIAL_TRANSACTIONS } from './constants';
import { generateStellarKeypair } from './stellar';
import { TransactionRecord, WalletState, KYCTierInfo } from '../types';

const STORAGE_KEYS = {
  WALLET: 'afropay_wallet_v1',
  TRANSACTIONS: 'afropay_transactions_v1',
  KYC: 'afropay_kyc_v1',
  BENEFICIARIES: 'afropay_beneficiaries_v1',
};

// Default initial wallet
const defaultKeypair = generateStellarKeypair();

const DEFAULT_WALLET: WalletState = {
  publicKey: 'GAFROPAY77XLMTESTNET55REMITTANCE99ANCHOR2026OK',
  secretKeyEncrypted: 'AES256:8f9a0123...[ENCRYPTED_AT_REST]',
  sequenceNumber: '1098273645129',
  isFunded: true,
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
  balances: {
    XLM: {
      code: 'XLM',
      name: 'Stellar Lumens',
      symbol: '🥏 XLM',
      balance: 1450.50,
      usdValue: 166.80,
      trustlineActive: true,
      flag: '🌐',
    },
    USDC: {
      code: 'USDC',
      name: 'USD Coin',
      symbol: '$',
      balance: 820.00,
      usdValue: 820.00,
      trustlineActive: true,
      issuer: 'GA5ZSEJYB37JRC5AVCIA5XYGEFA2E63AQR363P32NF2S363P32NF2S36',
      flag: '🇺🇸',
    },
    NGN: {
      code: 'NGN',
      name: 'Nigerian Naira',
      symbol: '₦',
      balance: 450000.00,
      usdValue: 295.95,
      trustlineActive: true,
      issuer: 'GBA123COWRIEANCHOR999NGNSTEL111222333444555',
      flag: '🇳🇬',
    },
    EUR: {
      code: 'EUR',
      name: 'Euro',
      symbol: '€',
      balance: 120.00,
      usdValue: 130.44,
      trustlineActive: true,
      issuer: 'GCEURANCHOR999SEPARIM444555',
      flag: '🇪🇺',
    }
  }
};

export class StorageService {
  static getWallet(): WalletState {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.WALLET);
      if (!data) {
        this.saveWallet(DEFAULT_WALLET);
        return DEFAULT_WALLET;
      }
      return JSON.parse(data);
    } catch {
      return DEFAULT_WALLET;
    }
  }

  static saveWallet(wallet: WalletState): void {
    try {
      localStorage.setItem(STORAGE_KEYS.WALLET, JSON.stringify(wallet));
    } catch (e) {
      console.error('Failed to save wallet to storage', e);
    }
  }

  static getTransactions(): TransactionRecord[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
      if (!data) {
        this.saveTransactions(INITIAL_TRANSACTIONS);
        return INITIAL_TRANSACTIONS;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_TRANSACTIONS;
    }
  }

  static saveTransactions(transactions: TransactionRecord[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
    } catch (e) {
      console.error('Failed to save transactions to storage', e);
    }
  }

  static addTransaction(tx: TransactionRecord): TransactionRecord[] {
    const list = this.getTransactions();
    const updated = [tx, ...list];
    this.saveTransactions(updated);
    
    // Also deduct balance if type is transfer/withdrawal
    const wallet = this.getWallet();
    if (wallet.balances[tx.sourceCurrency]) {
      const current = wallet.balances[tx.sourceCurrency].balance;
      const newBal = Math.max(0, current - tx.sourceAmount);
      wallet.balances[tx.sourceCurrency].balance = Number(newBal.toFixed(2));
      wallet.balances[tx.sourceCurrency].usdValue = Number((newBal * (tx.sourceCurrency === 'USDC' ? 1 : tx.sourceCurrency === 'XLM' ? 0.115 : tx.sourceCurrency === 'EUR' ? 1.087 : 0.000657)).toFixed(2));
    }
    
    if (tx.type === 'deposit' && wallet.balances[tx.destCurrency]) {
      const current = wallet.balances[tx.destCurrency].balance;
      const newBal = current + tx.destAmount;
      wallet.balances[tx.destCurrency].balance = Number(newBal.toFixed(2));
      wallet.balances[tx.destCurrency].usdValue = Number((newBal * (tx.destCurrency === 'USDC' ? 1 : tx.destCurrency === 'XLM' ? 0.115 : tx.destCurrency === 'EUR' ? 1.087 : 0.000657)).toFixed(2));
    }
    
    this.saveWallet(wallet);
    return updated;
  }

  static toggleTrustline(code: 'USDC' | 'NGN' | 'EUR'): WalletState {
    const wallet = this.getWallet();
    if (wallet.balances[code]) {
      wallet.balances[code].trustlineActive = !wallet.balances[code].trustlineActive;
      this.saveWallet(wallet);
    }
    return wallet;
  }

  static resetToDefault(): void {
    localStorage.clear();
  }
}
