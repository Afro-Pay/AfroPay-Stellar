import { AnchorService } from './anchor.service';

describe('AnchorService', () => {
  let service: AnchorService;

  beforeEach(() => { service = new AnchorService(); });

  it('returns a known FX rate for USD-NGN', async () => {
    const result = await service.getFxRate('USD', 'NGN');
    expect(result.rate).toBe(1550);
    expect(result.from).toBe('USD');
    expect(result.to).toBe('NGN');
  });

  it('returns null for unknown pair', async () => {
    const result = await service.getFxRate('EUR', 'JPY');
    expect(result.rate).toBeNull();
  });

  it('includes rate_expires_at and caches the rate (TTL capped at 30s)', async () => {
    const res1: any = await service.getFxRate('USD', 'NGN');
    expect(res1.rate).toBe(1550);
    expect(res1.rate_expires_at).toBeDefined();
    const expiresAt = new Date(res1.rate_expires_at);
    expect(!isNaN(expiresAt.getTime())).toBe(true);
    const diffSecs = (expiresAt.getTime() - Date.now()) / 1000;
    expect(diffSecs).toBeGreaterThan(0);
    expect(diffSecs).toBeLessThanOrEqual(31);

    // Second call should return cached value (unless external changed by >0.5%)
    const res2: any = await service.getFxRate('USD', 'NGN');
    expect(res2.rate).toBe(1550);
    expect(res2.rate_expires_at).toBeDefined();
  });

  it('invalidates cache when external rate delta exceeds 0.5%', async () => {
    const first: any = await service.getFxRate('USD', 'NGN');
    expect(first.rate).toBe(1550);

    // simulate external provider now returns a rate shifted >0.5%
    (service as any).fetchExternalRate = async (from: string, to: string) => ({ rate: 1600, from, to });

    const second: any = await service.getFxRate('USD', 'NGN');
    expect(second.rate).toBe(1600);
    expect(second.rate_expires_at).toBeDefined();
  });
});
