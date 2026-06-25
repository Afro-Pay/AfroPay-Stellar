import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { WalletService } from './wallet.service';

// Minimal unit tests without DB — test encryption helpers via reflection
describe('WalletService encryption', () => {
  let service: WalletService;
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('encrypts and decrypts a secret key with legacy AES', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex
    delete process.env.KMS_KEY_ID;
    delete process.env.AWS_REGION;

    service = new WalletService(null as any);
    const secret = 'SCZANGBA5YHTNYVSK3TZQOZ6PFPAXDHDWZOBENXVGHD';

    const encrypted = await (service as any).encryptWalletSecret(secret);
    expect(encrypted.encryptedDek).toBeNull();
    expect(encrypted.encryptedSecret).toContain(':');

    const decrypted = await (service as any).decryptWalletSecret({
      encryptedSecret: encrypted.encryptedSecret,
      encryptedDek: null,
    });
    expect(decrypted).toBe(secret);
  });

  it('encrypts and decrypts a secret key with KMS envelope encryption', async () => {
    process.env.KMS_KEY_ID = 'alias/test-key';
    process.env.AWS_REGION = 'us-east-1';
    delete process.env.ENCRYPTION_KEY;

    let capturedDek: Buffer | null = null;
    jest.spyOn(KMSClient.prototype, 'send').mockImplementation(async (command: any) => {
      if (command instanceof EncryptCommand) {
        capturedDek = Buffer.from(command.input.Plaintext);
        return { CiphertextBlob: Buffer.from('kms-encrypted-dek') } as any;
      }
      if (command instanceof DecryptCommand) {
        return { Plaintext: capturedDek } as any;
      }
      return {} as any;
    });

    service = new WalletService(null as any);
    const secret = 'SCZANGBA5YHTNYVSK3TZQOZ6PFPAXDHDWZOBENXVGHD';

    const encrypted = await (service as any).encryptWalletSecret(secret);
    expect(encrypted.encryptedDek).toBeDefined();
    expect(encrypted.kmsKeyId).toBe('alias/test-key');
    expect(encrypted.encryptedSecret).toContain(':');

    const decrypted = await (service as any).decryptWalletSecret({
      encryptedSecret: encrypted.encryptedSecret,
      encryptedDek: encrypted.encryptedDek,
    });

    expect(decrypted).toBe(secret);
  });
});

describe('WalletService reconciliation', () => {
  let service: WalletService;
  let prisma: any;

  const wallet = {
    id: 'wallet-1',
    userId: 'user-1',
    publicKey: 'GBXACCOUNT',
    encryptedSecret: 'encrypted',
  };

  beforeEach(() => {
    prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new WalletService(prisma);
  });

  it('returns an in-sync report when expected assets have matching trustlines', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        assetCode: 'USDC',
        assetIssuer: 'GISSUER',
        status: 'SUCCESS',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    jest.spyOn(service as any, 'loadAccount').mockResolvedValue({
      sequence: '123',
      last_modified_ledger: 100,
      last_modified_time: '2026-01-02T00:00:00Z',
      balances: [
        { asset_type: 'native', balance: '10.0000000' },
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GISSUER',
          balance: '25.0000000',
          limit: '1000.0000000',
        },
      ],
    });

    const report = await service.reconcileWallet('user-1');

    expect(report.status).toBe('in_sync');
    expect(report.summary).toMatchObject({
      discrepancyCount: 0,
      criticalCount: 0,
      missingTrustlineCount: 0,
    });
    expect(report.onChain.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ asset: 'XLM', trustline: false }),
        expect.objectContaining({ asset: 'USDC', assetIssuer: 'GISSUER', trustline: true }),
      ]),
    );
  });

  it('flags missing trustlines for assets referenced by application transactions', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        assetCode: 'EURC',
        assetIssuer: 'GEURCISSUER',
        status: 'PENDING',
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]);
    jest.spyOn(service as any, 'loadAccount').mockResolvedValue({
      sequence: '124',
      last_modified_ledger: 101,
      last_modified_time: '2026-01-02T00:00:00Z',
      balances: [{ asset_type: 'native', balance: '10.0000000' }],
    });

    const report = await service.reconcileWallet('user-1');

    expect(report.status).toBe('drift_detected');
    expect(report.summary.missingTrustlineCount).toBe(1);
    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'MISSING_TRUSTLINE',
          severity: 'warning',
          asset: 'EURC',
          assetIssuer: 'GEURCISSUER',
        }),
        expect.objectContaining({
          type: 'STALE_LEDGER_STATE',
          severity: 'info',
        }),
      ]),
    );
  });

  it('returns a critical report when the stored wallet is not found on-chain', async () => {
    jest.spyOn(service as any, 'loadAccount').mockRejectedValue({ response: { status: 404 } });

    const report = await service.reconcileWallet('user-1');

    expect(report.status).toBe('drift_detected');
    expect(report.onChain.accountFound).toBe(false);
    expect(report.summary.criticalCount).toBe(1);
    expect(report.discrepancies).toEqual([
      expect.objectContaining({
        type: 'ON_CHAIN_ACCOUNT_NOT_FOUND',
        severity: 'critical',
      }),
    ]);
  });
});
