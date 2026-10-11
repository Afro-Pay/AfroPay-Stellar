jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

import axios from 'axios';
import { AnchorService, medianOf, resolveAnchorSources } from './anchor.service';
import { AnchorReconciliationException } from './anchor.exceptions';

const mockedAxios = axios as unknown as { get: jest.Mock };

describe('AnchorService', () => {
  let service: AnchorService;

  beforeEach(() => { service = new AnchorService(); });

  describe('SEP-10 security audit', () => {
    it('rejects expired SEP-10 JWTs before trusting them', async () => {
      const expiredPayload = {
        sub: 'GDTPQ4E7V4R5H3YQG7F5V4N6TQ2JMWQ56N2QJ2Q5R2T7A6QX2QYLLM',
        exp: Math.floor(Date.now() / 1000) - 5,
        iat: Math.floor(Date.now() / 1000) - 30,
      };
      const token = `header.${Buffer.from(JSON.stringify(expiredPayload)).toString('base64url')}.sig`;

      await expect(service.verifySep10Token(token)).rejects.toThrow(/expired|exp/i);
    });

    it('rejects replayed challenge nonces with a TTL-backed single-use store', async () => {
      const nonce = await service.issueChallengeNonce('GAAA', 60);
      await expect(service.consumeChallengeNonce('GAAA', nonce, 60)).resolves.toBeUndefined();
      await expect(service.consumeChallengeNonce('GAAA', nonce, 60)).rejects.toThrow(/already used|nonce/i);
    });

    it('rejects an anchor signing key that does not match the cached stellar.toml key', async () => {
      (service as any).cachedAnchorSigningKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      await expect(
        service.assertAnchorSigningKeyMatches('GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),
      ).rejects.toThrow(/signing key|stellar.toml/i);
    });
  });

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

  // -------------------------------------------------------------------------
  // Multi-source FX aggregation with outlier rejection (#198)
  // -------------------------------------------------------------------------
  describe('multi-source FX aggregation (#198)', () => {
    const SRC_A = 'https://anchor-a.example';
    const SRC_B = 'https://anchor-b.example';
    const SRC_C = 'https://anchor-c.example';

    beforeEach(() => {
      delete process.env.ANCHOR_USD_URLS;
      delete process.env.ANCHOR_USD_URL;
      delete process.env.ANCHOR_NGN_URLS;
      delete process.env.ANCHOR_NGN_URL;
    });

    afterEach(() => {
      delete process.env.ANCHOR_USD_URLS;
      delete process.env.ANCHOR_USD_URL;
      delete process.env.ANCHOR_NGN_URLS;
      delete process.env.ANCHOR_NGN_URL;
    });

    it('medianOf handles odd and even lists without mutating input', () => {
      const input = [3, 1, 2];
      expect(medianOf(input)).toBe(2);
      expect(input).toEqual([3, 1, 2]); // unchanged
      expect(medianOf([10, 20, 30, 40])).toBe(25);
      expect(medianOf([])).toBe(0);
    });

    it('resolveAnchorSources prefers the comma-separated list and de-dupes', () => {
      process.env.ANCHOR_NGN_URLS = `${SRC_A}, ${SRC_B} ,${SRC_A}`;
      expect(resolveAnchorSources('USD', 'NGN')).toEqual([SRC_A, SRC_B]);
    });

    it('resolveAnchorSources falls back to the single legacy URL', () => {
      process.env.ANCHOR_NGN_URL = SRC_A;
      expect(resolveAnchorSources('USD', 'NGN')).toEqual([SRC_A]);
    });

    it('aggregates the median of agreeing sources and reports sourceCount', async () => {
      process.env.ANCHOR_NGN_URLS = `${SRC_A},${SRC_B},${SRC_C}`;
      const bySource: Record<string, number> = { [SRC_A]: 1550, [SRC_B]: 1552, [SRC_C]: 1548 };
      (service as any).fetchRateFromSource = async (s: string) => bySource[s];

      const res = await service.getFxRate('USD', 'NGN');
      expect(res.rate).toBe(1550);
      expect(res.sourceCount).toBe(3);
      expect(res.rejectedSources).toEqual([]);
    });

    it('rejects a single outlier source and excludes it from the median', async () => {
      process.env.ANCHOR_NGN_URLS = `${SRC_A},${SRC_B},${SRC_C}`;
      // SRC_C is a compromised anchor feeding a wildly wrong rate.
      const bySource: Record<string, number> = { [SRC_A]: 1550, [SRC_B]: 1552, [SRC_C]: 9999 };
      (service as any).fetchRateFromSource = async (s: string) => bySource[s];

      const res = await service.getFxRate('USD', 'NGN');
      expect(res.rate).toBe(1551); // median of {1550,1552}
      expect(res.sourceCount).toBe(2);
      expect(res.rejectedSources).toEqual([SRC_C]);
    });

    it('honours a configurable outlier threshold', async () => {
      process.env.ANCHOR_NGN_URLS = `${SRC_A},${SRC_B},${SRC_C}`;
      (service as any).anchorOutlierThreshold = 0.001; // 0.1%
      const bySource: Record<string, number> = { [SRC_A]: 1550, [SRC_B]: 1552, [SRC_C]: 1550 };
      (service as any).fetchRateFromSource = async (s: string) => bySource[s];

      const res = await service.getFxRate('USD', 'NGN');
      expect(res.rejectedSources).toContain(SRC_B); // 1552 deviates >0.1% from median 1550
    });

    it('skips a source that throws but still serves the others', async () => {
      process.env.ANCHOR_NGN_URLS = `${SRC_A},${SRC_B}`;
      (service as any).fetchRateFromSource = async (s: string) => {
        if (s === SRC_A) throw new Error('down');
        return 1550;
      };

      const res = await service.getFxRate('USD', 'NGN');
      expect(res.rate).toBe(1550);
      expect(res.sourceCount).toBe(1);
    });

    it('treats a lone source as authoritative (no outlier rejection possible)', async () => {
      process.env.ANCHOR_NGN_URL = SRC_A;
      (service as any).fetchRateFromSource = async () => 1550;

      const res = await service.getFxRate('USD', 'NGN');
      expect(res.rate).toBe(1550);
      expect(res.sourceCount).toBe(1);
      expect(res.rejectedSources).toEqual([]);
    });

    it('counts the corridor as a failure only when EVERY source errors', async () => {
      process.env.ANCHOR_NGN_URLS = `${SRC_A},${SRC_B}`;
      (service as any).fetchRateFromSource = async () => {
        throw new Error('all down');
      };

      const res = await service.getFxRate('USD', 'NGN');
      // No cache, no source answered → null rate, and the breaker advanced.
      expect(res.rate).toBeNull();
      expect((service as any).getBreaker('fx:USD:NGN').consecutiveFailures).toBe(1);
    });

    it('does not count "no source quotes the pair" as a failure', async () => {
      process.env.ANCHOR_NGN_URLS = `${SRC_A},${SRC_B}`;
      (service as any).fetchRateFromSource = async () => null;

      const res = await service.getFxRate('EUR', 'JPY');
      expect(res.rate).toBeNull();
      expect((service as any).getBreaker('fx:EUR:JPY').consecutiveFailures).toBe(0);
    });

    it('persists and replays sourceCount/rejectedSources from cache', async () => {
      process.env.ANCHOR_NGN_URLS = `${SRC_A},${SRC_B},${SRC_C}`;
      const bySource: Record<string, number> = { [SRC_A]: 1550, [SRC_B]: 1552, [SRC_C]: 9999 };
      (service as any).fetchRateFromSource = async (s: string) => bySource[s];

      const first = await service.getFxRate('USD', 'NGN');
      expect(first.sourceCount).toBe(2);

      // Make the anchor unreachable: the cached result (with its metadata) is served.
      (service as any).fetchRateFromSource = async () => {
        throw new Error('down');
      };
      const second = await service.getFxRate('USD', 'NGN');
      expect(second.sourceCount).toBe(2);
      expect(second.rejectedSources).toEqual([SRC_C]);
    });
  });

  // -------------------------------------------------------------------------
  // SEP-6 deposit/withdraw response validation and reconciliation (#137)
  // -------------------------------------------------------------------------
  describe('SEP-6 response validation', () => {
    const USER_ACCOUNT = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    const OTHER_ACCOUNT = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

    beforeEach(() => {
      mockedAxios.get.mockReset();
    });

    describe('getDepositInfo', () => {
      it('returns the anchor payload unchanged when the response is valid', async () => {
        const payload = { how: 'Send USD to bank X', min_amount: 5, max_amount: 1000 };
        mockedAxios.get.mockResolvedValue({ data: payload });

        await expect(service.getDepositInfo('USDC', USER_ACCOUNT)).resolves.toEqual(payload);
      });

      it('throws on a malformed (non-object) response', async () => {
        mockedAxios.get.mockResolvedValue({ data: 'not-json' });

        await expect(service.getDepositInfo('USDC', USER_ACCOUNT)).rejects.toBeInstanceOf(
          AnchorReconciliationException,
        );
      });

      it('throws when a field violates the SEP-6 schema', async () => {
        mockedAxios.get.mockResolvedValue({ data: { min_amount: 'lots' } });

        await expect(service.getDepositInfo('USDC', USER_ACCOUNT)).rejects.toBeInstanceOf(
          AnchorReconciliationException,
        );
      });

      it('throws when the response account does not match the requested account', async () => {
        mockedAxios.get.mockResolvedValue({ data: { stellar_account: OTHER_ACCOUNT } });

        await expect(service.getDepositInfo('USDC', USER_ACCOUNT)).rejects.toBeInstanceOf(
          AnchorReconciliationException,
        );
      });

      it('passes when the response echoes the matching account', async () => {
        const payload = { stellar_account: USER_ACCOUNT, how: 'Send USD' };
        mockedAxios.get.mockResolvedValue({ data: payload });

        await expect(service.getDepositInfo('USDC', USER_ACCOUNT)).resolves.toEqual(payload);
      });
    });

    describe('getWithdrawInfo', () => {
      it('returns the anchor payload when the amount is within range', async () => {
        const payload = { account_id: OTHER_ACCOUNT, min_amount: 10, max_amount: 1000, fee_fixed: 0.5 };
        mockedAxios.get.mockResolvedValue({ data: payload });

        await expect(service.getWithdrawInfo('USDC', USER_ACCOUNT, '50')).resolves.toEqual(payload);
      });

      it('throws on a malformed response', async () => {
        mockedAxios.get.mockResolvedValue({ data: null });

        await expect(service.getWithdrawInfo('USDC', USER_ACCOUNT, '50')).rejects.toBeInstanceOf(
          AnchorReconciliationException,
        );
      });

      it('throws when the requested amount is below the anchor minimum', async () => {
        mockedAxios.get.mockResolvedValue({ data: { min_amount: 100, max_amount: 1000 } });

        await expect(service.getWithdrawInfo('USDC', USER_ACCOUNT, '50')).rejects.toBeInstanceOf(
          AnchorReconciliationException,
        );
      });

      it('throws when the requested amount exceeds the anchor maximum', async () => {
        mockedAxios.get.mockResolvedValue({ data: { min_amount: 10, max_amount: 100 } });

        await expect(service.getWithdrawInfo('USDC', USER_ACCOUNT, '500')).rejects.toBeInstanceOf(
          AnchorReconciliationException,
        );
      });

      it('does not reconcile the amount when the anchor omits min/max', async () => {
        const payload = {
          account_id: OTHER_ACCOUNT,
          type: 'non_interactive_customer_info_needed',
          fields: {},
        };
        mockedAxios.get.mockResolvedValue({ data: payload });

        await expect(service.getWithdrawInfo('USDC', USER_ACCOUNT, '50')).resolves.toEqual(payload);
      });
    });
  });
});
