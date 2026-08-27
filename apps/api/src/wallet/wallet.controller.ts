import { Controller, Post, Get, Param, Query, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddTrustlineDto } from './dto/add-trustline.dto';

@ApiTags('wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post(':id/enable-multisig')
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
  @ApiOperation({ summary: 'Get wallet balances' })
  @ApiQuery({ name: 'afterTxHash', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns wallet balances' })
  async getBalances(
    @Request() req: any,
    @Query('afterTxHash') afterTxHash?: string,
  ) {
    return this.walletService.getBalances(req.user.userId, afterTxHash);
  }

  @Post('trustline')
  @ApiOperation({ summary: 'Add a trustline for a non-native asset (e.g. USDC, NGN)' })
  @ApiResponse({ status: 201, description: 'Trustline added (or already present)' })
  @ApiResponse({ status: 400, description: 'Invalid asset issuer or trustline could not be established' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async addTrustline(
    @Request() req: any,
    @Body() dto: AddTrustlineDto,
  ) {
    return this.walletService.addTrustline(
      req.user.userId,
      dto.assetCode,
      dto.assetIssuer,
      dto.limit,
    );
  }
}
