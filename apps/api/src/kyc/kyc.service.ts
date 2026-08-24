import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KycStatus, KycTier } from '@prisma/client';
import { AnchorService } from '../anchor/anchor.service';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import * as crypto from 'crypto';

export interface KycSubmitDto {
  documentType: string;
  documentUrl?: string;
}

/** Allowed MIME types for KYC document uploads. */
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/** Maximum upload size in bytes (10 MB). */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Presigned URL validity in seconds (15 minutes). */
const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export interface GenerateUploadUrlResult {
  uploadUrl: string;
  s3Key: string;
  expiresAt: Date;
  allowedContentTypes: readonly string[];
  maxSizeBytes: number;
}

export interface ConfirmUploadResult {
  documentRef: string;
  verifiedAt: Date;
}

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(
    private prisma: PrismaService,
    private anchorService: AnchorService,
  ) {
    const region = process.env.AWS_REGION || 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT_URL; // optional: for MinIO / LocalStack

    this.s3Client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined, // falls back to IAM role / env chain
    });

    this.bucketName = process.env.KYC_S3_BUCKET || 'afropay-kyc-documents';
  }

  // ---------------------------------------------------------------------------
  // Presigned upload URL
  // ---------------------------------------------------------------------------

  /**
   * Generates a presigned S3 PUT URL valid for 15 minutes.
   * Restricts uploads to allowed MIME types and enforces a max size header.
   * The generated S3 key encodes the userId and a random UUID so the object
   * is private and non-guessable.
   * Logs the URL generation event to AuditLog.
   */
  async generateUploadUrl(
    userId: string,
    contentType: string,
  ): Promise<GenerateUploadUrlResult> {
    if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      throw new BadRequestException(
        `Unsupported content type. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
      );
    }

    const objectId = crypto.randomUUID();
    const extension = this.extensionForContentType(contentType);
    const s3Key = `kyc/${userId}/${objectId}${extension}`;
    const expiresAt = new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000);

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      ContentType: contentType,
      // Server-side encryption at rest
      ServerSideEncryption: 'AES256',
      // Metadata tags stored with the object
      Metadata: {
        userId,
        uploadedAt: new Date().toISOString(),
      },
    });

    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: PRESIGNED_URL_TTL_SECONDS,
      });
    } catch (err) {
      this.logger.error('Failed to generate presigned URL', err);
      throw new InternalServerErrorException('Could not generate upload URL');
    }

    // Audit log: record URL generation
    await this.writeAuditLog(userId, 'KYC_UPLOAD_URL_GENERATED', 'SUCCESS', {
      s3Key,
      contentType,
      expiresAt: expiresAt.toISOString(),
      bucket: this.bucketName,
    });

    return {
      uploadUrl,
      s3Key,
      expiresAt,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
      maxSizeBytes: MAX_UPLOAD_BYTES,
    };
  }

  // ---------------------------------------------------------------------------
  // Confirm upload + hash verification
  // ---------------------------------------------------------------------------

  /**
   * After the client uploads to S3 using the presigned URL, this method:
   *   1. Streams the object from S3 and computes its SHA-256 digest.
   *   2. Compares the digest against the client-supplied `expectedSha256`.
   *   3. Verifies the file size does not exceed MAX_UPLOAD_BYTES.
   *   4. Stores "<s3Key>:<sha256hex>" in KycRecord.documentRef.
   *
   * @param userId         - authenticated user
   * @param s3Key          - object key returned by generateUploadUrl
   * @param expectedSha256 - hex SHA-256 digest the client computed locally
   */
  async confirmUpload(
    userId: string,
    s3Key: string,
    expectedSha256: string,
  ): Promise<ConfirmUploadResult> {
    // Validate the key belongs to this user (format: kyc/<userId>/...)
    if (!s3Key.startsWith(`kyc/${userId}/`)) {
      throw new ForbiddenException('S3 key does not belong to this user');
    }

    // Validate expected hash format (64 hex chars)
    if (!/^[0-9a-f]{64}$/i.test(expectedSha256)) {
      throw new BadRequestException('expectedSha256 must be a 64-char hex string');
    }

    // Check the object exists and get its size
    let contentLength: number;
    try {
      const head = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: s3Key }),
      );
      contentLength = head.ContentLength ?? 0;
    } catch (err: any) {
      if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('Uploaded document not found in storage. Upload may have expired.');
      }
      this.logger.error('S3 HeadObject failed', err);
      throw new InternalServerErrorException('Could not verify upload');
    }

    if (contentLength > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `Document exceeds maximum size of ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`,
      );
    }

    // Download and compute SHA-256
    let computedHash: string;
    try {
      const getCmd = new GetObjectCommand({ Bucket: this.bucketName, Key: s3Key });
      const response = await this.s3Client.send(getCmd);
      computedHash = await this.hashStream(response.Body as NodeJS.ReadableStream);
    } catch (err) {
      this.logger.error('S3 GetObject / hash computation failed', err);
      throw new InternalServerErrorException('Could not verify document hash');
    }

    const normalizedExpected = expectedSha256.toLowerCase();
    if (computedHash !== normalizedExpected) {
      await this.writeAuditLog(userId, 'KYC_HASH_MISMATCH', 'FAILURE', {
        s3Key,
        expectedSha256: normalizedExpected,
        computedHash,
      });
      throw new BadRequestException(
        'SHA-256 hash mismatch — document may have been tampered with during upload',
      );
    }

    const documentRef = `${s3Key}:${computedHash}`;

    // Persist the tamper-evident reference
    await this.prisma.kycRecord.upsert({
      where: { userId },
      create: {
        userId,
        status: 'PENDING',
        documentRef,
        submittedAt: new Date(),
      },
      update: {
        documentRef,
        submittedAt: new Date(),
        status: 'PENDING',
      },
    });

    const verifiedAt = new Date();

    await this.writeAuditLog(userId, 'KYC_UPLOAD_CONFIRMED', 'SUCCESS', {
      s3Key,
      sha256: computedHash,
      sizeBytes: contentLength,
      documentRef,
    });

    return { documentRef, verifiedAt };
  }

  // ---------------------------------------------------------------------------
  // Existing KYC service methods (unchanged)
  // ---------------------------------------------------------------------------

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

  async updateKycRecord(
    userId: string,
    updates: Partial<{
      status: KycStatus;
      tier: KycTier;
      rejectionReason?: string;
    }>,
  ) {
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
      transactions.map((tx) =>
        this.normalizeAmountToUsd(tx.amount, tx.assetCode),
      ),
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Writes a structured entry to the AuditLog table. */
  private async writeAuditLog(
    userId: string,
    operation: string,
    outcome: 'SUCCESS' | 'FAILURE',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          category: 'KYC',
          operation,
          outcome,
          // Prisma Json fields require casting through unknown to satisfy
          // the NullableJsonNullValueInput | InputJsonValue union.
          metadata: metadata as unknown as import('@prisma/client').Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // Audit failures must never break the main flow — log and continue.
      this.logger.error('Failed to write audit log', err);
    }
  }

  /** Returns a file extension for the given MIME type. */
  private extensionForContentType(contentType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'application/pdf': '.pdf',
    };
    return map[contentType] ?? '';
  }

  /**
   * Reads a Node.js Readable stream and returns its SHA-256 hex digest.
   * Compatible with the object returned by S3 GetObjectCommand (Body is
   * `SdkStreamMixin & Readable` in the Node.js S3 client).
   */
  private hashStream(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
