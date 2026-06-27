import { KycService } from './kyc.service';
import { BadRequestException } from '@nestjs/common';

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

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KycService(mockPrisma as any);
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

    it('should calculate daily spent from SUCCESS transactions', async () => {
      mockPrisma.kycRecord.findUnique.mockResolvedValue(null);
      mockPrisma.transaction.findMany.mockResolvedValue([
        { amount: '100' },
        { amount: '250.50' },
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
    it('should sum SUCCESS transactions from today', async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([
        { amount: '50' },
        { amount: '75.50' },
      ]);

      const result = await service.getDailySpent('user-1');

      expect(result).toBe(125.5);
    });

    it('should return 0 for user with no transactions', async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([]);

      const result = await service.getDailySpent('user-1');

      expect(result).toBe(0);
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
