import { Injectable } from '@nestjs/common';
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
    const tx = await this.prisma.transaction.create({
      data: {
        userId,
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

  async getTransaction(txId: string) {
    return this.prisma.transaction.findUnique({ where: { id: txId } });
  }
}
