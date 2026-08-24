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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { ComplianceActionService } from './compliance-action.service';
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
@UseGuards(JwtAuthGuard, AdminGuard)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceActionService) {}

  @Post('freeze')
  @ApiOperation({
    summary:
      'Freeze an account trustline (SetTrustLineFlags) — requires a second officer approval',
  })
  freeze(@Request() request: AdminRequest, @Body() dto: ComplianceFreezeDto) {
    return this.compliance.requestFreeze(request.user.userId, dto);
  }

  @Post('clawback')
  @ApiOperation({
    summary:
      'Claw back illicit funds from an account to the issuer treasury — requires a second officer approval',
  })
  clawback(@Request() request: AdminRequest, @Body() dto: ComplianceClawbackDto) {
    return this.compliance.requestClawback(request.user.userId, dto);
  }

  @Post('actions/:id/approve')
  @ApiOperation({ summary: 'Approve a pending compliance action (multi-sig)' })
  approve(@Request() request: AdminRequest, @Param('id') actionId: string) {
    return this.compliance.approve(request.user.userId, actionId);
  }

  @Post('actions/:id/reject')
  @ApiOperation({ summary: 'Reject a pending compliance action' })
  reject(
    @Request() request: AdminRequest,
    @Param('id') actionId: string,
    @Body() dto: ComplianceRejectDto,
  ) {
    return this.compliance.reject(request.user.userId, actionId, dto?.reason);
  }

  @Post('actions/:id/result')
  @ApiOperation({
    summary: 'Record the on-chain execution result reported by the worker',
  })
  result(@Param('id') actionId: string, @Body() dto: ComplianceResultDto) {
    return this.compliance.recordExecutionResult(actionId, dto.txHash, dto.outcome);
  }

  @Get('actions')
  @ApiOperation({ summary: 'List compliance actions (optionally filtered by status)' })
  list(@Query() query: ComplianceListQueryDto) {
    return this.compliance.list(query);
  }

  @Get('actions/:id')
  @ApiOperation({ summary: 'Get a compliance action with its approvals' })
  detail(@Param('id') actionId: string) {
    return this.compliance.getAction(actionId);
  }
}
