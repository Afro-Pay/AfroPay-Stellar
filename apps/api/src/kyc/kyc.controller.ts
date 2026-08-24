import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({
    description: 'Type of identity document',
    enum: DocumentType,
    example: DocumentType.PASSPORT,
  })
  @IsEnum(DocumentType)
  documentType: string;

  @ApiProperty({
    description: 'URL or reference to the uploaded document',
    example: 's3://bucket/kyc-docs/user-123/passport.pdf',
    required: false,
  })
  @IsOptional()
  @IsString()
  documentUrl?: string;
}

class UploadUrlDto {
  @ApiProperty({
    description: 'MIME type of the document to upload',
    example: 'image/jpeg',
    examples: ['image/jpeg', 'image/png', 'application/pdf'],
  })
  @IsString()
  @MaxLength(64)
  contentType: string;
}

class ConfirmUploadDto {
  @ApiProperty({
    description: 'S3 object key returned by POST /kyc/upload-url',
    example: 'kyc-docs/user-123/doc-uuid.jpg',
  })
  @IsString()
  @MaxLength(512)
  s3Key: string;

  @ApiProperty({
    description: 'SHA-256 hex digest computed by the client',
    example: 'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
    pattern: '^[0-9a-fA-F]{64}$',
  })
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'sha256 must be exactly 64 hexadecimal characters',
  })
  sha256: string;
}

@ApiTags('kyc')
@Controller('kyc')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class KycController {
  constructor(private kycService: KycService) {}

  @Post('submit')
  @ApiOperation({ summary: 'Submit KYC documentation for verification' })
  @ApiResponse({ status: 201, description: 'KYC submission received' })
  @ApiResponse({ status: 400, description: 'Invalid document data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
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
  @ApiOperation({ summary: 'Get current KYC verification status' })
  @ApiResponse({ status: 200, description: 'KYC status retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No KYC record found' })
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
  @ApiOperation({ 
    summary: 'Generate presigned S3 upload URL for KYC document',
    description: 'Returns a presigned URL valid for 15 minutes to upload document directly to S3'
  })
  @ApiResponse({ status: 201, description: 'Presigned URL generated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid content type' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
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
  @ApiOperation({ 
    summary: 'Confirm document upload with hash verification',
    description: 'Verifies SHA-256 hash of uploaded document and stores reference'
  })
  @ApiResponse({ status: 201, description: 'Document verified and stored' })
  @ApiResponse({ status: 400, description: 'Hash mismatch or invalid data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Document not found in S3' })
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
