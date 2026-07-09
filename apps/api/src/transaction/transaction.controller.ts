import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('transaction')
export class TransactionController {
  constructor(private transactionService: TransactionService) {}

  /**
   * POST /transaction/initiate
   * Initiate a cross-border remittance transfer
   */
  @Post('initiate')
  @UseGuards(JwtAuthGuard)
  async initiateTransfer(
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.transactionService.initiateTransfer(req.user.id, dto);
  }

  /**
   * GET /transaction/:id
   * Get transaction status
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getTransaction(@Param('id') transactionId: string) {
    return this.transactionService.getTransactionStatus(transactionId);
  }

  /**
   * GET /transaction
   * List user's transactions
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getUserTransactions(
    @Request() req: any,
    @Query('skip') skip: number = 0,
    @Query('take') take: number = 10,
  ) {
    return this.transactionService.getUserTransactions(req.user.id, skip, take);
  }

  /**
   * POST /transaction/:id/claim-refund
   * Claim refund after timeout or delivery failure
   */
  @Post(':id/claim-refund')
  @UseGuards(JwtAuthGuard)
  async claimRefund(
    @Request() req: any,
    @Param('id') transactionId: string,
  ) {
    return this.transactionService.claimRefund(req.user.id, transactionId);
  }

  /**
   * POST /oracle/submit-attestation
   * Oracle submits delivery attestation (admin only)
   */
  @Post('oracle/submit-attestation')
  @UseGuards(JwtAuthGuard)
  async submitAttestation(@Body() attestation: any) {
    // In production, verify oracle address via JWT or API key
    return this.transactionService.submitOracleAttestation('oracle_address', attestation);
  }
}
