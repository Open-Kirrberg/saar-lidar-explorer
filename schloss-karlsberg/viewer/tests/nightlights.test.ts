import { describe, expect, it } from 'vitest';
import { CANDELABRUM_CD, TABLE_CANDLES, groupPanes, litShare, mantelCandelabra, tableCandelabra, windowGlow, windowLight, type P3 } from '../src/nightlights.ts';

describe('night lights (wave-1 review of KB-I06)', () => {
  it('lit share: Corps de logis most, walls none, service buildings few', () => {
    expect(litShare('CDL')).toBeGreaterThan(0.1);
    expect(litShare('CDL')).toBeLessThanOrEqual(0.2);
    expect(litShare('WALL')).toBe(0);
    expect(litShare('FARM')).toBeLessThan(litShare('WING2'));
  });

  it('groupPanes joins an arched head with its window, keeps neighbours apart', () => {
    const panes: P3[] = [
      [0, 2, 0],
      [0, 4, 0.1], // head of the same opening
      [3, 2, 0], // next window
      [0, 7.5, 0], // the storey above
    ];
    const w = groupPanes(panes);
    expect(w[0]).toBe(w[1]);
    expect(w[2]).not.toBe(w[0]);
    expect(w[3]).not.toBe(w[0]);
    expect(new Set(w).size).toBe(3);
  });

  it('windowLight is deterministic, 0 or 0.55…1, and hits about the requested share', () => {
    expect(windowLight('KB-B01', [1, 2, 3], 0.5)).toBe(windowLight('KB-B01', [1.1, 2.1, 3.1], 0.5)); // rounded to 0.5 m
    let lit = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const l = windowLight('KB-B01', [i * 1.7, 3, 0], 0.16);
      if (l > 0) {
        lit++;
        expect(l).toBeGreaterThanOrEqual(0.55);
        expect(l).toBeLessThanOrEqual(1);
      }
    }
    expect(lit / N).toBeGreaterThan(0.12);
    expect(lit / N).toBeLessThan(0.2);
    expect(windowLight('KB-B01', [0, 0, 0], 0)).toBe(0);
  });

  it('windowGlow: off above −1°, full below −4°, monotone', () => {
    expect(windowGlow(5)).toBe(0);
    expect(windowGlow(-1)).toBe(0);
    expect(windowGlow(-4)).toBe(1);
    expect(windowGlow(-10)).toBe(1);
    expect(windowGlow(-2.5)).toBeCloseTo(0.5, 9);
  });

  it('mantelCandelabra: two candelabra on the long side above the shelf, none on implausible boxes', () => {
    const along = mantelCandelabra({ min: [-4, 0, 2.2], max: [-3.6, 1.2, 4.2] }); // fireplace on a west wall
    expect(along).toHaveLength(2);
    for (const p of along) {
      expect(p[0]).toBeCloseTo(-3.8, 9);
      expect(p[1]).toBeCloseTo(1.5, 9);
    }
    expect(Math.abs(along[0][2] - along[1][2])).toBeCloseTo(2 * 0.38 * 2, 9);
    expect(mantelCandelabra({ min: [0, 0, 0], max: [5, 1, 0.5] })).toEqual([]); // too wide
    expect(mantelCandelabra({ min: [0, 0, 0], max: [2, 1, 2] })).toEqual([]); // too deep
    expect(CANDELABRUM_CD).toBe(3); // three candles of ≈ 1 cd
  });
});

describe('wave 10: candles in view (table candelabra)', () => {
  it('a laid table carries 2–3 candelabra on its centre line, along its long axis, on the top', () => {
    const along = tableCandelabra({ min: [0, 0.7, 0], max: [5, 0.75, 1.2] });
    expect(along.length).toBe(2);
    for (const p of along) {
      expect(p[1]).toBe(0.75);
      expect(p[2]).toBeCloseTo(0.6, 9);
      expect(p[0]).toBeGreaterThan(0);
      expect(p[0]).toBeLessThan(5);
    }
    expect(along[0][0] + along[1][0]).toBeCloseTo(5, 9);
    const across = tableCandelabra({ min: [0, 0.7, 0], max: [1.4, 0.75, 8] });
    expect(across.length).toBe(TABLE_CANDLES.max);
    for (const p of across) expect(p[0]).toBeCloseTo(0.7, 9);
    // too small for a laid table: none
    expect(tableCandelabra({ min: [0, 0.7, 0], max: [0.8, 0.75, 0.6] })).toEqual([]);
  });
});
