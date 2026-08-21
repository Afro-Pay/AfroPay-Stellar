import { Controller, Get, Query, Res, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { AuditLogService } from './audit.service';

/**
 * Exposes read access to the audit trail for security and compliance review.
 * All endpoints require a valid JWT; the export endpoint additionally
 * requires the ADMIN role.
 */
@ApiTags('audit')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('audit')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /**
   * GET /audit/logs
   *
   * Query string params (all optional):
   *   userId    – filter by user
   *   category  – WALLET | TRANSACTION | AUTH
   *   operation – e.g. WALLET_CREATED, TX_SUCCESS
   *   from      – ISO-8601 start date
   *   to        – ISO-8601 end date
   *   limit     – max rows (default 50, max 200)
   *   offset    – pagination offset (default 0)
   */
  @Get('logs')
  @ApiOperation({ summary: 'Query the audit trail (paginated)' })
  async getLogs(
    @Query('userId') userId?: string,
    @Query('category') category?: string,
    @Query('operation') operation?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    return this.auditLogService.query({
      userId,
      category,
      operation,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit,
      offset,
    });
  }

  /**
   * GET /audit/export
   *
   * Streams the audit trail as newline-delimited JSON (NDJSON) — one JSON
   * object per line, oldest first — for compliance export tooling.
   * Admin-only.
   *
   * Query string params (all optional):
   *   userId – filter by user
   *   from   – ISO-8601 start date
   *   to     – ISO-8601 end date
   */
  @Get('export')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Stream the audit trail as NDJSON for compliance export (admin-only)' })
  async exportLogs(
    @Res() res: Response,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log-export.ndjson"');

    for await (const line of this.auditLogService.exportNdjson({
      userId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    })) {
      res.write(line);
    }

    res.end();
  }
}
