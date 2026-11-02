import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { JET_SPRAY, WET_BANK, densifyRing, jetSpray, offsetRing, ringArea, sprayPoint, wetBank, wetShade } from '../src/site/water.ts';

const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

/** Distance from a point to the boundary of the axis-aligned square [0, 10]² (positive outside). */
function outsideDist([x, z]: [number, number]): number {
  const dx = Math.max(-x, x - 10, 0);
  const dz = Math.max(-z, z - 10, 0);
  return Math.hypot(dx, dz);
}

describe('water detail (KB-I37)', () => {
  it('offsetRing moves every vertex outward, for either orientation, closed or open', () => {
    for (const ring of [square, [...square].reverse(), [...square, square[0]]]) {
      const off = offsetRing(ring as [number, number][], 2);
      expect(off).toHaveLength(4);
      for (const p of off) {
        expect(outsideDist(p)).toBeGreaterThan(1.99);
        expect(outsideDist(p)).toBeLessThanOrEqual(2 * Math.SQRT2 + 1e-9);
      }
      expect(Math.abs(ringArea(off))).toBeCloseTo(14 * 14, 6);
    }
  });

  it('densifyRing keeps the shape and splits long edges', () => {
    const d = densifyRing(square, 1.5);
    expect(d.length).toBe(4 * 7);
    expect(ringArea(d)).toBeCloseTo(ringArea(square), 9);
    for (let i = 0; i < d.length; i++) {
      const [a, b] = [d[i], d[(i + 1) % d.length]];
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(1.5);
    }
  });

  it('wetShade: darkest at the water, dry at the band edge or a metre above the water', () => {
    expect(wetShade(0, 0)).toBeCloseTo(WET_BANK.atWater, 9);
    expect(wetShade(1, 0)).toBeCloseTo(WET_BANK.atMid, 9);
    expect(wetShade(2, 0)).toBe(1);
    expect(wetShade(0, WET_BANK.dryAt)).toBe(1);
    expect(wetShade(0, 0.5)).toBeGreaterThan(WET_BANK.atWater);
  });

  it('wetBank lies on the bank above the water and leaves out what would float on water', () => {
    const level = 100;
    // bank rising 0.5 m per metre outside the square
    const terr = (x: number, z: number) => level + 0.5 * outsideDist([x, z]);
    const bank = wetBank(square, level, terr, 'feature/T/bank')!;
    expect(bank).toBeInstanceOf(THREE.Mesh);
    const pos = bank.geometry.getAttribute('position');
    const idx = bank.geometry.getIndex()!;
    expect(idx.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeGreaterThanOrEqual(level);
    // faces point up
    bank.geometry.computeVertexNormals();
    const nrm = bank.geometry.getAttribute('normal');
    let up = 0;
    for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
    expect(up / nrm.count).toBeGreaterThan(0.5);
    expect((bank.material as THREE.Material).name).toBe('water.bank');

    // ground below the water level everywhere around: no bank at all
    expect(wetBank(square, level, () => level - 1, 'x')).toBeNull();
    // a dip in the middle of one side drops the quads there, the rest stays
    const dip = (x: number, z: number) => (z < 0 && x > 3 && x < 7 ? level - 0.5 : terr(x, z));
    const part = wetBank(square, level, dip, 'y')!;
    expect(part.geometry.getIndex()!.count).toBeLessThan(idx.count);
  });

  it('spray droplets stay between the water and the crown, deterministically', () => {
    const h = 5;
    for (const seed of [
      [0, 0, 0],
      [0.3, 0.7, 1],
      [0.99, 0.5, 0.5],
    ] as [number, number, number][])
      for (let t = 0; t < 10; t += 0.37) {
        const [x, y, z] = sprayPoint(seed, h, t);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(h + (JET_SPRAY.kick * JET_SPRAY.kick) / (2 * 9.81) + 1e-9);
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(0.1 + JET_SPRAY.spread[1] * h + 1e-9);
      }
    const a = jetSpray(h, 'HG-04');
    const b = jetSpray(h, 'HG-04');
    expect(Array.from(a.geometry.getAttribute('aSeed').array)).toEqual(Array.from(b.geometry.getAttribute('aSeed').array));
    expect(a.geometry.getAttribute('aSeed').count).toBe(Math.round(JET_SPRAY.perMetre * h));
  });
});
