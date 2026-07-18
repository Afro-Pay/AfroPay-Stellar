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

  // -------------------------------------------------------------------------
  // Staleness (MAX_CACHE_AGE)
  // -------------------------------------------------------------------------
  describe('staleness', () => {
    const seedCache = async (fetchedAt: number, rate = 1500) => {
      await (service as any).redis.set(
        'fx:USD:NGN',
        JSON.stringify({ rate, from: 'USD', to: 'NGN', fetchedAt }),
        'EX',
        300,
      );
    };

    it('returns stale: false for a freshly fetched rate', async () => {
      const res = await service.getFxRate('USD', 'NGN');
      expect(res.rate).toBe(1550);
      expect(res.stale).toBe(false);
      expect(res.circuitOpen).toBe(false);
    });

    it('returns stale: true when the cached rate exceeds max age and the anchor is unreachable', async () => {
      await seedCache(Date.now() - 60_000); // max age is 30s
      (service as any).fetchExternalRate = async () => {
        throw new Error('anchor unreachable');
      };

      const res = await service.getFxRate('USD', 'NGN');
      expect(res.rate).toBe(1500);
      expect(res.stale).toBe(true);
      expect(res.circuitOpen).toBe(false);
      expect(new Date(res.rate_expires_at as string).getTime()).toBeLessThan(Date.now());
    });

    it('returns stale: false when the anchor is unreachable but the cached rate is within max age', async () => {
      await seedCache(Date.now() - 10_000);
      (service as any).fetchExternalRate = async () => {
        throw new Error('anchor unreachable');
      };

      const res = await service.getFxRate('USD', 'NGN');
      expect(res.rate).toBe(1500);
      expect(res.stale).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Circuit breaker
  // -------------------------------------------------------------------------
  describe('circuit breaker', () => {
    let failingFetch: jest.Mock;

    beforeEach(async () => {
      // Prime the cache with a good rate via the default stub, then make the
      // anchor unreachable.
      await service.getFxRate('USD', 'NGN');
      failingFetch = jest.fn().mockRejectedValue(new Error('anchor down'));
      (service as any).fetchExternalRate = failingFetch;
    });

    const openCircuit = async () => {
      await service.getFxRate('USD', 'NGN');
      await service.getFxRate('USD', 'NGN');
      return service.getFxRate('USD', 'NGN');
    };

    it('opens after 3 consecutive failures and stops calling the anchor', async () => {
      const third = await openCircuit();
      expect(failingFetch).toHaveBeenCalledTimes(3);
      expect(third.circuitOpen).toBe(true);
      expect(third.rate).toBe(1550);

      const fourth = await service.getFxRate('USD', 'NGN');
      expect(failingFetch).toHaveBeenCalledTimes(3); // no new attempt
      expect(fourth.circuitOpen).toBe(true);
      expect(fourth.rate).toBe(1550);
    });

    it('keeps the circuit closed on other currency pairs', async () => {
      await openCircuit();

      (service as any).fetchExternalRate = async (from: string, to: string) => ({
        rate: 0.11,
        from,
        to,
      });
      const res = await service.getFxRate('XLM', 'USD');
      expect(res.rate).toBe(0.11);
      expect(res.circuitOpen).toBe(false);
    });

    it('attempts a real fetch after CIRCUIT_RESET_MS and closes on success', async () => {
      (service as any).circuitResetMs = 50;
      await openCircuit();

      await new Promise((resolve) => setTimeout(resolve, 60));
      (service as any).fetchExternalRate = async (from: string, to: string) => ({
        rate: 1600, // >0.5% from cached 1550 so the fresh rate replaces it
        from,
        to,
      });

      const res = await service.getFxRate('USD', 'NGN');
      expect(res.rate).toBe(1600);
      expect(res.circuitOpen).toBe(false);
      expect(res.stale).toBe(false);
    });

    it('re-opens the circuit when the half-open probe fails', async () => {
      (service as any).circuitResetMs = 50;
      await openCircuit();
      expect(failingFetch).toHaveBeenCalledTimes(3);

      await new Promise((resolve) => setTimeout(resolve, 60));
      const probe = await service.getFxRate('USD', 'NGN');
      expect(failingFetch).toHaveBeenCalledTimes(4); // one probe attempted
      expect(probe.circuitOpen).toBe(true);

      const after = await service.getFxRate('USD', 'NGN');
      expect(failingFetch).toHaveBeenCalledTimes(4); // open again, no attempt
      expect(after.circuitOpen).toBe(true);
    });

    it('does not count an unknown pair (rate: null) as a failure', async () => {
      const stubFetch = jest.fn(async (from: string, to: string) => ({
        rate: null,
        from,
        to,
      }));
      (service as any).fetchExternalRate = stubFetch;

      for (let i = 0; i < 5; i++) {
        await service.getFxRate('EUR', 'JPY');
      }
      // Breaker never opens: the anchor is still consulted on every call.
      expect(stubFetch).toHaveBeenCalledTimes(5);
    });
  });
});
