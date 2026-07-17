import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Keypair } from 'stellar-sdk';
import * as crypto from 'crypto';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  private cosignerKeypair: { publicKey: string; privateKey: string } | null = null;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.initializeCosigner();
  }

  private initializeCosigner(): void {
    const cosignerSecret = this.configService.get<string>('COSIGNER_SECRET');

    if (!cosignerSecret) {
      this.logger.warn('No cosigner secret configured - multi-sig disabled');
      return;
    }

    try {
      const keypair = Keypair.fromSecret(cosignerSecret);
      this.cosignerKeypair = {
        publicKey: keypair.publicKey(),
        privateKey: cosignerSecret,
      };
      this.logger.log('Cosigner keypair initialized from secret store');
    } catch (error) {
      this.logger.error('Invalid COSIGNER_SECRET configured', error as Error);
      throw new Error('Invalid COSIGNER_SECRET configured');
    }
  }

  private getMasterKey(): Buffer {
    const configuredKey = this.configService.get<string>('ENCRYPTION_KEY');
    if (!configuredKey) {
      throw new Error('ENCRYPTION_KEY is required to decrypt wallet secrets');
    }

    if (!/^[0-9a-fA-F]{64}$/.test(configuredKey)) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    }

    return Buffer.from(configuredKey, 'hex');
  }

  private deriveUserKey(userId: string): Buffer {
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

  private decryptWalletSecret(encryptedSecret: string, userId: string): string {
    const parts = encryptedSecret.split(':');
    if (parts.length === 3) {
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
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    }

    if (parts.length === 2) {
      const [ivHex, ciphertextHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const ciphertext = Buffer.from(ciphertextHex, 'hex');
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        this.getMasterKey(),
        iv,
      );
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    }

    throw new Error('Unsupported encryptedSecret format');
  }

  async getCosignerPublicKey(): Promise<string | null> {
    return this.cosignerKeypair?.publicKey || null;
  }

  async getCosignerKeypair(): Promise<{ publicKey: string; privateKey: string } | null> {
    return this.cosignerKeypair;
  }

  async getUserKeypair(userId: string): Promise<{ publicKey: string; privateKey: string }> {
    this.logger.debug(`Retrieving keypair for user ${userId}`);

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { encryptedSecret: true },
    });

    if (!wallet?.encryptedSecret) {
      throw new NotFoundException(`Wallet secret not found for user ${userId}`);
    }

    const decryptedSecret = this.decryptWalletSecret(wallet.encryptedSecret, userId);
    const keypair = Keypair.fromSecret(decryptedSecret);

    return {
      publicKey: keypair.publicKey(),
      privateKey: decryptedSecret,
    };
  }
}
