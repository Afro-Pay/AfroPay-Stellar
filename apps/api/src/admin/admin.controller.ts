import { Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminComplianceService } from './admin.service';

type AdminRequest = { user: { userId: string; role: string } };

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin/users')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly compliance: AdminComplianceService) {}

  @Post(':id/erase')
  @ApiOperation({ summary: 'Anonymise a user while retaining financial records' })
  erase(@Param('id') userId: string, @Request() request: AdminRequest) {
    return this.compliance.eraseUser(userId, request.user.userId);
  }

  @Get(':id/sar-export')
  @ApiOperation({ summary: 'Export flagged transactions and audit history for SAR review' })
  exportSar(@Param('id') userId: string, @Request() request: AdminRequest) {
    return this.compliance.exportSar(userId, request.user.userId);
  }
}
