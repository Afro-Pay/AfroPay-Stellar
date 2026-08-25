import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

/** Payload embedded in the one-time webview session JWT. */
interface Sep24SessionPayload {
  /** Sep24Transaction.id */
  txId: string;
  /** Stellar public key from the SEP-10 token */
  account: string;
  /** "deposit" | "withdraw" */
  kind: string;
  /** ISO-8601 issued-at */
  iat: number;
  /** ISO-8601 expiration */
  exp: number;
}

/** Base URL used to construct the interactive webview URL. */
const INTERACTIVE_BASE_URL =
  process.env.SEP24_INTERACTIVE_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'http://localhost:3000';

/** Session lifetime in seconds (default 30 min). */
const SESSION_TTL_SECONDS = Number(process.env.SEP24_SESSION_TTL_SECONDS ?? 1800);

@Injectable()
export class Sep24Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ---------------------------------------------------------------------------
  // SEP-24 /info
  // ---------------------------------------------------------------------------

  /**
   * Returns anchor capabilities and supported assets in the SEP-24 standard
   * format. This is a simplified version — production anchors advertise
   * fee structures, limits, and authentication requirements here.
   */
  getSep24Info() {
    return {
      deposit: {
        USDC: {
          enabled: true,
          min_amount: 1,
          max_amount: 10000,
          fee_fixed: 0,
          fee_percent: 0.1,
        },
        NGN: {
          enabled: true,
          min_amount: 500,
          max_amount: 5000000,
          fee_fixed: 100,
          fee_percent: 0,
        },
      },
      withdraw: {
        USDC: {
          enabled: true,
          min_amount: 1,
          max_amount: 10000,
          fee_fixed: 0,
          fee_percent: 0.1,
        },
        NGN: {
          enabled: true,
          min_amount: 500,
          max_amount: 5000000,
          fee_fixed: 100,
          fee_percent: 0,
        },
      },
      fee: { enabled: false },
      features: { account_creation: false, claimable_balances: false },
    };
  }

  // ---------------------------------------------------------------------------
  // Interactive session creation (deposit / withdraw)
  // ---------------------------------------------------------------------------

  /**
   * Creates a new interactive SEP-24 transaction session and returns the
   * SEP-24 compliant JSON envelope containing the interactive URL.
   */
  async createInteractiveSession(
    account: string,
    kind: 'deposit' | 'withdraw',
    assetCode: string,
    assetIssuer?: string,
    amount?: string,
  ) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

    // Generate a one-time session token signed as a JWT
    const txId = randomBytes(16).toString('hex');
    const sessionPayload: Omit<Sep24SessionPayload, 'iat' | 'exp'> = {
      txId,
      account,
      kind,
    };
    const sessionToken = this.jwt.sign(sessionPayload, {
      expiresIn: SESSION_TTL_SECONDS,
    });

    // Persist the initial transaction record in PostgreSQL
    const tx = await this.prisma.sep24Transaction.create({
      data: {
        kind,
        stellarAccount: account,
        assetCode,
        assetIssuer: assetIssuer ?? null,
        amount: amount ?? null,
        sessionToken,
        sessionExpiresAt: expiresAt,
      },
    });

    // Construct the interactive URL the wallet will open in a webview
    const interactiveUrl = new URL('/anchor/interactive', INTERACTIVE_BASE_URL);
    interactiveUrl.searchParams.set('token', sessionToken);

    return {
      type: 'interactive_customer_info_needed',
      url: interactiveUrl.toString(),
      id: tx.id,
    };
  }

  // ---------------------------------------------------------------------------
  // Webview session verification
  // ---------------------------------------------------------------------------

  /**
   * Validates the session JWT and returns the active transaction data for the
   * frontend webview. Called by GET /sep24/interactive/session.
   */
  async getSessionData(token: string) {
    const payload = this.verifySessionToken(token);

    const tx = await this.prisma.sep24Transaction.findFirst({
      where: { sessionToken: token },
    });

    if (!tx) {
      throw new NotFoundException('Interactive session not found');
    }

    if (tx.status !== 'incomplete') {
      throw new BadRequestException('Session has already been completed or expired');
    }

    if (new Date() > tx.sessionExpiresAt) {
      // Mark the transaction as expired
      await this.prisma.sep24Transaction.update({
        where: { id: tx.id },
        data: { status: 'expired', message: 'Session expired' },
      });
      throw new BadRequestException('Interactive session has expired');
    }

    return {
      id: tx.id,
      kind: tx.kind,
      stellarAccount: tx.stellarAccount,
      assetCode: tx.assetCode,
      assetIssuer: tx.assetIssuer,
      amount: tx.amount,
      status: tx.status,
    };
  }

  // ---------------------------------------------------------------------------
  // Webview form submission (confirm)
  // ---------------------------------------------------------------------------

  /**
   * Processes the user's webview form submission. Records KYC data and payment
   * method, then transitions the transaction to `pending_user_transfer_start`.
   */
  async confirmInteractiveSession(
    token: string,
    kycData: Record<string, unknown>,
    paymentMethod: string,
    amount?: string,
  ) {
    const payload = this.verifySessionToken(token);

    const tx = await this.prisma.sep24Transaction.findFirst({
      where: { sessionToken: token },
    });

    if (!tx) {
      throw new NotFoundException('Interactive session not found');
    }

    if (tx.status !== 'incomplete') {
      throw new BadRequestException('Session has already been completed or expired');
    }

    if (new Date() > tx.sessionExpiresAt) {
      await this.prisma.sep24Transaction.update({
        where: { id: tx.id },
        data: { status: 'expired', message: 'Session expired' },
      });
      throw new BadRequestException('Interactive session has expired');
    }

    // Generate a deposit memo so the user can route their on-chain payment
    const memo = randomBytes(8).toString('hex');

    const updated = await this.prisma.sep24Transaction.update({
      where: { id: tx.id },
      data: {
        status: 'pending_user_transfer_start',
        kycData: kycData as any,
        paymentMethod,
        amount: amount ?? tx.amount,
        memo,
        memoType: 'text',
        message: 'KYC data received. Waiting for on-chain transfer.',
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      kind: updated.kind,
      assetCode: updated.assetCode,
      amount: updated.amount,
      memo: updated.memo,
      memoType: updated.memoType,
      message: updated.message,
    };
  }

  // ---------------------------------------------------------------------------
  // Transaction queries (GET /sep24/transaction, GET /sep24/transactions)
  // ---------------------------------------------------------------------------

  /**
   * Returns a single SEP-24 transaction by ID, formatted per the SEP-24
   * specification's GET /transaction response.
   */
  async getTransactionById(id: string, account: string) {
    const tx = await this.prisma.sep24Transaction.findUnique({ where: { id } });

    if (!tx || tx.stellarAccount !== account) {
      throw new NotFoundException('Transaction not found');
    }

    return this.formatTransaction(tx);
  }

  /**
   * Returns all SEP-24 transactions for a given Stellar account, ordered by
   * most recent first. Supports optional filtering by asset_code and kind.
   */
  async getTransactionsByAccount(
    account: string,
    assetCode?: string,
    kind?: string,
    limit = 50,
  ) {
    const where: any = { stellarAccount: account };
    if (assetCode) where.assetCode = assetCode;
    if (kind) where.kind = kind;

    const transactions = await this.prisma.sep24Transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });

    return { transactions: transactions.map((tx) => this.formatTransaction(tx)) };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Verifies a webview session JWT and returns its payload.
   * Throws UnauthorizedException if the token is invalid or expired.
   */
  verifySessionToken(token: string): Sep24SessionPayload {
    try {
      return this.jwt.verify<Sep24SessionPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session token');
    }
  }

  /** Signs a one-time session JWT (exposed for testing). */
  signSessionToken(payload: Omit<Sep24SessionPayload, 'iat' | 'exp'>): string {
    return this.jwt.sign(payload, { expiresIn: SESSION_TTL_SECONDS });
  }

  /**
   * Maps a Prisma Sep24Transaction record to the SEP-24 specification's
   * transaction response shape.
   */
  private formatTransaction(tx: any) {
    return {
      id: tx.id,
      kind: tx.kind,
      status: tx.status,
      stellar_account: tx.stellarAccount,
      asset_code: tx.assetCode,
      asset_issuer: tx.assetIssuer,
      amount_in: tx.amount,
      amount_out: tx.amount,
      started_at: tx.createdAt.toISOString(),
      completed_at: tx.status === 'completed' ? tx.updatedAt.toISOString() : null,
      stellar_transaction_id: tx.stellarTxHash,
      memo: tx.memo,
      memo_type: tx.memoType,
      message: tx.message,
    };
  }
}
