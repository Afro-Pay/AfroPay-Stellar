import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  AuditLogService,
  AuditCategory,
  AuditOperation,
  AuditOutcome,
} from '../audit/audit.service';
import {
  Horizon,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
} from 'stellar-sdk';

const server = new Horizon.Server(
  process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
);
const network =
  process.env.STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

@Processor('transactions')
export class TransactionProcessor {
  private readonly logger = new Logger(TransactionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Process('process')
  async handleTransaction(job: Job) {
    const {
      txId,
      userId,
      destinationPublicKey,
      amount,
      assetCode,
      assetIssuer,
      memo,
    } = job.data;

    try {
      const keypair = await this.walletService.getKeypair(userId);
      const sourceAccount = await server.loadAccount(keypair.publicKey());

      const asset =
        assetCode === 'XLM'
          ? Asset.native()
          : new Asset(assetCode, assetIssuer);

      const txBuilder = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: network,
      })
        .addOperation(
          Operation.payment({ destination: destinationPublicKey, asset, amount }),
        )
        .setTimeout(30);

      if (memo) txBuilder.addMemo({ value: memo } as any);

      const transaction = txBuilder.build();
      transaction.sign(keypair);

      const result = await server.submitTransaction(transaction);

      await this.prisma.transaction.update({
        where: { id: txId },
        data: { status: 'SUCCESS', stellarTxHash: result.hash },
      });

      this.logger.log(`Transaction ${txId} succeeded: ${result.hash}`);

      // Audit: blockchain confirmation
      await this.auditLog.log({
        userId,
        category: AuditCategory.TRANSACTION,
        operation: AuditOperation.TX_SUCCESS,
        outcome: AuditOutcome.SUCCESS,
        walletPublicKey: keypair.publicKey(),
        amount,
        assetCode,
        destination: destinationPublicKey,
        txHash: result.hash,
        metadata: { txId },
      });
    } catch (err: any) {
      const isFinal = job.attemptsMade >= 2;
      const newStatus = isFinal ? 'FAILED' : 'RETRYING';

      this.logger.error(`Transaction ${txId} failed: ${err.message}`);

      await this.prisma.transaction.update({
        where: { id: txId },
        data: { status: newStatus },
      });

      // Audit: failure or retry
      await this.auditLog.log({
        userId,
        category: AuditCategory.TRANSACTION,
        operation: isFinal ? AuditOperation.TX_FAILED : AuditOperation.TX_RETRYING,
        outcome: AuditOutcome.FAILURE,
        amount,
        assetCode,
        destination: destinationPublicKey,
        metadata: {
          txId,
          attempt: job.attemptsMade,
          error: err.message,
        },
      });

      throw err;
    }
  }
}
