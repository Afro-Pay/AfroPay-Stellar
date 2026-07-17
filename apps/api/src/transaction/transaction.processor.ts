import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  Horizon,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
} from 'stellar-sdk';

const server = new Horizon.Server(process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org');
const network = process.env.STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

@Injectable()
export class TransactionProcessor {
  private readonly logger = new Logger(TransactionProcessor.name);

  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

  async processTransaction(txId: string): Promise<any> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
    });

    if (!tx) {
      throw new Error('Transaction not found');
    }

    // Check if flagged for fraud
    if (tx.flagged) {
      this.logger.warn(`Transaction ${txId} is flagged as suspicious. Holding in REVIEW status.`);
      const updated = await this.prisma.transaction.update({
        where: { id: txId },
        data: { status: 'REVIEW' },
      });
      return updated;
    }

    try {
      const keypair = await this.walletService.getKeypair(tx.userId);
      const sourceAccount = await server.loadAccount(keypair.publicKey());

      const asset = tx.assetCode === 'XLM' ? Asset.native() : new Asset(tx.assetCode, tx.assetIssuer || undefined);

      const txBuilder = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: network,
      })
        .addOperation(
          Operation.payment({
            destination: tx.destination,
            asset,
            amount: tx.amount,
          }),
        )
        .setTimeout(30);

      if (tx.memo) {
        txBuilder.addMemo({ value: tx.memo } as any);
      }

      const transaction = txBuilder.build();
      transaction.sign(keypair);

      const result = await server.submitTransaction(transaction);

      const updated = await this.prisma.transaction.update({
        where: { id: txId },
        data: {
          status: 'SUCCESS',
          stellarTxHash: result.hash,
        },
      });

      this.logger.log(`Transaction ${txId} succeeded: ${result.hash}`);
      return updated;
    } catch (err: any) {
      const attempt = (tx as any).retryCount ?? 0;
      const isFinalAttempt = attempt >= 2; // max 3 attempts (0, 1, 2)
      const reason = err instanceof Error ? err.message : String(err);

      this.logger.error(
        `Transaction ${txId} attempt ${attempt + 1}/3 failed: ${reason}`,
      );

      const updated = await this.prisma.transaction.update({
        where: { id: txId },
        data: {
          status: isFinalAttempt ? 'FAILED' : 'RETRYING',
          retryCount: attempt + 1,
        } as any,
      });

      return updated;
    }
  }
}
