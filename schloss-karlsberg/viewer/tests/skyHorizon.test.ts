import { describe, expect, it } from 'vitest';
import { HORIZON_SOFT, horizonSoftness, softHorizonY } from '../src/light.ts';

describe('night sky horizon seam (pose 52)', () => {
  it('is off by day and at sunset, full from 4° below the horizon', () => {
    expect(horizonSoftness(30)).toBe(0);
    expect(horizonSoftness(0)).toBe(0);
    expect(horizonSoftness(-4)).toBeCloseTo(HORIZON_SOFT, 12);
    expect(horizonSoftness(-20)).toBeCloseTo(HORIZON_SOFT, 12);
    let prev = 0;
    for (let e = 0; e >= -4; e -= 0.25) {
      const k = horizonSoftness(e);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
  });
  it('k = 0 is exactly the stock max(0, y): day frames are unchanged', () => {
    for (const y of [-1, -0.3, -1e-4, 0, 1e-4, 0.2, 0.7, 1]) expect(softHorizonY(y, 0)).toBe(Math.max(0, y));
  });
  it('k > 0 is a smooth maximum, never above 1 (acos stays defined), close to y high up', () => {
    const k = HORIZON_SOFT;
    let prev = -1;
    for (let y = -1; y <= 1.0001; y += 0.01) {
      const s = softHorizonY(y, k);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(Math.max(0, Math.min(1, y)) - 1e-12);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
    expect(softHorizonY(0, k)).toBeCloseTo(k / 2, 12);
    expect(softHorizonY(0.5, k) - 0.5).toBeLessThan(0.002);
  });
});
