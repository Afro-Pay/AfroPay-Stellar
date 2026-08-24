import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { VaultService } from './vault.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('VaultService delegated signing', () => {
  const wallet = { id: 'wallet-1', publicKey: 'GPUBLIC' };
  let config: ConfigService;
  let prisma: any;
  let service: VaultService;

  beforeEach(() => {
    jest.clearAllMocks();
    config = {
      get: jest.fn((key: string) => ({
        SIGNER_URL: 'http://signer.internal:8080',
        SIGNER_AUTH_TOKEN: 'test-token',
        STELLAR_NETWORK: 'testnet',
        COSIGNER_PUBLIC_KEY: 'GCOSIGNER',
      })[key]),
    } as any;
    prisma = { wallet: { findFirst: jest.fn().mockResolvedValue(wallet) } };
    service = new VaultService(config, prisma);
  });

  it('routes signing outside NestJS without selecting encrypted key material', async () => {
    mockedAxios.post.mockImplementation(async (_url, body: any) => ({
      data: {
        signedTransactionXdr: 'signed-xdr',
        signerPublicKey: wallet.publicKey,
        requestId: body.requestId,
      },
    } as any));

    const result = await service.signTransaction('user-1', 'unsigned-xdr');

    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { id: true, publicKey: true },
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://signer.internal:8080/v1/sign',
      expect.objectContaining({
        walletId: wallet.id,
        expectedPublicKey: wallet.publicKey,
        unsignedTransactionXdr: 'unsigned-xdr',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      signedTransactionXdr: 'signed-xdr',
      signerPublicKey: wallet.publicKey,
    }));
  });

  it('fails closed when the signer is not configured', async () => {
    (config.get as jest.Mock).mockReturnValue(undefined);
    await expect(service.signTransaction('user-1', 'unsigned-xdr'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('rejects a response signed by a different wallet', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { signedTransactionXdr: 'signed-xdr', signerPublicKey: 'GATTACKER' },
    } as any);
    await expect(service.signTransaction('user-1', 'unsigned-xdr'))
      .rejects.toBeInstanceOf(BadGatewayException);
  });

  it('exposes only the configured cosigner public key', async () => {
    await expect(service.getCosignerPublicKey()).resolves.toBe('GCOSIGNER');
  });
});
