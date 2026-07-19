import {
  Controller,
  Get,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Optional,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuditLogService } from './audit.service';

/**
 * Exposes read-only audit log access for security and compliance review.
 * All endpoints require a valid JWT.  In production, restrict further with
 * an admin/roles guard.
 */
@UseGuards(AuthGuard('jwt'))
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
}
