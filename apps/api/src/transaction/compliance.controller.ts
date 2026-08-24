import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { ComplianceActionService } from './compliance-action.service';
import { ComplianceService } from './compliance.service';
import { ComplianceProofDto } from './zkp-verify';
import {
  ComplianceClawbackDto,
  ComplianceFreezeDto,
  ComplianceListQueryDto,
  ComplianceRejectDto,
  ComplianceResultDto,
} from './dto';

type AdminRequest = { user: { userId: string; role: string } };

@ApiTags('compliance')
@ApiBearerAuth('JWT-auth')
@Controller('compliance')
@UseGuards(JwtAuthGuard)
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceActionService,
    private readonly complianceService: ComplianceService,
  ) {}

  // -------------------------------------------------------------------------
  // Zero-knowledge proof verification (issue #271) — any authenticated user.
  // Read-only; reveals no transaction data.
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Freeze / clawback actions (issue #286) — admin only. Each sensitive
  // operation requires the multi-sig approval of 2+ compliance officers
  // before the Rust worker executes it on-chain.
  // -------------------------------------------------------------------------

  @Post('freeze')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary:
      'Freeze an account trustline (SetTrustLineFlags) — requires a second officer approval',
  })
  freeze(@Request() request: AdminRequest, @Body() dto: ComplianceFreezeDto) {
    return this.compliance.requestFreeze(request.user.userId, dto);
  }

  @Post('clawback')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary:
      'Claw back illicit funds from an account to the issuer treasury — requires a second officer approval',
  })
  clawback(@Request() request: AdminRequest, @Body() dto: ComplianceClawbackDto) {
    return this.compliance.requestClawback(request.user.userId, dto);
  }

  @Post('actions/:id/approve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Approve a pending compliance action (multi-sig)' })
  approve(@Request() request: AdminRequest, @Param('id') actionId: string) {
    return this.compliance.approve(request.user.userId, actionId);
  }

  @Post('actions/:id/reject')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Reject a pending compliance action' })
  reject(
    @Request() request: AdminRequest,
    @Param('id') actionId: string,
    @Body() dto: ComplianceRejectDto,
  ) {
    return this.compliance.reject(request.user.userId, actionId, dto?.reason);
  }

  @Post('actions/:id/result')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({
    summary: 'Record the on-chain execution result reported by the worker',
  })
  result(@Param('id') actionId: string, @Body() dto: ComplianceResultDto) {
    return this.compliance.recordExecutionResult(actionId, dto.txHash, dto.outcome);
  }

  @Get('actions')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'List compliance actions (optionally filtered by status)' })
  list(@Query() query: ComplianceListQueryDto) {
    return this.compliance.list(query);
  }

  @Get('actions/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Get a compliance action with its approvals' })
  detail(@Param('id') actionId: string) {
    return this.compliance.getAction(actionId);
  }
}
