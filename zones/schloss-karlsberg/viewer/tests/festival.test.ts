import { describe, expect, it } from 'vitest';
import { FEST_CORE_MAX, FEST_FAR_FLOOR, FEST_MIN_PX, FEST_POOL_MAX, festCoreLevel, festPointSize, festPoolLevel, festivalOn } from '../src/festivalMath.ts';
import { evOutdoor, preExposure } from '../src/light.ts';
import { bloomThreshold } from '../src/postMath.ts';

describe('KB-I48 Festbeleuchtung levels (festivalMath.ts)', () => {
  it('burns only when enabled and dark: none by day, full from −4°', () => {
    expect(festivalOn(false, -15)).toBe(0);
    expect(festivalOn(true, 20)).toBe(0);
    expect(festivalOn(true, 1)).toBe(0);
    expect(festivalOn(true, -4)).toBe(1);
    expect(festivalOn(true, -1.5)).toBeGreaterThan(0);
    expect(festivalOn(true, -1.5)).toBeLessThan(1);
  });

  it('a lamp core blooms at night but stays below the bloom clamp; pools stay a warm wash', () => {
    const pre = preExposure(evOutdoor(-13.7)); // 22:00
    const core = festCoreLevel('lampion', pre, 1);
    expect(core).toBeGreaterThan(bloomThreshold(1));
    expect(core).toBeLessThanOrEqual(FEST_CORE_MAX);
    expect(festCoreLevel('pot', pre, 1)).toBeGreaterThanOrEqual(core);
    const pool = festPoolLevel('lampion', pre, 1);
    expect(pool).toBeGreaterThan(0.02);
    expect(pool).toBeLessThanOrEqual(FEST_POOL_MAX);
    expect(festPoolLevel('pot', pre, 1)).toBeGreaterThanOrEqual(pool);
    // off = nothing
    expect(festCoreLevel('lampion', pre, 0)).toBe(0);
    expect(festPoolLevel('pot', pre, 0)).toBe(0);
  });

  it('far lamps keep a minimum size and a share of their energy; near ones are drawn true to size', () => {
    const scale = 1080 / (2 * Math.tan((50 * Math.PI) / 360));
    const near = festPointSize(0.2, 5, scale);
    expect(near.px).toBeGreaterThan(FEST_MIN_PX);
    expect(near.k).toBe(1);
    const far = festPointSize(0.2, 800, scale);
    expect(far.px).toBe(FEST_MIN_PX);
    expect(far.k).toBe(FEST_FAR_FLOOR);
    const mid = festPointSize(0.2, 80, scale);
    expect(mid.k).toBeGreaterThanOrEqual(FEST_FAR_FLOOR);
    expect(mid.k).toBeLessThanOrEqual(1);
  });
});
