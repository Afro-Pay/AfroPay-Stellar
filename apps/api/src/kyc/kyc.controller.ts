import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { KycService, KycSubmitDto } from './kyc.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

enum DocumentType {
  PASSPORT = 'PASSPORT',
  NATIONAL_ID = 'NATIONAL_ID',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
}

class SubmitKycDto implements KycSubmitDto {
  @IsEnum(DocumentType)
  documentType: string;

  @IsOptional()
  @IsString()
  documentUrl?: string;
}

class UploadUrlDto {
  /** MIME type of the document to upload (e.g. "image/jpeg", "application/pdf"). */
  @IsString()
  @MaxLength(64)
  contentType: string;
}

class ConfirmUploadDto {
  /** S3 object key returned by POST /kyc/upload-url. */
  @IsString()
  @MaxLength(512)
  s3Key: string;

  /** SHA-256 hex digest (64 lowercase hex chars) computed by the client. */
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'sha256 must be exactly 64 hexadecimal characters',
  })
  sha256: string;
}

@Controller('kyc')
export class KycController {
  constructor(private kycService: KycService) {}

  @Post('submit')
  @UseGuards(JwtAuthGuard)
  async submitKyc(@Request() req: any, @Body() dto: SubmitKycDto) {
    const record = await this.kycService.submitKyc(req.user.userId, {
      documentType: dto.documentType,
      documentUrl: dto.documentUrl,
    });

    return {
      id: record.id,
      status: record.status,
      submittedAt: record.submittedAt,
      message: 'KYC submission received. Review typically takes 24 hours.',
    };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Request() req: any) {
    return this.kycService.getKycStatus(req.user.userId);
  }

  /**
   * POST /kyc/upload-url
   *
   * Generates a presigned S3 PUT URL valid for 15 minutes. The client must
   * PUT the document directly to S3 using this URL, then call
   * POST /kyc/confirm-upload with the SHA-256 hash to complete the flow.
   *
   * Responds with:
   *   - uploadUrl   – presigned S3 PUT URL
   *   - s3Key       – object key to pass to confirm-upload
   *   - expiresAt   – ISO-8601 expiry timestamp
   *   - allowedContentTypes
   *   - maxSizeBytes
   */
  @Post('upload-url')
  @UseGuards(JwtAuthGuard)
  async getUploadUrl(@Request() req: any, @Body() dto: UploadUrlDto) {
    const result = await this.kycService.generateUploadUrl(
      req.user.userId,
      dto.contentType,
    );

    return {
      uploadUrl: result.uploadUrl,
      s3Key: result.s3Key,
      expiresAt: result.expiresAt.toISOString(),
      allowedContentTypes: result.allowedContentTypes,
      maxSizeBytes: result.maxSizeBytes,
    };
  }

  /**
   * POST /kyc/confirm-upload
   *
   * After the client uploads the file to S3 using the presigned URL, call this
   * endpoint with the s3Key and the SHA-256 hex digest of the uploaded file.
   * The server re-downloads the file from S3, recomputes the hash, and stores
   * "<s3Key>:<sha256>" in KycRecord.documentRef.
   *
   * Returns:
   *   - documentRef  – the tamper-evident reference stored in the database
   *   - verifiedAt   – ISO-8601 timestamp of verification
   */
  @Post('confirm-upload')
  @UseGuards(JwtAuthGuard)
  async confirmUpload(@Request() req: any, @Body() dto: ConfirmUploadDto) {
    const result = await this.kycService.confirmUpload(
      req.user.userId,
      dto.s3Key,
      dto.sha256,
    );

    return {
      documentRef: result.documentRef,
      verifiedAt: result.verifiedAt.toISOString(),
      message: 'Document verified and reference stored. KYC review will begin shortly.',
    };
  }
}
