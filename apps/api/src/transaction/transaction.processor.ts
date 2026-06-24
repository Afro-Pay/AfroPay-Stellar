import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
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
import { TRANSACTION_MAX_ATTEMPTS } from './transaction-retry.config';

const server = new Horizon.Server(process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org');
const network = process.env.STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

function maxAttempts(job: Job): number {
  const attempts = Number(job.opts.attempts ?? TRANSACTION_MAX_ATTEMPTS);
  return Number.isFinite(attempts) && attempts > 0 ? attempts : TRANSACTION_MAX_ATTEMPTS;
}

function currentAttempt(job: Job): number {
  return job.attemptsMade + 1;
}

function failureReason(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }

  return String(err || 'Unknown transaction submission failure');
}

@Processor('transactions')
export class TransactionProcessor {
  private readonly logger = new Logger(TransactionProcessor.name);

  constructor(private prisma: PrismaService, private walletService: WalletService) {}

  @Process('process')
  async handleTransaction(job: Job) {
    const { txId, userId, destinationPublicKey, amount, assetCode, assetIssuer, memo } = job.data;

    try {
      const keypair = await this.walletService.getKeypair(userId);
      const sourceAccount = await server.loadAccount(keypair.publicKey());

      const asset = assetCode === 'XLM' ? Asset.native() : new Asset(assetCode, assetIssuer);

      const txBuilder = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: network,
      })
        .addOperation(Operation.payment({ destination: destinationPublicKey, asset, amount }))
        .setTimeout(30);

      if (memo) txBuilder.addMemo({ value: memo } as any);

      const transaction = txBuilder.build();
      transaction.sign(keypair);

      const result = await server.submitTransaction(transaction);

      await this.prisma.transaction.update({
        where: { id: txId },
        data: {
          status: 'SUCCESS',
          stellarTxHash: result.hash,
          retryAttempts: job.attemptsMade,
          lastFailureReason: null,
          failedAt: null,
        },
      });

      this.logger.log(`Transaction ${txId} succeeded: ${result.hash}`);
    } catch (err: any) {
      const attempt = currentAttempt(job);
      const attempts = maxAttempts(job);
      const isFinalAttempt = attempt >= attempts;
      const reason = failureReason(err);

      this.logger.error(
        `Transaction ${txId} attempt ${attempt}/${attempts} failed: ${reason}`,
      );
      await this.prisma.transaction.update({
        where: { id: txId },
        data: {
          status: isFinalAttempt ? 'FAILED' : 'RETRYING',
          retryAttempts: attempt,
          lastFailureReason: reason,
          failedAt: isFinalAttempt ? new Date() : null,
        },
      });
      throw err;
    }
  }
}
