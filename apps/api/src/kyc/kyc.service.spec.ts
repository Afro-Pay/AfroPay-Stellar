import { KycService } from './kyc.service';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  kycRecord: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  transaction: {
    findMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const mockAnchorService = {
  getFxRate: jest.fn(),
};

// Mock S3Client and getSignedUrl at the module level so they are injectable.
const mockS3Send = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
    PutObjectCommand: actual.PutObjectCommand,
    GetObjectCommand: actual.GetObjectCommand,
    HeadObjectCommand: actual.HeadObjectCommand,
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

// ---------------------------------------------------------------------------
// Helper to create a readable stream from a Buffer
// ---------------------------------------------------------------------------

function bufferToStream(buf: Buffer): Readable {
  const stream = new Readable();
  stream.push(buf);
  stream.push(null);
  return stream;
}

function sha256hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('KycService', () => {
  let service: KycService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAnchorService.getFxRate.mockResolvedValue({ rate: 1, from: 'USD', to: 'USD' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    service = new KycService(mockPrisma as any, mockAnchorService as any);
  });

  // -------------------------------------------------------------------------
  // Existing tests (preserved)
  // -------------------------------------------------------------------------

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
      expect(result.remainingToday).toBe(0);
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

  // -------------------------------------------------------------------------
  // NEW: generateUploadUrl tests
  // -------------------------------------------------------------------------

  describe('generateUploadUrl', () => {
    const PRESIGNED_URL = 'https://s3.amazonaws.com/bucket/kyc/user-1/abc?X-Amz-Signature=sig';

    beforeEach(() => {
      mockGetSignedUrl.mockResolvedValue(PRESIGNED_URL);
    });

    it('should return a presigned URL, s3Key, and expiry for a valid content type', async () => {
      const result = await service.generateUploadUrl('user-1', 'image/jpeg');

      expect(result.uploadUrl).toBe(PRESIGNED_URL);
      expect(result.s3Key).toMatch(/^kyc\/user-1\//);
      expect(result.s3Key).toMatch(/\.jpg$/);
      expect(result.expiresAt).toBeInstanceOf(Date);
      // Expiry should be ~15 minutes from now
      const diffSeconds = (result.expiresAt.getTime() - Date.now()) / 1000;
      expect(diffSeconds).toBeGreaterThan(14 * 60);
      expect(diffSeconds).toBeLessThan(16 * 60);
    });

    it('should return correct extension for each allowed content type', async () => {
      const cases: Array<[string, string]> = [
        ['image/jpeg', '.jpg'],
        ['image/png', '.png'],
        ['image/webp', '.webp'],
        ['application/pdf', '.pdf'],
      ];

      for (const [ct, ext] of cases) {
        const result = await service.generateUploadUrl('user-1', ct);
        expect(result.s3Key).toMatch(new RegExp(`\\${ext}$`));
      }
    });

    it('should include allowed content types and max size in the response', async () => {
      const result = await service.generateUploadUrl('user-1', 'image/png');

      expect(result.allowedContentTypes).toContain('image/jpeg');
      expect(result.allowedContentTypes).toContain('application/pdf');
      expect(result.maxSizeBytes).toBe(10 * 1024 * 1024);
    });

    it('should reject an unsupported content type', async () => {
      await expect(
        service.generateUploadUrl('user-1', 'text/plain'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.generateUploadUrl('user-1', 'image/gif'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should write a KYC_UPLOAD_URL_GENERATED audit log entry', async () => {
      await service.generateUploadUrl('user-1', 'image/jpeg');

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            category: 'KYC',
            operation: 'KYC_UPLOAD_URL_GENERATED',
            outcome: 'SUCCESS',
          }),
        }),
      );
    });

    it('should throw InternalServerErrorException when getSignedUrl fails', async () => {
      mockGetSignedUrl.mockRejectedValue(new Error('AWS error'));

      await expect(
        service.generateUploadUrl('user-1', 'image/jpeg'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should generate unique s3Keys for successive calls', async () => {
      const [r1, r2] = await Promise.all([
        service.generateUploadUrl('user-1', 'image/jpeg'),
        service.generateUploadUrl('user-1', 'image/jpeg'),
      ]);

      expect(r1.s3Key).not.toBe(r2.s3Key);
    });
  });

  // -------------------------------------------------------------------------
  // NEW: confirmUpload tests
  // -------------------------------------------------------------------------

  describe('confirmUpload', () => {
    const USER_ID = 'user-42';
    const FILE_CONTENT = Buffer.from('fake-document-bytes');
    const CORRECT_HASH = sha256hex(FILE_CONTENT);
    const VALID_S3_KEY = `kyc/${USER_ID}/some-uuid.jpg`;

    beforeEach(() => {
      // Default HeadObject: file exists, 1 KB
      mockS3Send.mockImplementation(async (command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === 'HeadObjectCommand') {
          return { ContentLength: FILE_CONTENT.length };
        }
        if (cmdName === 'GetObjectCommand') {
          return { Body: bufferToStream(FILE_CONTENT) };
        }
      });

      mockPrisma.kycRecord.upsert.mockResolvedValue({
        userId: USER_ID,
        documentRef: `${VALID_S3_KEY}:${CORRECT_HASH}`,
      });
    });

    it('should store documentRef as "<s3Key>:<sha256>" when hash matches', async () => {
      const result = await service.confirmUpload(USER_ID, VALID_S3_KEY, CORRECT_HASH);

      expect(result.documentRef).toBe(`${VALID_S3_KEY}:${CORRECT_HASH}`);
      expect(result.verifiedAt).toBeInstanceOf(Date);
    });

    it('should persist documentRef via prisma.kycRecord.upsert', async () => {
      await service.confirmUpload(USER_ID, VALID_S3_KEY, CORRECT_HASH);

      expect(mockPrisma.kycRecord.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID },
          update: expect.objectContaining({
            documentRef: `${VALID_S3_KEY}:${CORRECT_HASH}`,
            status: 'PENDING',
          }),
        }),
      );
    });

    it('should write a KYC_UPLOAD_CONFIRMED audit log on success', async () => {
      await service.confirmUpload(USER_ID, VALID_S3_KEY, CORRECT_HASH);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_ID,
            operation: 'KYC_UPLOAD_CONFIRMED',
            outcome: 'SUCCESS',
          }),
        }),
      );
    });

    it('should throw BadRequestException and log KYC_HASH_MISMATCH when hashes differ', async () => {
      const wrongHash = CORRECT_HASH.replace(/^./, CORRECT_HASH[0] === 'a' ? 'b' : 'a');

      await expect(
        service.confirmUpload(USER_ID, VALID_S3_KEY, wrongHash),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operation: 'KYC_HASH_MISMATCH',
            outcome: 'FAILURE',
          }),
        }),
      );
    });

    it('should throw ForbiddenException when s3Key does not belong to the user', async () => {
      const foreignKey = `kyc/other-user/some-uuid.jpg`;

      await expect(
        service.confirmUpload(USER_ID, foreignKey, CORRECT_HASH),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException for an invalid sha256 format', async () => {
      await expect(
        service.confirmUpload(USER_ID, VALID_S3_KEY, 'not-a-sha256'),
      ).rejects.toThrow(BadRequestException);

      // wrong length
      await expect(
        service.confirmUpload(USER_ID, VALID_S3_KEY, 'abc123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when the S3 object does not exist', async () => {
      mockS3Send.mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NotFound' }));

      await expect(
        service.confirmUpload(USER_ID, VALID_S3_KEY, CORRECT_HASH),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when uploaded file exceeds max size', async () => {
      const TEN_MB_PLUS_ONE = 10 * 1024 * 1024 + 1;
      mockS3Send.mockResolvedValue({ ContentLength: TEN_MB_PLUS_ONE });

      await expect(
        service.confirmUpload(USER_ID, VALID_S3_KEY, CORRECT_HASH),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException on unexpected S3 error during HeadObject', async () => {
      mockS3Send.mockRejectedValue(new Error('unexpected'));

      await expect(
        service.confirmUpload(USER_ID, VALID_S3_KEY, CORRECT_HASH),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle uppercase hex in expectedSha256 (case-insensitive comparison)', async () => {
      const upperHash = CORRECT_HASH.toUpperCase();

      const result = await service.confirmUpload(USER_ID, VALID_S3_KEY, upperHash);

      expect(result.documentRef).toContain(CORRECT_HASH);
    });

    it('should work with PDF content type key', async () => {
      const pdfKey = `kyc/${USER_ID}/doc.pdf`;
      const result = await service.confirmUpload(USER_ID, pdfKey, CORRECT_HASH);

      expect(result.documentRef).toBe(`${pdfKey}:${CORRECT_HASH}`);
    });
  });
});
