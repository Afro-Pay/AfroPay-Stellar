import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../queue/queue.service';
import { ExchangeService } from '../exchange/exchange.service';

@Injectable()
export class TransactionProcessor {
  private readonly logger = new Logger(TransactionProcessor.name);
  private readonly thresholdUsd: number;

  constructor(
    private configService: ConfigService,
    private queueService: QueueService,
    private exchangeService: ExchangeService,
  ) {
    this.thresholdUsd = this.configService.get<number>('MULTISIG_THRESHOLD_USD', 10000);
  }

  async processTransaction(transactionData: any): Promise<void> {
    // Get amount in USD for threshold check
    const amountUsd = await this.convertToUsd(
      transactionData.amount,
      transactionData.asset_code,
    );

    const requiresCosign = this.requiresCosign(amountUsd);

    // Create job with requires_cosign flag
    const job = {
      ...transactionData,
      requiresCosign,
      thresholdUsd: this.thresholdUsd,
    };

    // Send to queue
    await this.queueService.sendJob(job);

    this.logger.log(
      `Transaction ${transactionData.id} requires cosign: ${requiresCosign}`,
    );

    // Log if above threshold
    if (requiresCosign) {
      this.logger.warn(
        `High-value transaction ${transactionData.id}: $${amountUsd} USD exceeds threshold $${this.thresholdUsd}. Multi-signature required.`,
      );
    }
  }

  private async convertToUsd(
    amount: string,
    assetCode: string,
  ): Promise<number> {
    // Convert amount to USD using exchange service
    const rate = await this.exchangeService.getRate(assetCode, 'USD');
    return parseFloat(amount) * rate;
  }

  private requiresCosign(amountUsd: number): boolean {
    return amountUsd > this.thresholdUsd;
  }
}
