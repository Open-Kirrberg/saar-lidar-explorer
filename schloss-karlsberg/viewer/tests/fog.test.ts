import { describe, expect, it } from 'vitest';
import { FOG_H0, fogAmount, fogFor, opticalDepth } from '../src/fog.ts';

describe('height fog (KB-I07)', () => {
  const noon = fogFor(12);
  it('keeps the palace clear from view-west (≈ 250 m) and hazes the crop edge (≈ 2 km)', () => {
    expect(fogAmount(noon, FOG_H0 + 15, FOG_H0, 250)).toBeLessThan(0.06);
    const edge = fogAmount(noon, FOG_H0 + 15, FOG_H0 - 45, 2000);
    expect(edge).toBeGreaterThan(0.4);
    expect(edge).toBeLessThan(0.7);
  });

  it('is denser in the morning and at the golden hour than at noon', () => {
    expect(fogFor(6.5).a).toBeGreaterThan(noon.a);
    expect(fogFor(6.5).b).toBeGreaterThan(noon.b); // thinner layer
    expect(fogFor(19.5).a).toBeGreaterThan(noon.a);
    expect(fogFor(14).a).toBe(noon.a);
    // wave-1 review: full morning mist (×1.6, scale height 250 m) holds from 5:30 to 7:30, gone by 9:00
    for (const h of [5.5, 7, 7.5]) {
      expect(fogFor(h).a).toBeCloseTo(noon.a * 1.6, 12);
      expect(1 / fogFor(h).b).toBeCloseTo(250, 9);
    }
    expect(fogFor(8.25).a).toBeLessThan(fogFor(7).a);
    expect(fogFor(9).a).toBe(noon.a);
    expect(fogFor(4).a).toBe(noon.a);
  });

  it('thins with height and grows with distance', () => {
    expect(fogAmount(noon, FOG_H0 + 300, FOG_H0 + 300, 1000)).toBeLessThan(fogAmount(noon, FOG_H0, FOG_H0, 1000));
    expect(fogAmount(noon, FOG_H0, FOG_H0, 2000)).toBeGreaterThan(fogAmount(noon, FOG_H0, FOG_H0, 1000));
    expect(fogAmount(noon, FOG_H0, FOG_H0, 0)).toBe(0);
  });

  it('optical depth: the horizontal-ray limit equals a · t · (1 + t / grow), continuous at k → 0', () => {
    const t = 800;
    expect(opticalDepth(noon, FOG_H0, 0, t)).toBeCloseTo(noon.a * t * (1 + t / noon.grow), 12);
    const near = opticalDepth(noon, FOG_H0, 1e-7, t);
    const far = opticalDepth(noon, FOG_H0, 1e-3, t);
    expect(near / opticalDepth(noon, FOG_H0, 0, t)).toBeCloseTo(1, 5);
    // both branches of the series switch agree around |k| = 1e-4
    const k = (dy: number) => opticalDepth(noon, FOG_H0, dy, t);
    const dyAt = 1e-4 / (noon.b * t);
    expect(k(dyAt * 0.999) / k(dyAt * 1.001)).toBeCloseTo(1, 6);
    expect(far).toBeLessThan(near); // looking up: less fog
  });

  it('matches a numeric integral of a · exp(−b (h − h0)) along a slanted ray', () => {
    const cam = FOG_H0 + 120;
    const dy = -0.2;
    const t = 1500;
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const s = ((i + 0.5) / n) * t;
      sum += noon.a * Math.exp(-noon.b * (cam + dy * s - FOG_H0)) * (t / n);
    }
    expect(opticalDepth(noon, cam, dy, t) / (1 + t / noon.grow)).toBeCloseTo(sum, 6);
  });
});
