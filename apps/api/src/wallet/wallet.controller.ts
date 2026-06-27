import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { ImportWalletDto, WalletResponseDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post('import')
  @ApiOperation({ summary: 'Import existing wallet' })
  @ApiResponse({
    status: 201,
    description: 'Wallet imported successfully',
    type: WalletResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid wallet data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async importWallet(@Body() importWalletDto: ImportWalletDto) {
    return this.walletService.importWallet(importWalletDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get wallet by ID' })
  @ApiResponse({
    status: 200,
    description: 'Wallet found',
    type: WalletResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getWallet(@Param('id') id: string) {
    return this.walletService.getWallet(id);
  }
}
