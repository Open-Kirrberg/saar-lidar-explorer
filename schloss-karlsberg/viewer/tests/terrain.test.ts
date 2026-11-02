import { describe, expect, it } from 'vitest';
import { courtMacro, ringAxis } from '../src/terrain.ts';

describe('court ground detail (P12, wave-1 review)', () => {
  it('ringAxis finds the long edge and the centroid (closed or open ring)', () => {
    const open: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 40],
      [0, 40],
    ];
    const a = ringAxis(open);
    expect(Math.abs(a.dir[0])).toBeCloseTo(0, 9);
    expect(Math.abs(a.dir[1])).toBeCloseTo(1, 9);
    expect(a.centre).toEqual([5, 20]);
    const closed = ringAxis([...open, [0, 0]]);
    expect(closed.centre).toEqual([5, 20]);
  });

  it('courtMacro: darker damp plinth edge and carriage lane, plain elsewhere', () => {
    expect(courtMacro(0, Infinity)).toBe(1);
    expect(courtMacro(1, Infinity)).toBeCloseTo(0.86, 9);
    expect(courtMacro(2, Infinity)).toBeCloseTo(0.96, 9);
    expect(courtMacro(3, Infinity)).toBe(1);
    expect(courtMacro(0, 0)).toBeCloseTo(0.93, 9);
    expect(courtMacro(0, 1.5)).toBeCloseTo(0.93, 9);
    expect(courtMacro(0, 4)).toBeCloseTo(1, 9);
    expect(courtMacro(0, 2.75)).toBeGreaterThan(0.93);
    expect(courtMacro(0, 2.75)).toBeLessThan(1);
    expect(courtMacro(1, 0)).toBeCloseTo(0.86 * 0.93, 9);
  });
});
