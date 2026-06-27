import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './wallet.entity';
import { StellarService } from '../stellar/stellar.service';
import { VaultService } from '../vault/vault.service';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    private stellarService: StellarService,
    private vaultService: VaultService,
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
}
