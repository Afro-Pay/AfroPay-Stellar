import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Keypair, Networks, Horizon } from 'stellar-sdk';
import * as crypto from 'crypto';
import {
  AuditLogService,
  AuditCategory,
  AuditOperation,
  AuditOutcome,
} from '../audit/audit.service';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async createWallet(userId: string) {
    const keypair = Keypair.random();
    const encryptedSecret = this.encrypt(keypair.secret());

    const wallet = await this.prisma.wallet.create({
      data: { userId, publicKey: keypair.publicKey(), encryptedSecret },
    });

    await this.auditLog.log({
      userId,
      category: AuditCategory.WALLET,
      operation: AuditOperation.WALLET_CREATED,
      outcome: AuditOutcome.SUCCESS,
      walletPublicKey: wallet.publicKey,
      metadata: { action: 'New Stellar keypair generated and stored.' },
    });

    return { publicKey: wallet.publicKey };
  }

  async getBalances(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const account = await server.loadAccount(wallet.publicKey);
    return account.balances.map((b: any) => ({
      asset: b.asset_type === 'native' ? 'XLM' : b.asset_code,
      balance: b.balance,
    }));
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

  async exportWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    await this.auditLog.log({
      userId,
      category: AuditCategory.WALLET,
      operation: AuditOperation.WALLET_EXPORTED,
      outcome: AuditOutcome.SUCCESS,
      walletPublicKey: wallet.publicKey,
      metadata: { warning: 'Secret key was exported — review if unexpected.' },
    });

    return {
      publicKey: wallet.publicKey,
      secretKey: this.decrypt(wallet.encryptedSecret),
    };
  }

  async importWallet(userId: string, secretKey: string) {
    const keypair = Keypair.fromSecret(secretKey);
    const encryptedSecret = this.encrypt(secretKey);
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: { publicKey: keypair.publicKey(), encryptedSecret },
      create: { userId, publicKey: keypair.publicKey(), encryptedSecret },
    });

    await this.auditLog.log({
      userId,
      category: AuditCategory.WALLET,
      operation: AuditOperation.WALLET_IMPORTED,
      outcome: AuditOutcome.SUCCESS,
      walletPublicKey: wallet.publicKey,
      metadata: { action: 'Existing secret key imported/overwritten.' },
    });

    return wallet;
  }

  async getKeypair(userId: string): Promise<Keypair> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return Keypair.fromSecret(this.decrypt(wallet.encryptedSecret));
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
