import { describe, expect, it } from 'vitest';
import { dayOfYear, sunPosition } from '../src/sun.ts';

describe('sun position for Homburg (49.336 N)', () => {
  it('noon elevation on 15 July ≈ 90 − lat + decl (≈ 62°), azimuth ≈ south', () => {
    const doy = dayOfYear(1789, 7, 15);
    // local mean noon + equation of time (~ -6 min in mid July) -> true noon ≈ 12:06 LMT
    let best = { elevation: -90, azimuth: 0 };
    for (let h = 11.5; h <= 12.7; h += 0.01) {
      const p = sunPosition(doy, h);
      if (p.elevation > best.elevation) best = p;
    }
    expect(best.elevation).toBeGreaterThan(61);
    expect(best.elevation).toBeLessThan(63);
    expect(Math.abs(best.azimuth - 180)).toBeLessThan(2);
  });

  it('morning sun stands in the east, evening sun in the west', () => {
    const doy = dayOfYear(1789, 7, 15);
    expect(sunPosition(doy, 8).azimuth).toBeGreaterThan(70);
    expect(sunPosition(doy, 8).azimuth).toBeLessThan(120);
    expect(sunPosition(doy, 18).azimuth).toBeGreaterThan(240);
    expect(sunPosition(doy, 18).azimuth).toBeLessThan(290);
  });

  it('day of year', () => {
    expect(dayOfYear(1789, 1, 1)).toBe(1);
    expect(dayOfYear(1789, 7, 15)).toBe(196);
    expect(dayOfYear(1788, 3, 1)).toBe(61);
  });
});
