import { WalletService } from './wallet.service';
import { AuditLogService } from '../audit/audit.service';

// ---------------------------------------------------------------------------
// Minimal unit tests for WalletService — isolates encryption helpers and
// auditing from the database and Stellar network.
// ---------------------------------------------------------------------------

// Mock AuditLogService so audit calls don't require Prisma
const mockAuditLog: Partial<AuditLogService> = { log: jest.fn().mockResolvedValue(undefined) };

describe('WalletService encryption helpers', () => {
  let service: WalletService;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex key
    service = new WalletService(null as any, mockAuditLog as AuditLogService);
  });

  it('encrypts and decrypts a secret key round-trip', () => {
    const secret = 'SCZANGBA5YHTNYVSK3TZQOZ6PFPAXDHDWZOBENXVGHD';
    const encrypted = (service as any).encrypt(secret);
    const decrypted = (service as any).decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const secret = 'SCZANGBA5YHTNYVSK3TZQOZ6PFPAXDHDWZOBENXVGHD';
    const enc1 = (service as any).encrypt(secret);
    const enc2 = (service as any).encrypt(secret);
    expect(enc1).not.toBe(enc2);
  });
});
