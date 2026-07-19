import { TransferSimulationService } from './transfer-simulation.service';

describe('TransferSimulationService', () => {
  let service: TransferSimulationService;
  let mockAnchorService: any;

  beforeEach(() => {
    mockAnchorService = {
      getFxRate: jest.fn().mockResolvedValue({ rate: null, rate_expires_at: null }),
    };
    service = new TransferSimulationService(mockAnchorService);
  });

  it('simulates a direct USDC to NGN path payment with slippage bounds', async () => {
    const result = await service.simulate({
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      sourceAmount: '100',
      destinationTrustlines: ['NGN'],
      maxSlippageBps: 100,
    });

    expect(result.status).toBe('ok');
    expect(result.path).toEqual(['USDC', 'NGN']);
    expect(result.effectiveRate).toBe(1550);
    expect(result.estimatedDestinationAmount).toBe('155000');
    expect(result.minimumDestinationAmount).toBe('153450');
    expect(result.issues).toEqual([]);
    expect(result.rateFresh).toBe(false);
    expect(result.rateExpiresAt).toBeNull();
  });

  it('simulates XLM to NGN through USDC before live submission', async () => {
    const result = await service.simulate({
      sourceAsset: 'XLM',
      destinationAsset: 'NGN',
      sourceAmount: '25',
      destinationTrustlines: ['NGN'],
    });

    expect(result.status).toBe('ok');
    expect(result.path).toEqual(['XLM', 'USDC', 'NGN']);
    expect(result.estimatedDestinationAmount).toBe('4262.5');
    expect(result.rateFresh).toBe(false);
    expect(result.rateExpiresAt).toBeNull();
  });

  it('blocks issued-asset delivery when the destination lacks the trustline', async () => {
    const result = await service.simulate({
      sourceAsset: 'XLM',
      destinationAsset: 'USDC',
      sourceAmount: '10',
      destinationTrustlines: [],
    });

    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual({
      code: 'MISSING_DESTINATION_TRUSTLINE',
      message: 'Destination account must trust USDC before receiving it.',
    });
    expect(result.rateFresh).toBe(false);
    expect(result.rateExpiresAt).toBeNull();
  });

  it('reports missing conversion paths for unsupported exchange routes', async () => {
    const result = await service.simulate({
      sourceAsset: 'NGN',
      destinationAsset: 'XLM',
      sourceAmount: '5000',
      destinationTrustlines: [],
      rates: {
        'NGN:USDC': 0,
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.estimatedDestinationAmount).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain('NO_PATH');
  });

  it('runs a reproducible batch covering USDC, NGN, and XLM scenarios', async () => {
    const batch = await service.simulateBatch([
      {
        sourceAsset: 'USDC',
        destinationAsset: 'NGN',
        sourceAmount: '10',
        destinationTrustlines: ['NGN'],
      },
      {
        sourceAsset: 'NGN',
        destinationAsset: 'USDC',
        sourceAmount: '15500',
        destinationTrustlines: ['USDC'],
      },
      {
        sourceAsset: 'XLM',
        destinationAsset: 'USDC',
        sourceAmount: '5',
        destinationTrustlines: ['USDC'],
      },
    ]);

    expect(batch).toHaveLength(3);
    expect(batch.every((result) => result.status === 'ok')).toBe(true);
    expect(batch.map((result) => result.path.join('>'))).toEqual(['USDC>NGN', 'NGN>USDC', 'XLM>USDC']);
  });

  it('uses live rate from AnchorService when available', async () => {
    mockAnchorService.getFxRate.mockImplementation(async (from: string, to: string) => {
      if (from === 'USDC' && to === 'NGN') {
        return { rate: 1600, rate_expires_at: '2026-07-16T18:00:00.000Z' };
      }
      return { rate: null, rate_expires_at: null };
    });

    const result = await service.simulate({
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      sourceAmount: '100',
      destinationTrustlines: ['NGN'],
    });

    expect(result.status).toBe('ok');
    expect(result.effectiveRate).toBe(1600);
    expect(result.estimatedDestinationAmount).toBe('160000');
    expect(result.rateFresh).toBe(true);
    expect(result.rateExpiresAt).toBe('2026-07-16T18:00:00.000Z');
  });

  it('calculates the earliest rateExpiresAt in multi-hop simulation', async () => {
    mockAnchorService.getFxRate.mockImplementation(async (from: string, to: string) => {
      if (from === 'XLM' && to === 'USDC') {
        return { rate: 0.12, rate_expires_at: '2026-07-16T18:00:00.000Z' };
      }
      if (from === 'USDC' && to === 'NGN') {
        return { rate: 1600, rate_expires_at: '2026-07-16T17:59:50.000Z' };
      }
      return { rate: null, rate_expires_at: null };
    });

    const result = await service.simulate({
      sourceAsset: 'XLM',
      destinationAsset: 'NGN',
      sourceAmount: '10',
      destinationTrustlines: ['NGN'],
    });

    expect(result.status).toBe('ok');
    expect(result.effectiveRate).toBe(0.12 * 1600);
    expect(result.rateFresh).toBe(true);
    expect(result.rateExpiresAt).toBe('2026-07-16T17:59:50.000Z');
  });

  it('emits a STALE_RATE issue code when the live rate diverges from static default by > 5%', async () => {
    // Static USDC:NGN default is 1550. 1700 is > 5% divergence.
    mockAnchorService.getFxRate.mockImplementation(async (from: string, to: string) => {
      if (from === 'USDC' && to === 'NGN') {
        return { rate: 1700, rate_expires_at: '2026-07-16T18:00:00.000Z' };
      }
      return { rate: null, rate_expires_at: null };
    });

    const result = await service.simulate({
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      sourceAmount: '100',
      destinationTrustlines: ['NGN'],
    });

    expect(result.status).toBe('ok'); // Must not block the simulation
    expect(result.effectiveRate).toBe(1700);
    expect(result.issues).toContainEqual({
      code: 'STALE_RATE',
      message: 'Live rate for USDC:NGN deviates from the static default by more than 5%.',
    });
  });

  it('does not emit a STALE_RATE issue code when divergence is <= 5%', async () => {
    // 1560 is within 5% of 1550
    mockAnchorService.getFxRate.mockImplementation(async (from: string, to: string) => {
      if (from === 'USDC' && to === 'NGN') {
        return { rate: 1560, rate_expires_at: '2026-07-16T18:00:00.000Z' };
      }
      return { rate: null, rate_expires_at: null };
    });

    const result = await service.simulate({
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      sourceAmount: '100',
      destinationTrustlines: ['NGN'],
    });

    expect(result.status).toBe('ok');
    expect(result.effectiveRate).toBe(1560);
    expect(result.issues.map((i) => i.code)).not.toContain('STALE_RATE');
  });
});
