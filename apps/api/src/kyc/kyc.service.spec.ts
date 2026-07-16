import { KycService } from './kyc.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('KycService', () => {
  let service: KycService;
  const mockPrisma = {
    kycRecord: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    transaction: {
      findMany: jest.fn(),
    },
  };
  const mockAnchorService = {
    getFxRate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAnchorService.getFxRate.mockResolvedValue({ rate: 1, from: 'USD', to: 'USD' });
    service = new KycService(mockPrisma as any, mockAnchorService as any);
  });

  describe('getKycRecord', () => {
    it('should retrieve KYC record by userId', async () => {
      const mockRecord = {
        id: 'kyc-1',
        userId: 'user-1',
        status: 'APPROVED',
        tier: 'BASIC',
      };

      mockPrisma.kycRecord.findUnique.mockResolvedValue(mockRecord);

      const result = await service.getKycRecord('user-1');

      expect(result).toEqual(mockRecord);
      expect(mockPrisma.kycRecord.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('should return null if KYC record not found', async () => {
      mockPrisma.kycRecord.findUnique.mockResolvedValue(null);

      const result = await service.getKycRecord('user-nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('submitKyc', () => {
    it('should create new KYC record with PENDING status', async () => {
      const mockRecord = {
        id: 'kyc-1',
        userId: 'user-1',
        status: 'PENDING',
        tier: 'NONE',
        documentType: 'PASSPORT',
        submittedAt: new Date(),
      };

      mockPrisma.kycRecord.upsert.mockResolvedValue(mockRecord);

      const result = await service.submitKyc('user-1', {
        documentType: 'PASSPORT',
        documentUrl: 'https://example.com/doc.pdf',
      });

      expect(result.status).toBe('PENDING');
      expect(result.documentType).toBe('PASSPORT');
    });

    it('should reject invalid document type', async () => {
      await expect(
        service.submitKyc('user-1', {
          documentType: 'INVALID_TYPE',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update existing KYC record', async () => {
      const mockRecord = {
        id: 'kyc-1',
        userId: 'user-1',
        status: 'PENDING',
        documentType: 'NATIONAL_ID',
        submittedAt: new Date(),
      };

      mockPrisma.kycRecord.upsert.mockResolvedValue(mockRecord);

      const result = await service.submitKyc('user-1', {
        documentType: 'NATIONAL_ID',
      });

      expect(result.documentType).toBe('NATIONAL_ID');
    });
  });

  describe('getKycStatus', () => {
    it('should return status with NONE tier for new user', async () => {
      mockPrisma.kycRecord.findUnique.mockResolvedValue(null);
      mockPrisma.transaction.findMany.mockResolvedValue([]);

      const result = await service.getKycStatus('user-1');

      expect(result.tier).toBe('NONE');
      expect(result.dailyLimit).toBe(100);
      expect(result.dailyUsed).toBe(0);
      expect(result.remainingToday).toBe(100);
    });

    it('should return status with BASIC tier', async () => {
      const mockRecord = {
        userId: 'user-1',
        status: 'APPROVED',
        tier: 'BASIC',
        submittedAt: new Date(),
        reviewedAt: new Date(),
      };

      mockPrisma.kycRecord.findUnique.mockResolvedValue(mockRecord);
      mockPrisma.transaction.findMany.mockResolvedValue([]);

      const result = await service.getKycStatus('user-1');

      expect(result.tier).toBe('BASIC');
      expect(result.dailyLimit).toBe(5000);
    });

    it('should calculate daily spent from USD transactions', async () => {
      mockPrisma.kycRecord.findUnique.mockResolvedValue(null);
      mockPrisma.transaction.findMany.mockResolvedValue([
        { amount: '100', assetCode: 'USD' },
        { amount: '250.50', assetCode: 'USD' },
      ]);

      const result = await service.getKycStatus('user-1');

      expect(result.dailyUsed).toBe(350.5);
      expect(result.remainingToday).toBe(100 - 350.5);
    });
  });

  describe('updateKycRecord', () => {
    it('should update KYC record status', async () => {
      const mockRecord = {
        id: 'kyc-1',
        userId: 'user-1',
        status: 'APPROVED',
        tier: 'BASIC',
        reviewedAt: new Date(),
      };

      mockPrisma.kycRecord.upsert.mockResolvedValue(mockRecord);

      const result = await service.updateKycRecord('user-1', {
        status: 'APPROVED',
        tier: 'BASIC',
      });

      expect(result.status).toBe('APPROVED');
      expect(result.tier).toBe('BASIC');
    });
  });

  describe('getDailySpent', () => {
    it('should normalize NGN transactions to USD', async () => {
      mockAnchorService.getFxRate.mockResolvedValueOnce({ rate: 0.00065, from: 'NGN', to: 'USD' });
      mockPrisma.transaction.findMany.mockResolvedValue([
        { amount: '50000', assetCode: 'NGN' },
      ]);

      const result = await service.getDailySpent('user-1');

      expect(result).toBeCloseTo(32.5);
      expect(mockAnchorService.getFxRate).toHaveBeenCalledWith('NGN', 'USD');
    });

    it('should normalize mixed asset transactions to USD', async () => {
      mockAnchorService.getFxRate.mockImplementation(async (from: string) => {
        if (from === 'NGN') return { rate: 0.00065, from: 'NGN', to: 'USD' };
        if (from === 'XLM') return { rate: 0.11, from: 'XLM', to: 'USD' };
        return { rate: 1, from: 'USD', to: 'USD' };
      });

      mockPrisma.transaction.findMany.mockResolvedValue([
        { amount: '100', assetCode: 'USD' },
        { amount: '1000', assetCode: 'NGN' },
        { amount: '10', assetCode: 'XLM' },
      ]);

      const result = await service.getDailySpent('user-1');

      expect(result).toBeCloseTo(100 + 0.65 + 1.1);
      expect(mockAnchorService.getFxRate).toHaveBeenCalledWith('NGN', 'USD');
      expect(mockAnchorService.getFxRate).toHaveBeenCalledWith('XLM', 'USD');
    });

    it('should return 0 for user with no transactions', async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([]);

      const result = await service.getDailySpent('user-1');

      expect(result).toBe(0);
    });
  });

  describe('assertWithinDailyLimit', () => {
    it('should allow a transaction under the NONE tier limit', async () => {
      mockPrisma.kycRecord.findUnique.mockResolvedValue({ tier: 'NONE' });
      mockPrisma.transaction.findMany.mockResolvedValue([
        { amount: '20', assetCode: 'USD' },
      ]);

      await expect(service.assertWithinDailyLimit('user-1', 80)).resolves.toBeUndefined();
    });

    it('should block a transaction that exceeds the NONE tier limit', async () => {
      mockPrisma.kycRecord.findUnique.mockResolvedValue({ tier: 'NONE' });
      mockPrisma.transaction.findMany.mockResolvedValue([
        { amount: '20', assetCode: 'USD' },
      ]);

      await expect(service.assertWithinDailyLimit('user-1', 90)).rejects.toThrow(
        new ForbiddenException('Transaction limit exceeded'),
      );
    });
  });

  describe('getLimitForTier', () => {
    it('should return correct limit for each tier', () => {
      expect(service.getLimitForTier('NONE')).toBe(100);
      expect(service.getLimitForTier('BASIC')).toBe(5000);
      expect(service.getLimitForTier('FULL')).toBe(50000);
    });

    it('should default to NONE tier limit for unknown tier', () => {
      expect(service.getLimitForTier('UNKNOWN')).toBe(100);
    });
  });
});
