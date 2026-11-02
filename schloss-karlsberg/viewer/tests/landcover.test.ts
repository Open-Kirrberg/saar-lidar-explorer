import { describe, expect, it } from 'vitest';
import { GROUND_CLASS, edgeDistance, forestPlan, meanDownslope, noiseLattice, packGround, tileKey, type GroundGrid } from '../src/landcover.ts';

const grid = (cols: number, rows: number, f: (c: number, r: number) => number, cell = 2): GroundGrid => {
  const ground = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ground[r * cols + c] = f(c, r);
  return { ground, cols, rows, cell };
};

describe('packGround (KB-I09 splat channels)', () => {
  it('puts every class in its own channel; meadow stays empty', () => {
    const classes = Object.values(GROUND_CLASS);
    const g = grid(classes.length, 1, (c) => classes[c]);
    const p = packGround(g);
    const at = (a: Uint8Array, k: number) => Array.from(a.slice(classes.indexOf(k) * 4, classes.indexOf(k) * 4 + 4));
    expect(at(p.weights, GROUND_CLASS.meadow)).toEqual([0, 0, 0, 0]);
    expect(at(p.cult, GROUND_CLASS.meadow)).toEqual([0, 0, 0, 0]);
    expect(at(p.weights, GROUND_CLASS.lawn)).toEqual([255, 0, 0, 0]);
    expect(at(p.weights, GROUND_CLASS.forest)).toEqual([0, 0, 255, 0]);
    expect(at(p.weights, GROUND_CLASS.water)).toEqual([0, 0, 0, 255]);
    expect(at(p.cult, GROUND_CLASS.hay)).toEqual([255, 0, 0, 0]);
    expect(at(p.cult, GROUND_CLASS.field)).toEqual([0, 255, 0, 0]);
    expect(at(p.cult, GROUND_CLASS.vineyard)).toEqual([0, 0, 255, 0]);
    expect(at(p.cult, GROUND_CLASS.kitchen_garden)).toEqual([0, 0, 0, 255]);
    for (const k of [GROUND_CLASS.gravel, GROUND_CLASS.cobbles, GROUND_CLASS.sand, GROUND_CLASS.building, GROUND_CLASS.parterre_sand]) {
      expect(at(p.weights, k)).toEqual([0, 255, 0, 0]);
    }
    expect(at(p.hard, GROUND_CLASS.gravel)).toEqual([255, 0, 0, 0]);
    expect(at(p.hard, GROUND_CLASS.cobbles)).toEqual([0, 255, 0, 0]);
    expect(at(p.hard, GROUND_CLASS.sand)).toEqual([0, 0, 255, 0]);
    expect(at(p.hard, GROUND_CLASS.parterre_sand)).toEqual([0, 0, 0, 255]);
    // each texel's weights + cult sum to 255 (one class) or 0 (meadow)
    for (let i = 0; i < classes.length; i++) {
      let s = 0;
      for (let j = 0; j < 4; j++) s += p.weights[i * 4 + j] + p.cult[i * 4 + j];
      expect([0, 255]).toContain(s);
    }
  });

  it('turns gravel inside a sand court into court sand with the lane macro factor', () => {
    const g = grid(3, 1, () => GROUND_CLASS.gravel);
    const p = packGround(g, (i) => (i === 1 ? 0 : null), (_near, lane) => (lane === 0 ? 0.5 : 1));
    expect(Array.from(p.hard.slice(4, 8))).toEqual([0, 0, 255, 0]);
    expect(p.macro[4]).toBe(64);
    expect(Array.from(p.hard.slice(0, 4))).toEqual([255, 0, 0, 0]);
    expect(p.macro[0]).toBe(128);
  });

  it('marks cells next to buildings for the edge wear (G of the macro texture)', () => {
    const g = grid(5, 1, (c) => (c === 0 ? GROUND_CLASS.building : GROUND_CLASS.sand));
    const p = packGround(g);
    expect(p.macro[1 * 4 + 1]).toBe(255);
    expect(p.macro[2 * 4 + 1]).toBeGreaterThan(0);
    expect(p.macro[2 * 4 + 1]).toBeLessThan(255);
    expect(p.macro[4 * 4 + 1]).toBe(0);
  });
});

describe('edgeDistance', () => {
  it('measures metres to the nearest other class, ignoring the crop edge', () => {
    const g = grid(21, 21, (c, r) => (c >= 5 && c < 16 && r >= 5 && r < 16 ? GROUND_CLASS.forest : GROUND_CLASS.meadow));
    const d = edgeDistance(g);
    expect(d[0]).toBe(0);
    expect(d[5 * 21 + 5]).toBeCloseTo(2, 5); // corner cell: one cell (2 m) from the meadow
    expect(d[10 * 21 + 10]).toBeCloseTo(12, 5); // centre: 6 cells
    const all = grid(4, 4, () => GROUND_CLASS.forest);
    expect(Math.min(...edgeDistance(all))).toBeGreaterThan(1e5);
  });
});

describe('forestPlan (S1 forest edge, KB-I10 input)', () => {
  // a 400 × 300 m forest block in open land
  const g = grid(300, 200, (c, r) => (c >= 50 && c < 250 && r >= 25 && r < 175 ? GROUND_CLASS.forest : GROUND_CLASS.hay));
  const plan = forestPlan(g);
  const cls = (t: { gx: number; gy: number }) => g.ground[Math.floor(t.gy / g.cell) * g.cols + Math.floor(t.gx / g.cell)];

  it('is deterministic and stays on forest cells', () => {
    expect(forestPlan(g)).toEqual(plan);
    expect(plan.length).toBeGreaterThan(500);
    for (const t of plan) expect(cls(t)).toBe(GROUND_CLASS.forest);
  });

  it('puts the shrub mantle in the outer band and keeps canopy trees out of it', () => {
    const mantle = plan.filter((t) => t.role === 'mantle');
    expect(mantle.length).toBeGreaterThan(100);
    for (const t of mantle) expect(t.edge).toBeLessThanOrEqual(6);
    for (const t of plan.filter((x) => x.role !== 'mantle')) expect(t.edge).toBeGreaterThanOrEqual(3);
  });

  it('mixes ~20 % taller standards near the edge and keeps the species shares', () => {
    const band = plan.filter((t) => t.role !== 'mantle' && t.edge < 20);
    const std = band.filter((t) => t.role === 'standard');
    expect(std.length / band.length).toBeGreaterThan(0.12);
    expect(std.length / band.length).toBeLessThan(0.28);
    for (const t of std) expect(t.scale).toBeGreaterThan(1.1);
    const trees = plan.filter((t) => t.role !== 'mantle');
    const share = (k: string) => trees.filter((t) => t.species === k).length / trees.length;
    expect(share('fagus')).toBeGreaterThan(0.65);
    expect(share('fagus')).toBeLessThan(0.75);
    expect(share('quercus')).toBeGreaterThan(0.15);
    expect(share('carpinus')).toBeGreaterThan(0.06);
  });
});

describe('meanDownslope and tileKey', () => {
  it('finds the down-slope direction of a class', () => {
    const g = { ...grid(10, 10, () => GROUND_CLASS.vineyard), west: 0, north: 20 };
    // height falls toward +x (east): rows run east-west
    const d = meanDownslope(g, GROUND_CLASS.vineyard, (x) => 300 - 0.2 * x, 0, 0)!;
    expect(d[0]).toBeCloseTo(1, 6);
    expect(d[1]).toBeCloseTo(0, 6);
    expect(meanDownslope(g, GROUND_CLASS.field, () => 1, 0, 0)).toBeNull();
  });
  it('buckets points into tiles', () => {
    expect(tileKey(10, 10, 320)).toBe('0_0');
    expect(tileKey(330, 650, 320)).toBe('1_2');
  });
});

describe('noiseLattice', () => {
  it('is deterministic, fills all channels and is roughly uniform', () => {
    const a = noiseLattice(64, 3);
    expect(a.length).toBe(64 * 64 * 4);
    expect(noiseLattice(64, 3)).toEqual(a);
    expect(noiseLattice(64, 4)).not.toEqual(a);
    for (let ch = 0; ch < 4; ch++) {
      let s = 0;
      for (let i = ch; i < a.length; i += 4) s += a[i];
      expect(s / (64 * 64)).toBeGreaterThan(118);
      expect(s / (64 * 64)).toBeLessThan(137);
    }
  });
});
