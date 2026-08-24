import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Horizon, Keypair } from 'stellar-sdk';
import * as crypto from 'crypto';
import { VaultService } from '../vault/vault.service';
import { PrismaService } from '../prisma/prisma.service';
import { RpcClientService } from '../soroban/rpc-client.service';

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
    @Optional() private readonly rpcClient?: RpcClientService,
  ) {}

  /**
   * Create a new wallet for a user. If this is the first wallet, it becomes the default.
   * @param userId - The user ID
   * @param publicKey - The Stellar public key
   * @param alias - Optional user-defined alias (max 32 chars)
   * @returns The created wallet
   */
  async createWallet(userId: string, publicKey: string, alias?: string) {
    // Check if user already has wallets
    const existingWallets = await this.prisma.wallet.findMany({
      where: { userId },
    });

    // First wallet becomes default, subsequent ones don't
    const isDefault = existingWallets.length === 0;

    // Check wallet limit (max 5 per user)
    if (existingWallets.length >= 5) {
      throw new Error('Wallet limit (5) reached for this user');
    }

    // Validate alias length
    if (alias && alias.length > 32) {
      throw new Error('Wallet alias must be 32 characters or less');
    }

    const wallet = await this.prisma.wallet.create({
      data: {
        userId,
        publicKey,
        alias,
        isDefault,
      },
    });

    this.logger.log({
      event: 'wallet_created',
      userId,
      walletId: wallet.id,
      publicKey,
      alias,
      isDefault,
    });

    return wallet;
  }

  /**
   * Get all wallets for a user, sorted by creation date.
   */
  async getWallets(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get the active/default wallet for a user.
   */
  async getDefaultWallet(userId: string) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId, isDefault: true },
    });
    if (!wallet) throw new NotFoundException('No default wallet found');
    return wallet;
  }

  /**
   * Get a specific wallet by ID, with ownership verification.
   */
  async getWalletById(walletId: string, userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  /**
   * Set a wallet as the active/default wallet for a user.
   */
  async setDefaultWallet(walletId: string, userId: string) {
    // Verify ownership
    const wallet = await this.getWalletById(walletId, userId);

    // Clear default flag from other wallets
    await this.prisma.wallet.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });

    // Set this wallet as default
    const updated = await this.prisma.wallet.update({
      where: { id: walletId },
      data: { isDefault: true },
    });

    this.logger.log({
      event: 'wallet_set_default',
      userId,
      walletId,
    });

    return updated;
  }

  /**
   * Update a wallet's alias.
   */
  async updateWalletAlias(walletId: string, userId: string, alias: string | null) {
    // Verify ownership
    await this.getWalletById(walletId, userId);

    // Validate alias length
    if (alias && alias.length > 32) {
      throw new Error('Wallet alias must be 32 characters or less');
    }

    const updated = await this.prisma.wallet.update({
      where: { id: walletId },
      data: { alias },
    });

    this.logger.log({
      event: 'wallet_alias_updated',
      userId,
      walletId,
      newAlias: alias,
    });

    return updated;
  }

  /**
   * Delete a wallet. Users must have at least one wallet.
   */
  async deleteWallet(walletId: string, userId: string) {
    // Verify ownership
    await this.getWalletById(walletId, userId);

    // Check wallet count
    const walletCount = await this.prisma.wallet.count({
      where: { userId },
    });

    if (walletCount <= 1) {
      throw new Error('Cannot delete the last wallet');
    }

    // If this is the default wallet, set another as default before deleting
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (wallet?.isDefault) {
      const anotherWallet = await this.prisma.wallet.findFirst({
        where: { userId, id: { not: walletId } },
      });
      if (anotherWallet) {
        await this.setDefaultWallet(anotherWallet.id, userId);
      }
    }

    // Delete the wallet (onDelete: Restrict on Transaction.wallet prevents orphaned txs)
    await this.prisma.wallet.delete({
      where: { id: walletId },
    });

    this.logger.log({
      event: 'wallet_deleted',
      userId,
      walletId,
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

  /**
   * Reconcile the default wallet against the Stellar chain.
   */
  async reconcileWallet(userId: string, walletId?: string) {
    let wallet: any;
    if (walletId) {
      wallet = await this.getWalletById(walletId, userId);
    } else {
      wallet = await this.getDefaultWallet(userId);
    }

    const transactions = await this.prisma.transaction.findMany({
      where: { walletId: wallet.id },
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
   * Returns the public key of the default/active wallet — safe to call on every Dashboard mount
   * without exposing the encrypted secret key.
   * Throws NotFoundException (404) if the user has no wallet yet.
   */
  async getPublicKey(userId: string) {
    const wallet = await this.getDefaultWallet(userId);
    return { publicKey: wallet.publicKey, walletId: wallet.id };
  }

  /**
   * Get the default wallet by user ID.
   * @deprecated Use getDefaultWallet instead for clarity
   */
  async findByUserId(userId: string) {
    return this.getDefaultWallet(userId);
  }

  async findByPublicKey(publicKey: string) {
    return this.prisma.wallet.findUnique({ where: { publicKey } });
  }

  /**
   * Get balances for the default wallet.
   * Can optionally work with a specific walletId.
   */
  async getBalances(userId: string, walletId?: string, _afterTxHash?: string) {
    void _afterTxHash;
    
    let wallet: any;
    if (walletId) {
      wallet = await this.getWalletById(walletId, userId);
    } else {
      wallet = await this.getDefaultWallet(userId);
    }

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

  /**
   * Export the secret key of the default wallet.
   */
  async exportWallet(userId: string, walletId?: string) {
    let wallet: any;
    if (walletId) {
      wallet = await this.getWalletById(walletId, userId);
    } else {
      wallet = await this.getDefaultWallet(userId);
    }

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

  /**
   * Import a secret key as a new wallet for the user.
   */
  async importWallet(userId: string, secretKey: string, alias?: string) {
    const keypair = Keypair.fromSecret(secretKey);
    const encryptedSecret = this.encrypt(secretKey, userId);
    
    // Create a new wallet instead of upserting (multi-wallet support)
    const wallet = await this.createWallet(userId, keypair.publicKey(), alias);

    this.logger.warn({
      userId,
      category: AuditCategory.WALLET,
      operation: AuditOperation.WALLET_IMPORTED,
      outcome: AuditOutcome.SUCCESS,
      walletPublicKey: wallet.publicKey,
      metadata: { action: 'New wallet imported.' },
    });

    // Update with encrypted secret
    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { encryptedSecret },
    });

    return updated;
  }

  async signTransaction(userId: string, unsignedTransactionXdr: string) {
    if (!this.vaultService) {
      throw new Error('Delegated signer is not configured');
    }
    return this.vaultService.signTransaction(userId, unsignedTransactionXdr);
  }

  private async loadAccount(publicKey: string) {
    if (this.rpcClient) {
      return this.rpcClient.withHorizonServer((horizon) => horizon.loadAccount(publicKey));
    }
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
