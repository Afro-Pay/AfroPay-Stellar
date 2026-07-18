import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Logger } from 'nestjs-pino';

@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaClient,
    private auditService: AuditService,
    private logger: Logger,
  ) {}

  async createWallet(userId: string, publicKey: string, name?: string) {
    const wallet = await this.prisma.wallet.create({
      data: {
        userId,
        publicKey,
        name,
      },
    });

    // Audit: Wallet creation
    await this.auditService.log(
      userId,
      'WALLET_CREATE',
      { walletId: wallet.id, publicKey, name },
    );

    this.logger.info({
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
    const wallet = await this.prisma.wallet.update({
      where: { id: walletId, userId },
      data: { multisigEnabled: true },
    });

    // Audit: Multisig enabled
    await this.auditService.log(
      userId,
      'WALLET_MULTISIG_ENABLE',
      { walletId, publicKey: wallet.publicKey },
    );

    this.logger.info({
      event: 'wallet_multisig_enabled',
      userId,
      walletId,
    });

    return wallet;
  }

  async freezeWallet(walletId: string, userId: string) {
    const wallet = await this.prisma.wallet.update({
      where: { id: walletId, userId },
      data: { isFrozen: true },
    });

    // Audit: Wallet frozen
    await this.auditService.log(
      userId,
      'WALLET_FREEZE',
      { walletId, publicKey: wallet.publicKey },
    );

    return wallet;
  }

  async unfreezeWallet(walletId: string, userId: string) {
    const wallet = await this.prisma.wallet.update({
      where: { id: walletId, userId },
      data: { isFrozen: false },
    });

    // Audit: Wallet unfrozen
    await this.auditService.log(
      userId,
      'WALLET_UNFREEZE',
      { walletId, publicKey: wallet.publicKey },
    );

    return wallet;
  }
}
