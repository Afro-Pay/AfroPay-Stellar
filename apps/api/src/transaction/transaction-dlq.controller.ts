import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransactionDlqService } from './transaction-dlq.service';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin/dlq')
@UseGuards(JwtAuthGuard)
export class TransactionDlqController {
  constructor(private readonly dlqService: TransactionDlqService) {}

  @Get()
  @ApiOperation({ summary: 'List failed transaction jobs held in the DLQ' })
  list(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.dlqService.list({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':jobId/replay')
  @ApiOperation({ summary: 'Replay a failed transaction job from the DLQ' })
  replay(@Param('jobId') jobId: string) {
    return this.dlqService.replay(jobId);
  }
}
