import { Controller, Post, Get, Put, Delete, Param, Query, UseGuards, Request, BadRequestException, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WalletOwnershipGuard } from './wallet-ownership.guard';
import { Keypair } from 'stellar-sdk';
import {
  AuthenticationResponse,
  RegistrationResponse,
  WebAuthnService,
} from './webauthn.service';

@ApiTags('wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly webAuthnService: WebAuthnService,
  ) {}

  @Post('passkey/registration-options')
  @ApiOperation({ summary: 'Create WebAuthn passkey registration options' })
  async getPasskeyRegistrationOptions(@Request() req: any) {
    return this.webAuthnService.generateRegistrationOptions(
      req.user.userId,
      req.user.username ?? req.user.email ?? req.user.userId,
      req.user.displayName ?? req.user.username ?? req.user.email ?? req.user.userId,
    );
  }

  @Post('passkey/registration')
  @ApiOperation({ summary: 'Verify and register a WebAuthn passkey' })
  async registerPasskey(
    @Request() req: any,
    @Body() body: { response: RegistrationResponse; challenge: string; origin: string; rpId?: string },
  ) {
    if (!body?.response || !body.challenge || !body.origin) {
      throw new BadRequestException('response, challenge, and origin are required');
    }

    const passkey = this.webAuthnService.verifyRegistration(
      req.user.userId,
      body.response,
      body.challenge,
      body.origin,
      body.rpId,
    );

    return { success: true, credentialId: passkey.credentialId };
  }

  @Post('passkey/authentication-options')
  @ApiOperation({ summary: 'Create WebAuthn passkey authentication options' })
  async getPasskeyAuthenticationOptions(@Request() req: any) {
    return this.webAuthnService.generateAuthenticationOptions(req.user.userId);
  }

  @Post('passkey/authentication')
  @ApiOperation({ summary: 'Verify a WebAuthn passkey assertion' })
  async authenticatePasskey(
    @Request() req: any,
    @Body() body: { response: AuthenticationResponse; challenge: string; origin: string; rpId?: string },
  ) {
    if (!body?.response || !body.challenge || !body.origin) {
      throw new BadRequestException('response, challenge, and origin are required');
    }

    const passkey = this.webAuthnService.verifyAuthentication(
      req.user.userId,
      body.response,
      body.challenge,
      body.origin,
      body.rpId,
    );

    return { success: true, credentialId: passkey.credentialId };
  }

  /**
   * Create the first wallet for a user.
   */
  @Post('create')
  @ApiOperation({ summary: 'Create a new Stellar wallet' })
  @ApiResponse({ status: 201, description: 'Wallet created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or wallet limit reached' })
  async createWallet(
    @Request() req: any,
    @Body() body: { alias?: string } = {},
  ) {
    const userId = req.user.userId;
    const { alias } = body;

    // Generate a random Stellar keypair
    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();
    const secretKey = keypair.secret();

    // Create wallet in database (service handles encryption)
    const wallet = await this.walletService.createWallet(userId, publicKey, alias);

    return {
      success: true,
      walletId: wallet.id,
      publicKey,
      // Don't return the secret key here for security
    };
  }

  /**
   * Add an additional wallet for a user.
   */
  @Post('add')
  @ApiOperation({ summary: 'Add an additional wallet' })
  @ApiResponse({ status: 201, description: 'Wallet added successfully' })
  @ApiResponse({ status: 400, description: 'Wallet limit reached' })
  async addWallet(
    @Request() req: any,
    @Body() body: { alias?: string } = {},
  ) {
    const userId = req.user.userId;
    const { alias } = body;

    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();
    const wallet = await this.walletService.createWallet(userId, publicKey, alias);

    return {
      success: true,
      walletId: wallet.id,
      publicKey,
    };
  }

  /**
   * Get all wallets for the current user.
   */
  @Get('list')
  @ApiOperation({ summary: 'Get all wallets' })
  @ApiResponse({ status: 200, description: 'Returns array of wallets' })
  async listWallets(@Request() req: any) {
    const wallets = await this.walletService.getWallets(req.user.userId);
    return wallets.map(w => ({
      id: w.id,
      publicKey: w.publicKey,
      alias: w.alias,
      isDefault: w.isDefault,
      createdAt: w.createdAt,
    }));
  }

  /**
   * Get the public key of the active/default wallet.
   */
  @Get('public-key')
  @ApiOperation({ summary: 'Get default wallet public key' })
  @ApiResponse({ status: 200, description: 'Returns public key' })
  @ApiResponse({ status: 404, description: 'No wallet found' })
  async getPublicKey(@Request() req: any) {
    const result = await this.walletService.getPublicKey(req.user.userId);
    return result;
  }

  /**
   * Set a wallet as the active/default wallet.
   */
  @Post(':id/set-default')
  @UseGuards(WalletOwnershipGuard)
  @ApiOperation({ summary: 'Set wallet as default' })
  @ApiResponse({ status: 200, description: 'Wallet set as default' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async setDefaultWallet(
    @Param('id') walletId: string,
    @Request() req: any,
  ) {
    const wallet = await this.walletService.setDefaultWallet(walletId, req.user.userId);
    return {
      success: true,
      message: 'Wallet set as default',
      wallet: {
        id: wallet.id,
        publicKey: wallet.publicKey,
        alias: wallet.alias,
        isDefault: wallet.isDefault,
      },
    };
  }

  /**
   * Update a wallet's alias.
   */
  @Put(':id/alias')
  @UseGuards(WalletOwnershipGuard)
  @ApiOperation({ summary: 'Update wallet alias' })
  @ApiResponse({ status: 200, description: 'Alias updated' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async updateAlias(
    @Param('id') walletId: string,
    @Request() req: any,
    @Body() body: { alias: string | null },
  ) {
    const { alias } = body;
    const wallet = await this.walletService.updateWalletAlias(walletId, req.user.userId, alias);
    return {
      success: true,
      message: 'Alias updated',
      wallet: {
        id: wallet.id,
        publicKey: wallet.publicKey,
        alias: wallet.alias,
      },
    };
  }

  /**
   * Delete a wallet.
   */
  @Delete(':id')
  @UseGuards(WalletOwnershipGuard)
  @ApiOperation({ summary: 'Delete a wallet' })
  @ApiResponse({ status: 200, description: 'Wallet deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete last wallet' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async deleteWallet(
    @Param('id') walletId: string,
    @Request() req: any,
  ) {
    await this.walletService.deleteWallet(walletId, req.user.userId);
    return {
      success: true,
      message: 'Wallet deleted',
    };
  }

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
  @ApiOperation({ summary: 'Get wallet balances' })
  @ApiQuery({ name: 'afterTxHash', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns wallet balances' })
  async getBalances(
    @Request() req: any,
    @Query('afterTxHash') afterTxHash?: string,
  ) {
    return this.walletService.getBalances(req.user.userId, undefined, afterTxHash);
  }
}

