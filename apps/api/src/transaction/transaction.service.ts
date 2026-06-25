import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { TRANSACTION_QUEUE_OPTIONS } from './transaction-retry.config';

export interface SendTransferDto {
  destinationPublicKey: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
}

@Injectable()
export class TransactionService {
  constructor(
    @InjectQueue('transactions') private txQueue: Queue,
    private prisma: PrismaService,
  ) {}

  async sendTransfer(userId: string, dto: SendTransferDto) {
    // Resolve the wallet FK – every transfer must originate from the user's wallet.
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found for user');

    const tx = await this.prisma.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        destination: dto.destinationPublicKey,
        amount: dto.amount,
        assetCode: dto.assetCode,
        assetIssuer: dto.assetIssuer ?? null,
        memo: dto.memo ?? null,
        status: 'PENDING',
      },
    });

    await this.txQueue.add('process', { txId: tx.id, userId, ...dto }, TRANSACTION_QUEUE_OPTIONS);

    return { txId: tx.id, status: 'PENDING' };
  }

  async getHistory(userId: string) {
    return this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getTransactionsByWallet(walletId: string) {
    return this.prisma.transaction.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getTransaction(txId: string) {
    return this.prisma.transaction.findUnique({ where: { id: txId } });
  }

  async updateTransactionStatus(
    txId: string,
    status: 'PENDING' | 'RETRYING' | 'SUCCESS' | 'FAILED',
    stellarTxHash?: string,
  ) {
    return this.prisma.transaction.update({
      where: { id: txId },
      data: {
        status,
        ...(stellarTxHash ? { stellarTxHash } : {}),
      },
    });
  }
}
