import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';
import { ComplianceProofDto } from './zkp-verify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('compliance')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('limits')
  @ApiOperation({ summary: 'Get AML compliance thresholds (read-only)' })
  @ApiResponse({ status: 200, description: 'Configured compliance limits' })
  getLimits() {
    return this.complianceService.getComplianceLimits();
  }

  @Post('verify')
  @ApiOperation({
    summary:
      'Verify a zero-knowledge compliance proof (read-only, reveals no transaction data)',
  })
  @ApiResponse({ status: 200, description: 'Verification result' })
  @ApiResponse({ status: 400, description: 'Malformed proof or missing parameters' })
  verify(
    @Body()
    body: { commitment: string; max_limit: number; proof: ComplianceProofDto },
  ) {
    return this.complianceService.verifyComplianceProof(
      body.commitment,
      body.max_limit,
      body.proof,
    );
  }
}
