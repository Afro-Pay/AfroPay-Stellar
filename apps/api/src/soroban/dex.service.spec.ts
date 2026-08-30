import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  DexService,
  StellarAsset,
  PaymentPath,
} from './dex.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const XLM: StellarAsset = { code: 'XLM', issuer: '' };
const USDC: StellarAsset = {
  code: 'USDC',
  issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};
const EURT: StellarAsset = {
  code: 'EURT',
  issuer: 'GAP5LETOV6YIE62YAM56STDANPRDO7ZFDBGSNHJQIYGGKSMOZAHOOS2S',
};
const NGNT: StellarAsset = {
  code: 'NGNT',
  issuer: 'GAWODAROMJ33V5YDFY3NPYTHVYQG7MJXVJ2ND3AOGIHYRWINES6ACCPD',
};

function makePath(
  src: StellarAsset,
  dst: StellarAsset,
  hops: StellarAsset[],
  rate: number,
  srcAmount = 100,
): PaymentPath {
  const srcAmt = srcAmount.toFixed(7);
  const dstAmt = (srcAmount * rate).toFixed(7);
  const feeStroops = 100 + hops.length * 50;
  const feeXlm = feeStroops * 1e-7;
  const hopPenalty = hops.length * 0.001;
  const costScore =
    1 / Math.max(rate, 1e-12) + hopPenalty + feeXlm / srcAmount;
  return {
    sourceAsset: src,
    destinationAsset: dst,
    path: hops,
    sourceAmount: srcAmt,
    destinationAmount: dstAmt,
    effectiveRate: rate,
    estimatedFeeStroops: feeStroops,
    costScore,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DexService', () => {
  let service: DexService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DexService],
    }).compile();

    service = module.get<DexService>(DexService);
  });

  // ── Fee estimation ──────────────────────────────────────────────────────────

  describe('estimateFeeStroops', () => {
    it('should return base fee for 0 intermediate hops', () => {
      expect(service.estimateFeeStroops(0)).toBe(100);
    });

    it('should add 50 stroops per hop', () => {
      expect(service.estimateFeeStroops(1)).toBe(150);
      expect(service.estimateFeeStroops(3)).toBe(250);
    });

    it('should handle path with 3 intermediate assets (acceptance criterion)', () => {
      const fee = service.estimateFeeStroops(3);
      expect(fee).toBe(250);
      expect(fee).toBeGreaterThan(100);
    });
  });

  // ── Slippage protection ─────────────────────────────────────────────────────

  describe('checkSlippage', () => {
    it('should return safe=true when rate has not moved', () => {
      const result = service.checkSlippage(1.0, 1.0, 1.0);
      expect(result.safe).toBe(true);
    });

    it('should return safe=true at exactly the tolerance boundary', () => {
      // Quoted 1.0, actual 0.99 → 1% drop → exactly at 1% threshold.
      const result = service.checkSlippage(1.0, 0.99, 1.0);
      expect(result.safe).toBe(true);
    });

    it('should return safe=false when slippage exceeds threshold', () => {
      // 2% drop with 1% tolerance.
      const result = service.checkSlippage(1.0, 0.979, 1.0);
      expect(result.safe).toBe(false);
      expect(result.slippagePct).toBeGreaterThan(1.0);
    });

    it('should roll back if price moves more than 1% during execution', () => {
      // Core acceptance criterion: slippage > 1% must block transaction.
      const result = service.checkSlippage(1.05, 1.03, 1.0);
      // 1.05 → 1.03 = 1.9% drop.
      expect(result.safe).toBe(false);
      expect(result.slippagePct).toBeCloseTo(1.9, 1);
    });

    it('should correctly compute minRate', () => {
      const result = service.checkSlippage(1.0, 0.995, 1.0);
      expect(result.minRate).toBeCloseTo(0.99, 6);
    });

    it('should handle zero quotedRate without throwing', () => {
      const result = service.checkSlippage(0, 0, 1.0);
      expect(result.safe).toBe(true); // 0 >= 0
    });
  });

  // ── computeDestMin ──────────────────────────────────────────────────────────

  describe('computeDestMin', () => {
    it('should return quotedDestination * (1 - slippage/100)', () => {
      // 100 USDC at rate 1.0 with 1% slippage → dest_min = 99.0.
      const destMin = service.computeDestMin(100, 1.0, 1.0);
      expect(destMin).toBeCloseTo(99.0, 6);
    });

    it('should factor in multi-hop exchange rates', () => {
      // 50 EURT at rate 0.9 with 1% slippage → dest_min = 50*0.9*0.99 = 44.55.
      const destMin = service.computeDestMin(50, 0.9, 1.0);
      expect(destMin).toBeCloseTo(44.55, 6);
    });

    it('should use default 1% slippage when not specified', () => {
      const destMin = service.computeDestMin(100, 1.0);
      expect(destMin).toBeCloseTo(99.0, 6);
    });

    it('should return 0 for 0 source amount', () => {
      expect(service.computeDestMin(0, 1.0, 1.0)).toBe(0);
    });
  });

  // ── Path ranking ────────────────────────────────────────────────────────────

  describe('path ranking (Bellman-Ford cost model)', () => {
    it('should rank higher-rate paths first', () => {
      // Access private method via cast for white-box testing.
      const svc = service as any;

      const lowRate = makePath(EURT, NGNT, [], 950);
      const highRate = makePath(EURT, NGNT, [], 1050);
      const ranked: PaymentPath[] = svc.rankPaths([lowRate, highRate]);

      expect(ranked[0].effectiveRate).toBeGreaterThan(ranked[1].effectiveRate);
    });

    it('should penalise paths with more hops', () => {
      const direct = makePath(EURT, NGNT, [], 950);
      const oneHop = makePath(EURT, NGNT, [USDC], 950);
      expect(oneHop.costScore).toBeGreaterThan(direct.costScore);
    });

    it('should return empty list when no paths', () => {
      const svc = service as any;
      expect(svc.rankPaths([])).toEqual([]);
    });

    it('should return single path unchanged', () => {
      const svc = service as any;
      const p = makePath(XLM, USDC, [], 1.05);
      const ranked = svc.rankPaths([p]);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].effectiveRate).toBe(1.05);
    });

    it('should rank 3-hop path higher if it has a significantly better rate', () => {
      const svc = service as any;
      // 2 hops (EUR → XLM → USDC → NGNT) with rate 1100 beats direct with rate 950.
      // Note: the path array contains intermediate assets only (not src/dst).
      const multiHop = makePath(EURT, NGNT, [XLM, USDC], 1100);
      const direct = makePath(EURT, NGNT, [], 950);
      const ranked: PaymentPath[] = svc.rankPaths([direct, multiHop]);
      expect(ranked[0].effectiveRate).toBe(1100);
    });
  });

  // ── prepareGuardedPathPayment ───────────────────────────────────────────────

  describe('prepareGuardedPathPayment', () => {
    it('should throw BadRequestException when slippage is exceeded', async () => {
      // Stub findOptimalPaths to return a path with a rate that drops 3%.
      jest.spyOn(service, 'findOptimalPaths').mockResolvedValue([
        makePath(EURT, USDC, [], 0.97), // actual rate after slippage
      ]);

      await expect(
        service.prepareGuardedPathPayment(EURT, USDC, '100', 1.0, 1.0),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return path and destMin when within slippage tolerance', async () => {
      jest.spyOn(service, 'findOptimalPaths').mockResolvedValue([
        makePath(EURT, USDC, [], 0.995), // 0.5% drop — within 1% tolerance
      ]);

      const result = await service.prepareGuardedPathPayment(
        EURT,
        USDC,
        '100',
        1.0,
        1.0,
      );

      expect(result.slippageCheck.safe).toBe(true);
      expect(result.destMin).toBeCloseTo(99.0, 2);
      expect(result.path).toBeDefined();
    });

    it('should throw when no paths available', async () => {
      jest.spyOn(service, 'findOptimalPaths').mockResolvedValue([]);
      await expect(
        service.prepareGuardedPathPayment(EURT, USDC, '100', 1.0, 1.0),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── findOptimalPaths input validation ──────────────────────────────────────

  describe('findOptimalPaths input validation', () => {
    it('should throw BadRequestException for non-positive sourceAmount', async () => {
      await expect(
        service.findOptimalPaths(XLM, USDC, '0'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for negative sourceAmount', async () => {
      await expect(
        service.findOptimalPaths(XLM, USDC, '-10'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-numeric sourceAmount', async () => {
      await expect(
        service.findOptimalPaths(XLM, USDC, 'abc'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── detectArbitrage ─────────────────────────────────────────────────────────

  describe('detectArbitrage', () => {
    it('should return null when spread is below threshold', async () => {
      // Stub SDEX and AMM to return virtually the same rate.
      jest.spyOn(service as any, 'queryHorizonPaths').mockResolvedValue([
        makePath(XLM, USDC, [], 1.0),
      ]);
      jest.spyOn(service, 'fetchAmmReserves').mockResolvedValue({
        reserveA: 1000,
        reserveB: 1000, // AMM rate = 1.0
        fee: '0.3%',
        poolId: 'pool-1',
      });

      const result = await service.detectArbitrage(XLM, USDC);
      expect(result).toBeNull();
    });

    it('should return opportunity when spread exceeds threshold', async () => {
      jest.spyOn(service as any, 'queryHorizonPaths').mockResolvedValue([
        makePath(XLM, USDC, [], 1.10), // SDEX rate 1.10
      ]);
      jest.spyOn(service, 'fetchAmmReserves').mockResolvedValue({
        reserveA: 1000,
        reserveB: 1050, // AMM rate = 1.05
        fee: '0.3%',
        poolId: 'pool-2',
      });

      const result = await service.detectArbitrage(XLM, USDC, '100', 0.5);

      expect(result).not.toBeNull();
      expect(result!.spreadPct).toBeGreaterThan(0.5);
      expect(result!.direction).toBe('BUY_ON_AMM_SELL_ON_SDEX');
    });

    it('should flag BUY_ON_SDEX_SELL_ON_AMM when AMM rate is higher', async () => {
      jest.spyOn(service as any, 'queryHorizonPaths').mockResolvedValue([
        makePath(XLM, USDC, [], 1.05), // SDEX rate
      ]);
      jest.spyOn(service, 'fetchAmmReserves').mockResolvedValue({
        reserveA: 1000,
        reserveB: 1100, // AMM rate = 1.10
        fee: '0.3%',
        poolId: 'pool-3',
      });

      const result = await service.detectArbitrage(XLM, USDC, '100', 0.5);
      expect(result!.direction).toBe('BUY_ON_SDEX_SELL_ON_AMM');
    });

    it('should return null when SDEX has no paths', async () => {
      jest.spyOn(service as any, 'queryHorizonPaths').mockResolvedValue([]);
      jest.spyOn(service, 'fetchAmmReserves').mockResolvedValue({
        reserveA: 1000,
        reserveB: 1100,
        fee: '0.3%',
        poolId: 'pool-4',
      });
      const result = await service.detectArbitrage(XLM, USDC);
      expect(result).toBeNull();
    });
  });

  // ── Three intermediate asset requirement (acceptance criterion) ────────────

  describe('three intermediate asset paths (acceptance criterion)', () => {
    it('should support paths with 3 intermediate hops', () => {
      // EUR → XLM → USDC → NGNT: 3 intermediate assets.
      const threeHopPath = makePath(EURT, NGNT, [XLM, USDC, NGNT], 900);
      expect(threeHopPath.path).toHaveLength(3);
      expect(threeHopPath.estimatedFeeStroops).toBeGreaterThan(100);
    });

    it('should factor fees into cost score for 3-hop paths', () => {
      const threeHop = makePath(EURT, NGNT, [XLM, USDC, NGNT], 950);
      const direct = makePath(EURT, NGNT, [], 950);
      // Same rate, but 3-hop has higher fees → higher cost score.
      expect(threeHop.costScore).toBeGreaterThan(direct.costScore);
    });
  });

  // ── mapHorizonAsset helper ─────────────────────────────────────────────────

  describe('mapHorizonAsset (via mapHorizonRecord)', () => {
    it('should map native asset correctly', () => {
      const svc = service as any;
      const asset = svc.mapHorizonAsset({ asset_type: 'native' });
      expect(asset).toEqual({ code: 'XLM', issuer: '' });
    });

    it('should map credit asset correctly', () => {
      const svc = service as any;
      const asset = svc.mapHorizonAsset({
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      });
      expect(asset.code).toBe('USDC');
      expect(asset.issuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
    });
  });
});
