import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../soroban/soroban.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import axios from 'axios';

export interface InitiateTransferDto {
  recipientCountry: string;
  fiatAmount: number;
  fiatCurrency: string;
}

@Injectable()
export class TransactionService {
  constructor(
    private prisma: PrismaService,
    private soroban: SorobanService,
    @InjectQueue('transactions') private transactionQueue: Queue,
  ) {}

  /**
   * Initiate a cross-border remittance transfer
   * 1. Validate sender & recipient (KYC)
   * 2. Check fraud score
   * 3. Get exchange rate
   * 4. Create escrow on Soroban contract
   * 5. Queue background job to track oracle confirmation
   */
  async initiateTransfer(userId: string, dto: InitiateTransferDto): Promise<any> {
    // Get sender's wallet
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    // Validate recipient country (KYC requirement)
    const supportedCountries = ['NG', 'GH', 'KE'];
    if (!supportedCountries.includes(dto.recipientCountry)) {
      throw new BadRequestException('Unsupported recipient country');
    }

    // Call fraud detection service
    const fraudScore = await this.checkFraudScore(userId, dto.fiatAmount, dto.recipientCountry);
    if (fraudScore > 0.7) {
      throw new BadRequestException(`Transfer blocked due to high fraud score: ${fraudScore}`);
    }

    // Get current exchange rate from price feed
    const exchangeRate = await this.getExchangeRate(dto.recipientCountry);
    const usdcAmount = Math.floor((dto.fiatAmount / exchangeRate) * 1e7); // Convert to stroops

    if (usdcAmount < 1e6 || usdcAmount > 1e14) {
      throw new BadRequestException('Transfer amount outside allowed range');
    }

    // Hash recipient account (privacy-preserving)
    const recipientAccountHash = Buffer.from('hash_placeholder');

    // Deposit to Soroban escrow
    const escrowId = await this.soroban.depositEscrow(wallet.encryptedSecret, {
      sender: wallet.publicKey,
      agent: process.env.DEFAULT_AGENT_ADDRESS!,
      amount: BigInt(usdcAmount),
      recipientCountry: dto.recipientCountry,
      recipientAccountHash,
      fiatAmount: BigInt(dto.fiatAmount),
      fiatCurrency: dto.fiatCurrency,
      exchangeRate: BigInt(Math.floor(exchangeRate * 1e6)),
      timeoutMinutes: 120, // 2-hour timeout
    });

    // Record transaction in database
    const transaction = await this.prisma.transaction.create({
      data: {
        userId,
        destination: dto.recipientCountry,
        amount: usdcAmount.toString(),
        assetCode: 'USDC',
        assetIssuer: process.env.USDC_ISSUER,
        memo: escrowId,
        status: 'PENDING',
        riskScore: fraudScore,
        flagged: fraudScore > 0.5,
      },
    });

    // Queue background job to monitor oracle confirmation
    await this.transactionQueue.add(
      'monitor-escrow',
      { escrowId, transactionId: transaction.id },
      { delay: 5000, attempts: 3 },
    );

    return {
      transactionId: transaction.id,
      escrowId,
      status: 'PENDING',
      amount: usdcAmount,
      usdcAmount: (usdcAmount / 1e7).toFixed(2),
      fiatAmount: dto.fiatAmount,
      fiatCurrency: dto.fiatCurrency,
      exchangeRate: (exchangeRate / 1e6).toFixed(6),
      estimatedTime: '5-10 minutes',
    };
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(transactionId: string): Promise<any> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    // Fetch escrow state from Soroban
    const escrowState = await this.soroban.getEscrow(transaction.memo || '');

    return {
      ...transaction,
      escrowState,
    };
  }

  /**
   * List user's transactions
   */
  async getUserTransactions(userId: string, skip: number = 0, take: number = 10): Promise<any> {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    });

    const total = await this.prisma.transaction.count({ where: { userId } });

    return {
      transactions,
      total,
      skip,
      take,
    };
  }

  /**
   * Oracle submits delivery attestation
   */
  async submitOracleAttestation(oracleAddress: string, attestation: any): Promise<any> {
    // Verify oracle is registered
    // In production, check oracle_operators map on contract

    // Release funds to agent
    await this.soroban.releaseToAgent(attestation.escrowId, attestation);

    // Update transaction status
    const transaction = await this.prisma.transaction.findFirst({
      where: { memo: attestation.escrowId },
    });

    if (transaction) {
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: attestation.deliverySuccess ? 'COMPLETED' : 'FAILED',
          stellarTxHash: attestation.signature,
        },
      });
    }

    return { escrowId: attestation.escrowId, status: 'RELEASED' };
  }

  /**
   * Claim refund (after timeout or failure)
   */
  async claimRefund(userId: string, transactionId: string): Promise<any> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction || transaction.userId !== userId) {
      throw new NotFoundException('Transaction not found');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    // Claim refund from Soroban contract
    await this.soroban.claimRefund(wallet!.encryptedSecret, transaction.memo || '');

    // Update transaction status
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'REFUNDED' },
    });

    return {
      transactionId,
      status: 'REFUNDED',
      amount: transaction.amount,
    };
  }

  // Helper methods

  private async checkFraudScore(userId: string, amount: number, country: string): Promise<number> {
    try {
      const response = await axios.post(
        `${process.env.FRAUD_SERVICE_URL}/score`,
        {
          tx_id: userId,
          amount,
          destination_country: country,
          source_country: 'US',
        },
      );
      return response.data.risk_score || 0;
    } catch (error) {
      // Default to medium score if service unavailable
      return 0.5;
    }
  }

  private async getExchangeRate(country: string): Promise<number> {
    // Fetch from rate feed (could be Soroban contract, API, or cache)
    const rateMap: Record<string, number> = {
      NG: 411.5, // USD/NGN
      GH: 12.5,  // USD/GHS
      KE: 131.2, // USD/KES
    };

    return rateMap[country] || 1.0;
  }
}
