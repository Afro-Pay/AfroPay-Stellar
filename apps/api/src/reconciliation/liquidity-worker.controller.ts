import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LiquidityService } from './liquidity.service';

@ApiTags('liquidity-worker')
@Controller('internal/liquidity/rebalances')
export class LiquidityWorkerController {
  constructor(private readonly liquidity: LiquidityService) {}

  @Post(':id/result')
  @ApiOperation({ summary: 'Record a rebalance result from the Rust worker' })
  result(
    @Headers('x-liquidity-worker-token') workerToken: string,
    @Param('id') rebalanceId: string,
    @Body() body: { success: boolean; txHash?: string; error?: string },
  ) {
    if (!process.env.LIQUIDITY_WORKER_TOKEN || workerToken !== process.env.LIQUIDITY_WORKER_TOKEN) {
      throw new UnauthorizedException('Invalid liquidity worker token');
    }
    return this.liquidity.recordExecutionResult(rebalanceId, {
      success: body.success === true,
      txHash: body.txHash,
      error: body.error,
    });
  }
}
