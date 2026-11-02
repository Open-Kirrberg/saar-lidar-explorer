/**
 * Wave 9 (garden, audit #1): natural pond shores, the water grid on the terrain vertices (model/src/site/shore.ts).
 */
import { describe, expect, it } from 'vitest';
import { SHORE, naturalShore, shallowTint, shoreFade, shoreWater } from '../src/site/shore.ts';
import type { TerrainFeature } from '../src/spec.ts';

const sq: [number, number][] = [
  [0, 0],
  [20, 0],
  [20, 20],
  [0, 20],
];
const pond = (o: Partial<TerrainFeature>): TerrainFeature =>
  ({ id: 'TF-X', kind: 'pond', name: 'Weiher', geometry: { type: 'Polygon', coordinates: [sq] }, water_level: 100, ...o }) as TerrainFeature;

/** A bowl: 99 m at (10, 10), rising 0.1 m per m. */
const bowl = (x: number, z: number) => 99 + 0.1 * Math.hypot(x - 10, z - 10);

describe('natural shores', () => {
  it('applies to plain ponds with a water level only (no coping, no Bassin)', () => {
    expect(naturalShore(pond({}))).toBe(true);
    expect(naturalShore(pond({ coping: { width: 0.4, height: 0.3 } } as Partial<TerrainFeature>))).toBe(false);
    expect(naturalShore(pond({ name: 'Großes Bassin' }))).toBe(false);
    expect(naturalShore(pond({ water_level: undefined }))).toBe(false);
    expect(naturalShore(pond({ kind: 'lawn' } as Partial<TerrainFeature>))).toBe(false);
  });

  it('tints the shallow water toward the bed and fades to none by SHORE.shallow m of depth', () => {
    const t0 = shallowTint(0);
    expect(t0[0]).toBeCloseTo(1 + (SHORE.tint[0] - 1) * SHORE.tintWeight, 6);
    expect(shallowTint(SHORE.shallow)).toEqual([1, 1, 1]);
    expect(shallowTint(5)).toEqual([1, 1, 1]);
    let last = Infinity;
    for (let d = 0; d <= SHORE.shallow; d += 0.05) {
      const r = shallowTint(d)[0];
      expect(r).toBeLessThanOrEqual(last + 1e-12);
      last = r;
    }
  });

  it('lays the water on the terrain vertices (k + 0.5), facing up, only where the ground is below the level', () => {
    const m = shoreWater(sq, 100, bowl);
    expect(m).not.toBeNull();
    const { positions: p, index: idx, colors } = m!;
    expect(colors.length).toBe(p.length);
    for (let i = 0; i < p.length; i += 3) {
      expect(Math.abs(p[i] - Math.floor(p[i]) - 0.5)).toBeLessThan(1e-6);
      expect(Math.abs(p[i + 2] - Math.floor(p[i + 2]) - 0.5)).toBeLessThan(1e-6);
      expect(p[i + 1]).toBe(100);
    }
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 2] - p[a * 3 + 2]];
      const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 2] - p[a * 3 + 2]];
      // normal y = e1.z·e2.x − e1.x·e2.z > 0 (up)
      expect(e1[1] * e2[0] - e1[0] * e2[1]).toBeGreaterThan(0);
    }
    // every cell (two triangles) has a corner whose ground lies below the level + SHORE.under
    for (let t = 0; t < idx.length; t += 6) expect([...idx.subarray(t, t + 6)].some((v) => bowl(p[v * 3], p[v * 3 + 2]) < 100 + SHORE.under)).toBe(true);
    // the shore of the bowl (ground = level at r 10 m) bounds the water: no vertex beyond r ≈ 10 + under/0.1 + a cell
    for (let i = 0; i < p.length; i += 3) expect(Math.hypot(p[i] - 10, p[i + 2] - 10)).toBeLessThan(10 + SHORE.under / 0.1 + 1.5);
  });

  it('wave-9 review fix: fades the water in over the first SHORE.fade m of depth from the true waterline', () => {
    expect(SHORE.fade).toBeCloseTo(0.3, 6);
    expect(shoreFade(-0.5)).toBe(0);
    expect(shoreFade(0)).toBe(0);
    expect(shoreFade(SHORE.fade / 2)).toBeCloseTo(0.5, 6);
    expect(shoreFade(SHORE.fade)).toBe(1);
    expect(shoreFade(3)).toBe(1);
    // per vertex the unclamped depth level − ground (negative above the waterline), so the interpolated depth on the
    // terrain's own triangles is the true depth and the fade is 0 exactly on the waterline (no grid contour)
    const m = shoreWater(sq, 100, bowl)!;
    expect(m.depths.length).toBe(m.positions.length / 3);
    let above = 0;
    for (let v = 0; v < m.depths.length; v++) {
      const x = m.positions[v * 3];
      const z = m.positions[v * 3 + 2];
      expect(m.depths[v]).toBeCloseTo(100 - bowl(x, z), 5);
      if (m.depths[v] < 0) above++;
    }
    expect(above).toBeGreaterThan(0);
  });

  it('returns null when nothing is wet', () => {
    expect(shoreWater(sq, 100, () => 105)).toBeNull();
  });
});
