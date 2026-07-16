import { ConfigService } from '@nestjs/config';
import { Keypair } from 'stellar-sdk';
import * as crypto from 'crypto';
import { VaultService } from './vault.service';

function deriveUserKey(userId: string, masterKey: Buffer): Buffer {
  return crypto.hkdfSync(
    'sha256',
    masterKey,
    Buffer.alloc(16),
    Buffer.from(userId, 'utf8'),
    32,
  );
}

function encryptWalletSecret(text: string, userId: string, masterKey: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    deriveUserKey(userId, masterKey),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

describe('VaultService', () => {
  let configService: Partial<ConfigService>;
  let prisma: any;
  let service: VaultService;

  beforeEach(() => {
    const cosignerKeypair = Keypair.random();
    const masterKey = Buffer.from('a'.repeat(64), 'hex');

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'COSIGNER_SECRET') {
          return cosignerKeypair.secret();
        }
        if (key === 'ENCRYPTION_KEY') {
          return masterKey.toString('hex');
        }
        return null;
      }),
    };

    prisma = {
      wallet: {
        findUnique: jest.fn(),
      },
    };

    service = new VaultService(configService as ConfigService, prisma as any);
  });

  it('returns a valid cosigner public key', async () => {
    const publicKey = await service.getCosignerPublicKey();
    expect(publicKey).toBeTruthy();
    expect(() => Keypair.fromPublicKey(publicKey as string)).not.toThrow();
  });

  it('decrypts a user wallet secret and returns a valid keypair', async () => {
    const userId = 'user-1';
    const privateKey = Keypair.random().secret();
    const masterKey = Buffer.from('a'.repeat(64), 'hex');
    const encryptedSecret = encryptWalletSecret(privateKey, userId, masterKey);

    prisma.wallet.findUnique.mockResolvedValue({ encryptedSecret });

    const userKeypair = await service.getUserKeypair(userId);

    expect(userKeypair.privateKey).toBe(privateKey);
    expect(userKeypair.publicKey).toBe(Keypair.fromSecret(privateKey).publicKey());
  });
});
