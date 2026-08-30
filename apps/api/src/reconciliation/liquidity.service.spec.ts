import {
  calculateThresholdAmount,
  forecastWeeklyDemandFromVolumes,
  LIQUIDITY_THRESHOLD_RATIO,
} from './liquidity.service';

describe('liquidity forecasting', () => {
  it('uses the average of valid weekly volumes', () => {
    expect(forecastWeeklyDemandFromVolumes([100, 200, 300])).toBe(200);
  });

  it('ignores invalid and negative observations', () => {
    expect(forecastWeeklyDemandFromVolumes([100, -10, Number.NaN, 300])).toBe(200);
  });

  it('returns zero when there is no usable history', () => {
    expect(forecastWeeklyDemandFromVolumes([Number.NaN, -1])).toBe(0);
  });

  it('sets the configured 20 percent trigger threshold', () => {
    expect(calculateThresholdAmount(10_000)).toBe(10_000 * LIQUIDITY_THRESHOLD_RATIO);
  });
});
