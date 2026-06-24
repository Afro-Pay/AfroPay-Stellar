import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Keypair, Horizon } from 'stellar-sdk';
import * as crypto from 'crypto';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

type ReconciliationSeverity = 'info' | 'warning' | 'critical';

interface ReconciliationDiscrepancy {
  type: string;
  severity: ReconciliationSeverity;
  message: string;
  asset?: string;
  assetIssuer?: string | null;
  details?: Record<string, unknown>;
}

interface ReconciliationAsset {
  asset: string;
  assetIssuer: string | null;
  balance: string;
  trustline: boolean;
  limit?: string;
}

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  async createWallet(userId: string) {
    const keypair = Keypair.random();
    const encryptedSecret = this.encrypt(keypair.secret());

    const wallet = await this.prisma.wallet.create({
      data: { userId, publicKey: keypair.publicKey(), encryptedSecret },
    });

    return { publicKey: wallet.publicKey };
  }

  async getBalances(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const account = await this.loadAccount(wallet.publicKey);
    return account.balances.map((b: any) => ({
      asset: b.asset_type === 'native' ? 'XLM' : b.asset_code,
      balance: b.balance,
    }));
  }

  async reconcileWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const transactions = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    const expectedAssets = this.expectedAssetsFromTransactions(transactions);
    const discrepancies: ReconciliationDiscrepancy[] = [];

    let account: any;
    try {
      account = await this.loadAccount(wallet.publicKey);
    } catch (error) {
      if (this.isHorizonNotFound(error)) {
        discrepancies.push({
          type: 'ON_CHAIN_ACCOUNT_NOT_FOUND',
          severity: 'critical',
          message: 'Stored wallet public key was not found on Horizon.',
          details: { publicKey: wallet.publicKey },
        });

        return this.buildReconciliationReport(wallet, expectedAssets, [], transactions, discrepancies, null);
      }

      throw error;
    }

    const onChainAssets = this.assetsFromHorizonBalances(account.balances ?? []);
    const onChainAssetKeys = new Set(onChainAssets.map((asset) => this.assetKey(asset.asset, asset.assetIssuer)));

    for (const expectedAsset of expectedAssets) {
      if (expectedAsset.asset === 'XLM') continue;
      if (!onChainAssetKeys.has(this.assetKey(expectedAsset.asset, expectedAsset.assetIssuer))) {
        discrepancies.push({
          type: 'MISSING_TRUSTLINE',
          severity: 'warning',
          message: `Application activity references ${expectedAsset.asset}, but the wallet has no matching on-chain trustline.`,
          asset: expectedAsset.asset,
          assetIssuer: expectedAsset.assetIssuer,
          details: {
            transactionCount: expectedAsset.transactionCount,
            lastTransactionAt: expectedAsset.lastTransactionAt,
          },
        });
      }
    }

    const lastModifiedTime = account.last_modified_time ? new Date(account.last_modified_time) : null;
    if (lastModifiedTime && transactions.some((tx: any) => new Date(tx.updatedAt) > lastModifiedTime)) {
      discrepancies.push({
        type: 'STALE_LEDGER_STATE',
        severity: 'info',
        message: 'Application transactions were updated after the account last changed on-chain.',
        details: {
          horizonLastModifiedTime: account.last_modified_time,
          latestApplicationTransactionAt: transactions[0]?.updatedAt,
        },
      });
    }

    return this.buildReconciliationReport(
      wallet,
      expectedAssets,
      onChainAssets,
      transactions,
      discrepancies,
      account,
    );
  }

  async exportWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return {
      publicKey: wallet.publicKey,
      secretKey: this.decrypt(wallet.encryptedSecret),
    };
  }

  async importWallet(userId: string, secretKey: string) {
    const keypair = Keypair.fromSecret(secretKey);
    const encryptedSecret = this.encrypt(secretKey);
    return this.prisma.wallet.upsert({
      where: { userId },
      update: { publicKey: keypair.publicKey(), encryptedSecret },
      create: { userId, publicKey: keypair.publicKey(), encryptedSecret },
    });
  }

  async getKeypair(userId: string): Promise<Keypair> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return Keypair.fromSecret(this.decrypt(wallet.encryptedSecret));
  }

  private async loadAccount(publicKey: string) {
    return server.loadAccount(publicKey);
  }

  private assetsFromHorizonBalances(balances: any[]): ReconciliationAsset[] {
    return balances.map((balance) => ({
      asset: balance.asset_type === 'native' ? 'XLM' : balance.asset_code,
      assetIssuer: balance.asset_type === 'native' ? null : balance.asset_issuer ?? null,
      balance: balance.balance,
      trustline: balance.asset_type !== 'native',
      limit: balance.limit,
    }));
  }

  private expectedAssetsFromTransactions(transactions: any[]) {
    const assets = new Map<
      string,
      {
        asset: string;
        assetIssuer: string | null;
        transactionCount: number;
        statuses: Record<string, number>;
        lastTransactionAt: string | null;
      }
    >();

    for (const tx of transactions) {
      const asset = tx.assetCode || 'XLM';
      const assetIssuer = tx.assetIssuer ?? null;
      const key = this.assetKey(asset, assetIssuer);
      const current = assets.get(key) ?? {
        asset,
        assetIssuer,
        transactionCount: 0,
        statuses: {},
        lastTransactionAt: null,
      };

      current.transactionCount += 1;
      current.statuses[tx.status] = (current.statuses[tx.status] ?? 0) + 1;
      const updatedAt = tx.updatedAt ? new Date(tx.updatedAt).toISOString() : null;
      if (updatedAt && (!current.lastTransactionAt || updatedAt > current.lastTransactionAt)) {
        current.lastTransactionAt = updatedAt;
      }

      assets.set(key, current);
    }

    return Array.from(assets.values());
  }

  private buildReconciliationReport(
    wallet: any,
    expectedAssets: ReturnType<WalletService['expectedAssetsFromTransactions']>,
    onChainAssets: ReconciliationAsset[],
    transactions: any[],
    discrepancies: ReconciliationDiscrepancy[],
    account: any,
  ) {
    const criticalCount = discrepancies.filter((item) => item.severity === 'critical').length;
    return {
      status: discrepancies.length === 0 ? 'in_sync' : 'drift_detected',
      checkedAt: new Date().toISOString(),
      wallet: {
        id: wallet.id,
        publicKey: wallet.publicKey,
      },
      onChain: {
        accountFound: Boolean(account),
        horizonUrl: HORIZON_URL,
        sequence: account?.sequence ?? null,
        lastModifiedLedger: account?.last_modified_ledger ?? null,
        lastModifiedTime: account?.last_modified_time ?? null,
        balances: onChainAssets,
      },
      application: {
        trackedAssetCount: expectedAssets.length,
        recentTransactionCount: transactions.length,
        expectedAssets,
      },
      summary: {
        discrepancyCount: discrepancies.length,
        criticalCount,
        missingTrustlineCount: discrepancies.filter((item) => item.type === 'MISSING_TRUSTLINE').length,
      },
      discrepancies,
    };
  }

  private assetKey(asset: string, issuer: string | null | undefined) {
    return `${asset}:${issuer ?? 'native'}`;
  }

  private isHorizonNotFound(error: any) {
    return error?.response?.status === 404 || error?.status === 404 || error?.name === 'NotFoundError';
  }

  private encrypt(text: string): string {
    const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    return iv.toString('hex') + ':' + cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
  }

  private decrypt(data: string): string {
    const [ivHex, encrypted] = data.split(':');
    const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  }
}
