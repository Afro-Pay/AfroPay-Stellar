import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Keypair, Horizon } from 'stellar-sdk';
import * as crypto from 'crypto';
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

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
  private readonly kmsClient: KMSClient | null;
  private readonly kmsKeyId: string | null;

  constructor(private prisma: PrismaService) {
    this.kmsClient =
      process.env.KMS_KEY_ID && process.env.AWS_REGION
        ? new KMSClient({ region: process.env.AWS_REGION })
        : null;
    this.kmsKeyId = process.env.KMS_KEY_ID ?? null;
  }

  async createWallet(userId: string) {
    const keypair = Keypair.random();
    const { encryptedSecret, encryptedDek, kmsKeyId } = await this.encryptWalletSecret(keypair.secret());

    const wallet = await this.prisma.wallet.create({
      data: { userId, publicKey: keypair.publicKey(), encryptedSecret, encryptedDek, kmsKeyId },
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
      secretKey: await this.decryptWalletSecret(wallet),
    };
  }

  async importWallet(userId: string, secretKey: string) {
    const keypair = Keypair.fromSecret(secretKey);
    const { encryptedSecret, encryptedDek, kmsKeyId } = await this.encryptWalletSecret(secretKey);

    return this.prisma.wallet.upsert({
      where: { userId },
      update: { publicKey: keypair.publicKey(), encryptedSecret, encryptedDek, kmsKeyId },
      create: { userId, publicKey: keypair.publicKey(), encryptedSecret, encryptedDek, kmsKeyId },
    });
  }

  async getKeypair(userId: string): Promise<Keypair> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    return Keypair.fromSecret(await this.decryptWalletSecret(wallet));
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

  private async decryptWalletSecret(wallet: any): Promise<string> {
    if (wallet.encryptedDek) {
      const dek = await this.decryptDekFromKms(wallet.encryptedDek);
      return this.decryptSecretWithDek(wallet.encryptedSecret, dek);
    }

    const secret = this.decryptLegacySecret(wallet.encryptedSecret);
    if (this.kmsClient) {
      await this.reencryptWalletWithKms(wallet.id, secret);
    }

    return secret;
  }

  private async reencryptWalletWithKms(walletId: string, secret: string) {
    const { encryptedSecret, encryptedDek, kmsKeyId } = await this.encryptWalletSecret(secret);
    await this.prisma.wallet.update({
      where: { id: walletId },
      data: { encryptedSecret, encryptedDek, kmsKeyId },
    });
  }

  private async encryptWalletSecret(secretKey: string) {
    if (this.kmsClient && this.kmsKeyId) {
      const dek = crypto.randomBytes(32);
      return {
        encryptedSecret: this.encryptSecretWithDek(secretKey, dek),
        encryptedDek: await this.encryptDekWithKms(dek),
        kmsKeyId: this.kmsKeyId,
      };
    }

    return {
      encryptedSecret: this.encryptLegacySecret(secretKey),
      encryptedDek: null,
      kmsKeyId: null,
    };
  }

  private async encryptDekWithKms(dek: Buffer): Promise<string> {
    if (!this.kmsClient || !this.kmsKeyId) {
      throw new Error('Missing KMS configuration for encryption');
    }

    const result = await this.kmsClient.send(
      new EncryptCommand({
        KeyId: this.kmsKeyId,
        Plaintext: dek,
      }),
    );

    if (!result.CiphertextBlob) {
      throw new Error('KMS failed to encrypt the data key');
    }

    return Buffer.from(result.CiphertextBlob).toString('base64');
  }

  private async decryptDekFromKms(encryptedDek: string): Promise<Buffer> {
    if (!this.kmsClient) {
      throw new Error('Missing KMS configuration for decryption');
    }

    const result = await this.kmsClient.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedDek, 'base64'),
      }),
    );

    if (!result.Plaintext) {
      throw new Error('KMS failed to decrypt the data key');
    }

    return Buffer.from(result.Plaintext);
  }

  private encryptSecretWithDek(secretKey: string, dek: Buffer): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    const encrypted = Buffer.concat([cipher.update(secretKey, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decryptSecretWithDek(data: string, dek: Buffer): string {
    const [ivHex, authTagHex, encrypted] = data.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(encrypted, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
  }

  private encryptLegacySecret(text: string): string {
    const key = this.getLegacyKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    return iv.toString('hex') + ':' + cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
  }

  private decryptLegacySecret(data: string): string {
    const [ivHex, encrypted] = data.split(':');
    const key = this.getLegacyKey();
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  }

  private getLegacyKey(): Buffer {
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex) {
      throw new Error('ENCRYPTION_KEY is required when KMS is not configured');
    }
    return Buffer.from(keyHex, 'hex');
  }
}
