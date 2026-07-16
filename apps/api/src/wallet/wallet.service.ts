import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './wallet.entity';
import { StellarService } from '../stellar/stellar.service';
import { VaultService } from '../vault/vault.service';
import { PrismaService } from '../prisma/prisma.service';
import { Horizon } from 'stellar-sdk';
import Redis from 'ioredis';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    private stellarService: StellarService,
    private vaultService: VaultService,
    private prisma: PrismaService,
  ) {}

  async enableMultiSignature(
    walletId: string,
    userId: string,
  ): Promise<{ transactionHash: string; cosignerPublicKey: string }> {
    // Find wallet and verify ownership
    const wallet = await this.walletRepository.findOne({
      where: { id: walletId, userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    // Check if multisig already enabled
    if (wallet.multisigEnabled) {
      throw new BadRequestException('Multi-signature already enabled on this wallet');
    }

    // Get cosigner public key from vault
    const cosignerPublicKey = await this.vaultService.getCosignerPublicKey();
    if (!cosignerPublicKey) {
      throw new BadRequestException('Cosigner key not configured in vault');
    }

    // Get user's keypair (securely)
    const userKeypair = await this.vaultService.getUserKeypair(userId);

    // Build and submit transaction to add cosigner
    const transactionHash = await this.stellarService.enableMultisig(
      wallet.publicKey,
      cosignerPublicKey,
      userKeypair,
      1, // master weight
      2, // threshold weight (requires 2 signatures)
    );

    // Update wallet record
    wallet.multisigEnabled = true;
    wallet.cosignerPublicKey = cosignerPublicKey;
    await this.walletRepository.save(wallet);

    this.logger.log(`Multi-signature enabled for wallet ${walletId}`);

    return {
      transactionHash,
      cosignerPublicKey,
    };
  }

  async getWallet(id: string, userId: string): Promise<Wallet> {
    const wallet = await this.walletRepository.findOne({
      where: { id, userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return wallet;
  }

  async getBalances(userId: string, afterTxHash?: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const cacheKey = `wallet_balances:${userId}`;
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    let balanceFresh = true;
    let balanceAsOf = new Date().toISOString();
    let currentBalances = null;

    if (afterTxHash) {
      const BALANCE_POLL_TIMEOUT_MS = 15000;
      const start = Date.now();
      let txIngested = false;

      while (Date.now() - start < BALANCE_POLL_TIMEOUT_MS) {
        const tx = await this.prisma.transaction.findUnique({ where: { id: afterTxHash } });
        if (tx && tx.stellarTxHash) {
          try {
            await server.transactions().transaction(tx.stellarTxHash).call();
            txIngested = true;
            break;
          } catch (err) {
            // Not ingested yet, keep polling
          }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      balanceFresh = txIngested;
    } else {
      const cached = await redis.get(cacheKey);
      if (cached) {
        redis.disconnect();
        return JSON.parse(cached);
      }
    }

    try {
      const account = await server.loadAccount(wallet.publicKey);
      currentBalances = account.balances.map((b: any) => ({
        asset: b.asset_type === 'native' ? 'XLM' : b.asset_code,
        balance: b.balance,
      }));
      balanceAsOf = (account as any).last_modified_time || new Date().toISOString();
    } catch (err: any) {
      if (err?.response?.status === 404) {
        currentBalances = [];
      } else {
        throw err;
      }
    }

    const result = {
      balances: currentBalances,
      balanceFresh,
      balanceAsOf,
    };

    // Cache the result for 60 seconds
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    redis.disconnect();

    return result;
  }
}
