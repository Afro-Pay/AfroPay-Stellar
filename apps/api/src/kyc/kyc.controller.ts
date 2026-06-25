import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { KycService, KycSubmitDto } from './kyc.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IsEnum, IsOptional, IsString } from 'class-validator';

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
}
