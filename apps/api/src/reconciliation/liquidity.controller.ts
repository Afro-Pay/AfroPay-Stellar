import { Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { LiquidityService } from './liquidity.service';

type AdminRequest = { user: { userId: string; role: string } };

@ApiTags('liquidity')
@ApiBearerAuth('JWT-auth')
@Controller('liquidity')
@UseGuards(JwtAuthGuard)
export class LiquidityController {
  constructor(private readonly liquidity: LiquidityService) {}

  @Get('health')
  @ApiOperation({ summary: 'Get latest reserve health observations by corridor' })
  health(@Query('limit') limit?: string) {
    return this.liquidity.getHealth(Number(limit) || 100);
  }

  @Get('rebalances')
  @ApiOperation({ summary: 'Get recent treasury rebalance actions' })
  rebalances(@Query('limit') limit?: string) {
    return this.liquidity.listRebalances(Number(limit) || 100);
  }

  @Post('check')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Run an immediate admin liquidity check' })
  check(@Request() _request: AdminRequest) {
    return this.liquidity.runHourlyCheck();
  }
}
