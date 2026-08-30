import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface DelegatedSigningResult {
  signedTransactionXdr: string;
  signerPublicKey: string;
  requestId: string;
}

interface SignerResponse {
  signedTransactionXdr?: unknown;
  signerPublicKey?: unknown;
  requestId?: unknown;
}

/**
 * Narrow client for the external signing boundary.
 *
 * This service intentionally has no KMS client, AES implementation, encrypted
 * key fields, or method that returns a private key. The signer is responsible
 * for key retrieval, unwrap, signing, and memory cleanup in another process.
 */
@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async getCosignerPublicKey(): Promise<string | null> {
    return this.configService.get<string>('COSIGNER_PUBLIC_KEY') ?? null;
  }

  async signTransaction(
    userId: string,
    unsignedTransactionXdr: string,
  ): Promise<DelegatedSigningResult> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { userId },
      select: { id: true, publicKey: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const signerUrl = this.configService.get<string>('SIGNER_URL');
    const signerToken = this.configService.get<string>('SIGNER_AUTH_TOKEN');
    if (!signerUrl || !signerToken) {
      throw new ServiceUnavailableException('Delegated signer is not configured');
    }

    const requestId = randomUUID();
    let response: { data: SignerResponse };
    try {
      response = await axios.post<SignerResponse>(
        `${signerUrl.replace(/\/$/, '')}/v1/sign`,
        {
          requestId,
          walletId: wallet.id,
          expectedPublicKey: wallet.publicKey,
          unsignedTransactionXdr,
          network: this.configService.get<string>('STELLAR_NETWORK') ?? 'testnet',
        },
        {
          headers: {
            authorization: `Bearer ${signerToken}`,
            'content-type': 'application/json',
          },
          timeout: 10_000,
        },
      );
    } catch {
      // HTTP client errors may contain request/response bodies, so they are not
      // attached to logs. Only non-sensitive identifiers cross this path.
      this.logger.error({ event: 'delegated_signing_failed', requestId, walletId: wallet.id });
      throw new BadGatewayException('Delegated signer failed');
    }

    const data = response.data;
    if (
      typeof data.signedTransactionXdr !== 'string' ||
      typeof data.signerPublicKey !== 'string' ||
      data.signerPublicKey !== wallet.publicKey ||
      (data.requestId !== undefined && data.requestId !== requestId)
    ) {
      throw new BadGatewayException('Delegated signer returned an invalid response');
    }

    this.logger.log({ event: 'delegated_signing_completed', requestId, walletId: wallet.id });
    return {
      signedTransactionXdr: data.signedTransactionXdr,
      signerPublicKey: data.signerPublicKey,
      requestId,
    };
  }
}
