import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Horizon, Keypair } from 'stellar-sdk';
import * as crypto from 'crypto';
import { VaultService } from '../vault/vault.service';
import { PrismaService } from '../prisma/prisma.service';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);
const AuditCategory = { WALLET: 'WALLET' } as const;
const AuditOperation = {
  WALLET_EXPORTED: 'WALLET_EXPORTED',
  WALLET_IMPORTED: 'WALLET_IMPORTED',
} as const;
const AuditOutcome = { SUCCESS: 'SUCCESS' } as const;

export class AuthTagMismatchError extends Error {
  constructor(message = 'AuthTagMismatch') {
    super(message);
    this.name = 'AuthTagMismatch';
  }
}

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
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private readonly vaultService?: VaultService,
  ) {}

  async createWallet(userId: string, publicKey: string, name?: string) {
    const wallet = await (this.prisma.wallet as any).create({
      data: {
        userId,
        publicKey,
        name,
      },
    });

    this.logger.log({
      event: 'wallet_created',
      userId,
      walletId: wallet.id,
      publicKey,
    });

    return wallet;
  }

  async getWallets(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
    });
  }

  async enableMultisig(walletId: string, userId: string) {
    const wallet = await (this.prisma.wallet as any).update({
      where: { id: walletId, userId },
      data: { multisigEnabled: true },
    });

    this.logger.log({
      event: 'wallet_multisig_enabled',
      userId,
      walletId,
    });

    return wallet;
  }

  async freezeWallet(walletId: string, userId: string) {
    const wallet = await (this.prisma.wallet as any).update({
      where: { id: walletId, userId },
      data: { isFrozen: true },
    });

    return wallet;
  }

  async unfreezeWallet(walletId: string, userId: string) {
    const wallet = await (this.prisma.wallet as any).update({
      where: { id: walletId, userId },
      data: { isFrozen: false },
    });

    return wallet;
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

        return this.buildReconciliationReport(
          wallet,
          expectedAssets,
          [],
          transactions,
          discrepancies,
          null,
        );
      }

      throw error;
    }

    const onChainAssets = this.assetsFromHorizonBalances(account.balances ?? []);
    const onChainAssetKeys = new Set(
      onChainAssets.map((asset) => this.assetKey(asset.asset, asset.assetIssuer)),
    );

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

  /**
   * Returns only the public key — safe to call on every Dashboard mount
   * without exposing the encrypted secret key.
   * Throws NotFoundException (404) if the user has no wallet yet.
   */
  async getPublicKey(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return { publicKey: wallet.publicKey };
  }

  async findByUserId(userId: string) {
    return this.prisma.wallet.findUnique({ where: { userId } });
  }

  async findByPublicKey(publicKey: string) {
    return this.prisma.wallet.findUnique({ where: { publicKey } });
  }

  async getBalances(userId: string, _afterTxHash?: string) {
    void _afterTxHash;
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    const account = await this.loadAccount(wallet.publicKey);
    return (account.balances ?? []).map((balance: any) => ({
      asset: balance.asset_type === 'native' ? 'XLM' : balance.asset_code,
      balance: balance.balance,
    }));
  }

  async enableMultiSignature(walletId: string, userId: string) {
    const wallet = await this.enableMultisig(walletId, userId);
    return {
      transactionHash: null,
      cosignerPublicKey: await this.vaultService?.getCosignerPublicKey() ?? null,
      wallet,
    };
  }

  async exportWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    this.logger.warn({
      userId,
      category: AuditCategory.WALLET,
      operation: AuditOperation.WALLET_EXPORTED,
      outcome: AuditOutcome.SUCCESS,
      walletPublicKey: wallet.publicKey,
      metadata: { warning: 'Secret key was exported — review if unexpected.' },
    });

    return {
      publicKey: wallet.publicKey,
      secretKey: this.decrypt(wallet.encryptedSecret, userId),
    };
  }

  async importWallet(userId: string, secretKey: string) {
    const keypair = Keypair.fromSecret(secretKey);
    const encryptedSecret = this.encrypt(secretKey, userId);
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: { publicKey: keypair.publicKey(), encryptedSecret },
      create: { userId, publicKey: keypair.publicKey(), encryptedSecret },
    });

    this.logger.warn({
      userId,
      category: AuditCategory.WALLET,
      operation: AuditOperation.WALLET_IMPORTED,
      outcome: AuditOutcome.SUCCESS,
      walletPublicKey: wallet.publicKey,
      metadata: { action: 'Existing secret key imported/overwritten.' },
    });

    return wallet;
  }

  async signTransaction(userId: string, unsignedTransactionXdr: string) {
    if (!this.vaultService) {
      throw new Error('Delegated signer is not configured');
    }
    return this.vaultService.signTransaction(userId, unsignedTransactionXdr);
  }

  private async loadAccount(publicKey: string) {
    return server.loadAccount(publicKey);
  }

  private assetsFromHorizonBalances(balances: any[]): ReconciliationAsset[] {
    return balances.map((balance) => ({
      asset: balance.asset_type === 'native' ? 'XLM' : balance.asset_code,
      assetIssuer: balance.asset_type === 'native' ? null : (balance.asset_issuer ?? null),
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
    return (
      error?.response?.status === 404 ||
      error?.status === 404 ||
      error?.name === 'NotFoundError'
    );
  }

  private getMasterKey() {
    const configuredKey = process.env.ENCRYPTION_KEY;
    if (!configuredKey) {
      throw new Error('ENCRYPTION_KEY is required');
    }

    return Buffer.from(configuredKey, 'hex');
  }

  private deriveUserKey(userId: string) {
    return Buffer.from(
      crypto.hkdfSync(
        'sha256',
        this.getMasterKey(),
        Buffer.alloc(16),
        Buffer.from(userId, 'utf8'),
        32,
      ),
    );
  }

  private encrypt(text: string, userId: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.deriveUserKey(userId),
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  private decrypt(data: string, userId: string): string {
    const parts = data.split(':');

    if (parts.length === 2) {
      const [ivHex, encrypted] = parts;
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        this.getMasterKey(),
        Buffer.from(ivHex, 'hex'),
      );
      return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
    }

    if (parts.length !== 3) {
      throw new AuthTagMismatchError();
    }

    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.deriveUserKey(userId),
      iv,
    );
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new AuthTagMismatchError();
    }
  }
}
