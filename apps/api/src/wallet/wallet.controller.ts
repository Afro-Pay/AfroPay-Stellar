import { Controller, Post, Param, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
}
