import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KycStatus, KycTier } from '@prisma/client';
import { AnchorService } from '../anchor/anchor.service';

export interface KycSubmitDto {
  documentType: string;
  documentUrl?: string;
}

@Injectable()
export class KycService {
  constructor(
    private prisma: PrismaService,
    private anchorService: AnchorService,
  ) {}

  async getKycRecord(userId: string) {
    return this.prisma.kycRecord.findUnique({
      where: { userId },
    });
  }

  async submitKyc(userId: string, data: KycSubmitDto) {
    // Validate document type
    const validDocTypes = ['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE'];
    if (data.documentType && !validDocTypes.includes(data.documentType)) {
      throw new BadRequestException('Invalid document type');
    }

    return this.prisma.kycRecord.upsert({
      where: { userId },
      create: {
        userId,
        status: 'PENDING',
        documentType: data.documentType,
        documentRef: data.documentUrl || null,
        submittedAt: new Date(),
      },
      update: {
        status: 'PENDING',
        documentType: data.documentType,
        documentRef: data.documentUrl || null,
        submittedAt: new Date(),
      },
    });
  }

  async getKycStatus(userId: string) {
    const record = await this.getKycRecord(userId);
    const dailySpent = await this.getDailySpent(userId);
    const tier = record?.tier || 'NONE';
    const limit = this.getLimitForTier(tier);

    return {
      status: record?.status || 'PENDING',
      tier,
      submittedAt: record?.submittedAt,
      reviewedAt: record?.reviewedAt,
      rejectionReason: record?.rejectionReason,
      dailyLimit: limit,
      dailyUsed: dailySpent,
      remainingToday: Math.max(0, limit - dailySpent),
    };
  }

  async updateKycRecord(userId: string, updates: Partial<{
    status: KycStatus;
    tier: KycTier;
    rejectionReason?: string;
  }>) {
    return this.prisma.kycRecord.upsert({
      where: { userId },
      create: {
        userId,
        ...updates,
        reviewedAt: new Date(),
      },
      update: {
        ...updates,
        reviewedAt: new Date(),
      },
    });
  }

  async getDailySpent(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        status: 'SUCCESS',
        createdAt: {
          gte: today,
        },
      },
    });

    const normalizedValues = await Promise.all(
      transactions.map((tx) => this.normalizeAmountToUsd(tx.amount, tx.assetCode)),
    );

    return normalizedValues.reduce((sum, value) => sum + value, 0);
  }

  async normalizeAmountToUsd(amount: string, assetCode: string): Promise<number> {
    const numericAmount = parseFloat(amount);
    if (Number.isNaN(numericAmount) || numericAmount < 0) {
      throw new BadRequestException('Invalid amount');
    }

    if (!assetCode || typeof assetCode !== 'string') {
      throw new BadRequestException('Asset code is required');
    }

    const normalizedAsset = assetCode.trim().toUpperCase();
    if (normalizedAsset === 'USD' || normalizedAsset === 'USDC') {
      return numericAmount;
    }

    const fxRate = await this.anchorService.getFxRate(normalizedAsset, 'USD');
    if (!fxRate?.rate) {
      throw new BadRequestException(
        `Unable to normalize ${normalizedAsset} to USD for KYC calculation`,
      );
    }

    return numericAmount * fxRate.rate;
  }

  async assertWithinDailyLimit(userId: string, amountUsd: number): Promise<void> {
    const dailySpent = await this.getDailySpent(userId);
    const record = await this.getKycRecord(userId);
    const tier = record?.tier || 'NONE';
    const limit = this.getLimitForTier(tier);

    if (dailySpent + amountUsd > limit) {
      throw new ForbiddenException('Transaction limit exceeded');
    }
  }

  getLimitForTier(tier: KycTier | string): number {
    const limits: Record<string, number> = {
      NONE: 100,
      BASIC: 5000,
      FULL: 50000,
    };
    return limits[tier] || 100;
  }
}
