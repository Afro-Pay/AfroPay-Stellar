import { TransferSimulationService } from './transfer-simulation.service';

describe('TransferSimulationService', () => {
  let service: TransferSimulationService;

  beforeEach(() => {
    service = new TransferSimulationService();
  });

  it('simulates a direct USDC to NGN path payment with slippage bounds', () => {
    const result = service.simulate({
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
  });

  it('simulates XLM to NGN through USDC before live submission', () => {
    const result = service.simulate({
      sourceAsset: 'XLM',
      destinationAsset: 'NGN',
      sourceAmount: '25',
      destinationTrustlines: ['NGN'],
    });

    expect(result.status).toBe('ok');
    expect(result.path).toEqual(['XLM', 'USDC', 'NGN']);
    expect(result.estimatedDestinationAmount).toBe('4262.5');
  });

  it('blocks issued-asset delivery when the destination lacks the trustline', () => {
    const result = service.simulate({
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
  });

  it('reports missing conversion paths for unsupported exchange routes', () => {
    const result = service.simulate({
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

  it('runs a reproducible batch covering USDC, NGN, and XLM scenarios', () => {
    const batch = service.simulateBatch([
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
});
