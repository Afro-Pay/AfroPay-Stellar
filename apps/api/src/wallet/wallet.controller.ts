import { Controller, Post, Get, Param, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WalletOwnershipGuard } from './wallet-ownership.guard';

@ApiTags('wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post(':id/enable-multisig')
  @UseGuards(WalletOwnershipGuard)
  @ApiOperation({ summary: 'Enable multi-signature on wallet' })
  @ApiResponse({
    status: 200,
    description: 'Multi-signature enabled successfully',
  })
  @ApiResponse({ status: 400, description: 'Wallet not found or already enabled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async enableMultisig(
    @Param('id') walletId: string,
    @Request() req: any,
  ) {
    const userId = req.user.userId;
    const result = await this.walletService.enableMultiSignature(walletId, userId);
    
    return {
      success: true,
      message: 'Multi-signature enabled successfully',
      transactionHash: result.transactionHash,
      cosignerPublicKey: result.cosignerPublicKey,
    };
  }

  @Get('balances')
  // Balance fetches proxy to Stellar Horizon; cap per-user request rate so a
  // single caller can't exhaust Horizon's shared-IP rate limit for everyone.
  @RateLimit({
    keyPrefix: 'wallet:balances',
    limit: 10,
    windowMs: 60_000,
    limitEnv: 'WALLET_BALANCES_RATE_LIMIT_MAX',
    windowMsEnv: 'WALLET_BALANCES_RATE_LIMIT_WINDOW_MS',
  })
  @ApiOperation({ summary: 'Get wallet balances' })
  @ApiQuery({ name: 'afterTxHash', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns wallet balances' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getBalances(
    @Request() req: any,
    @Query('afterTxHash') afterTxHash?: string,
  ) {
    return this.walletService.getBalances(req.user.userId, afterTxHash);
  }
}
