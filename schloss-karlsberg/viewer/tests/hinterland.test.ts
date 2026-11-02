import { describe, expect, it } from 'vitest';
import { GROUND_CLASS, type GroundGrid } from '../src/landcover.ts';
import { HEDGE_SHARE, HINTERLAND_SPECIES, HINTERLAND_TAGS, hinterlandPlan, type LandcoverParcel } from '../src/hinterland.ts';
import { crownOcclusion, wrapDiffuse } from '../src/foliage.ts';

// KB-I44: hinterland hedgerows and fruit-tree meadows; foliage shading maths mirrored by the shader

const C = GROUND_CLASS;
const grid = (cols: number, rows: number, f: (c: number, r: number) => number, cell = 2): GroundGrid => {
  const ground = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ground[r * cols + c] = f(c, r);
  return { ground, cols, rows, cell };
};
const classAt = (g: GroundGrid, t: { gx: number; gy: number }) => g.ground[Math.floor(t.gy / g.cell) * g.cols + Math.floor(t.gx / g.cell)];

// a 1200 m × 800 m crop: field in the west half, hay in the east half, forest strip in the far south,
// one building at (900, 300) (a farmstead), a gravel way at x = 300 m
const W = 600;
const H = 400;
const g = grid(W, H, (c, r) => {
  const x = c * 2;
  const y = r * 2;
  if (y > 740) return C.forest;
  if (Math.abs(x - 900) < 8 && Math.abs(y - 300) < 6) return C.building;
  if (Math.abs(x - 300) < 2) return C.gravel;
  return x < 600 ? C.field : C.hay;
});
const west = 380000;
const north = 5466000;
// parcels in EPSG:25832: the field parcel (west half) and the hay parcel (east half), sharing the edge at x = 600
const poly = (x0: number, y0: number, x1: number, y1: number): number[][][] => [
  [
    [west + x0, north - y0],
    [west + x1, north - y0],
    [west + x1, north - y1],
    [west + x0, north - y1],
    [west + x0, north - y0],
  ],
];
const parcels: LandcoverParcel[] = [
  { id: 'LC-A', cover: 'field', geometry: { type: 'Polygon', coordinates: poly(20, 20, 600, 700) } },
  { id: 'LC-B', cover: 'hay', geometry: { type: 'Polygon', coordinates: poly(600, 20, 1180, 700) } },
  { id: 'LC-F', cover: 'forest', geometry: { type: 'Polygon', coordinates: poly(0, 740, 1200, 800) } },
];
const opts = { west, north, parcels, farms: [{ id: 'KB-X', gx: 900, gy: 300 }], seed: 1789 };

describe('hinterlandPlan (KB-I44)', () => {
  const plan = hinterlandPlan(g, opts);
  const hedges = plan.trees.filter((t) => t.kind !== 'orchard');
  const orchard = plan.trees.filter((t) => t.kind === 'orchard');

  it('is deterministic for the seed', () => {
    expect(hinterlandPlan(g, opts).trees).toEqual(plan.trees);
    expect(hinterlandPlan(g, { ...opts, seed: 7 }).trees).not.toEqual(plan.trees);
  });

  it('plants hedgerows only on field / hay parcel edges, on open land, with gaps and hedge trees', () => {
    expect(hedges.length).toBeGreaterThan(100);
    for (const t of hedges) {
      expect([C.meadow, C.hay, C.field]).toContain(classAt(g, t));
      // within ~5 m of a parcel edge line (x = 20, 600, 1180 or y = 20, 700) after the meander and the hedge depth
      const d = Math.min(Math.abs(t.gx - 20), Math.abs(t.gx - 600), Math.abs(t.gx - 1180), Math.abs(t.gy - 20), Math.abs(t.gy - 700));
      expect(d).toBeLessThan(5.2);
      // clear of the forest (y > 740) and the gravel way at x = 300
      expect(t.gy).toBeLessThan(740 - 8);
      expect(Math.abs(t.gx - 300)).toBeGreaterThan(5);
      expect(t.role).toBe('hedge');
    }
    // the forest parcel edge carries no hedge (that is the mantle's job)
    expect(hedges.some((t) => Math.abs(t.gy - 740) < 4)).toBe(false);
    // wave-3 review: only ~20-35 % of the eligible edge length carries a hedge (no bocage)
    const { eligible, planted } = plan.hedgeLength;
    expect(eligible).toBeGreaterThan(2000);
    expect(planted / eligible).toBeGreaterThan(0.2);
    expect(planted / eligible).toBeLessThan(0.35);
    expect(Math.abs(planted / eligible - HEDGE_SHARE)).toBeLessThan(0.05);
    const trees = hedges.filter((t) => t.kind === 'hedge_tree');
    expect(trees.length).toBeGreaterThan(1);
    expect(trees.length).toBeLessThan(hedges.length / 8);
    // the shared edge at x = 600 is planted once, not twice: its line points are not denser than elsewhere
    const lineDensity = (f: (t: { gx: number; gy: number }) => boolean) => hedges.filter(f).length;
    const shared = lineDensity((t) => Math.abs(t.gx - 600) < 5.2 && t.gy > 30 && t.gy < 690);
    const outer = lineDensity((t) => (Math.abs(t.gx - 20) < 5.2 || Math.abs(t.gx - 1180) < 5.2) && t.gy > 30 && t.gy < 690);
    expect(shared).toBeLessThan(Math.max(30, outer * 1.2));
  });

  it('hedges are irregular masses: 1-3 shrubs deep, 1.5-5 m high, not a single file of equal shrubs', () => {
    const shrubs = hedges.filter((t) => t.kind === 'hedgerow');
    const h = shrubs.map((t) => t.scale * HINTERLAND_SPECIES[t.species].height);
    expect(Math.min(...h)).toBeGreaterThanOrEqual(1.5 - 1e-9);
    expect(Math.max(...h)).toBeLessThanOrEqual(5 + 1e-9);
    expect(Math.max(...h) - Math.min(...h)).toBeGreaterThan(2);
    // depth: some shrubs stand > 1 m off the line next to others (2-3 rows)
    const across = shrubs.map((t) => Math.min(Math.abs(t.gx - 20), Math.abs(t.gx - 600), Math.abs(t.gx - 1180), Math.abs(t.gy - 20), Math.abs(t.gy - 700)));
    expect(across.filter((d) => d > 1.2).length).toBeGreaterThan(shrubs.length * 0.15);
  });

  it('prefers slope balks along the contours over fall-line edges (Stufenraine)', () => {
    // the ground rises 10 % to the south: edges along x (y = const) follow the contours
    const sloped = hinterlandPlan(g, { ...opts, farms: [], height: (_x, y) => 0.1 * y });
    const hs = sloped.trees.filter((t) => t.kind !== 'orchard');
    const contour = hs.filter((t) => Math.abs(t.gy - 20) < 5.2 || Math.abs(t.gy - 700) < 5.2).length;
    const fall = hs.filter((t) => (Math.abs(t.gx - 20) < 5.2 || Math.abs(t.gx - 600) < 5.2 || Math.abs(t.gx - 1180) < 5.2) && t.gy > 30 && t.gy < 690).length;
    // the contour edges are ~0.9 of the length of the fall-line edges here; they get clearly more of the hedges
    expect(contour).toBeGreaterThan(fall * 1.5);
  });

  it('puts a fruit-tree meadow beside the farmstead, on grass, 12-80 m from it, never in the field', () => {
    expect(orchard.length).toBeGreaterThan(10);
    for (const t of orchard) {
      const d = Math.hypot(t.gx - 900, t.gy - 300);
      expect(d).toBeGreaterThan(10);
      expect(d).toBeLessThan(100);
      expect(classAt(g, t)).not.toBe(C.field);
      expect(t.role).toBe('field');
    }
    // the formal core stays clear
    const core = hinterlandPlan(g, { ...opts, core: [900, 300], coreRadius: 200 });
    expect(core.trees.filter((t) => t.kind === 'orchard')).toHaveLength(0);
  });

  it('uses known species and tags every kind as a low-confidence hypothesis', () => {
    const known = new Set([...Object.keys(HINTERLAND_SPECIES), 'quercus']);
    for (const t of plan.trees) expect(known.has(t.species)).toBe(true);
    for (const k of ['hedgerow', 'hedge_tree', 'orchard'] as const) {
      expect(plan.summary[k].count).toBe(plan.trees.filter((t) => t.kind === k).length);
      expect(HINTERLAND_TAGS[k]).toMatch(/\b[NID]\b/);
      expect(HINTERLAND_TAGS[k]).toMatch(/low/);
    }
  });
});

describe('foliage shading maths (KB-I44)', () => {
  it('wrap diffuse is Lambert at w = 0 and lights past the terminator for w > 0', () => {
    expect(wrapDiffuse(0.5, 0)).toBeCloseTo(0.5, 9);
    expect(wrapDiffuse(-0.2, 0)).toBe(0);
    expect(wrapDiffuse(-0.2, 0.45)).toBeGreaterThan(0);
    expect(wrapDiffuse(1, 0.45)).toBeCloseTo(1, 9);
  });
  it('crown occlusion is 1 on the upper surface, dark inside and below', () => {
    expect(crownOcclusion([0, 1, 0])).toBeCloseTo(1, 6);
    expect(crownOcclusion([0, 0, 0])).toBeLessThan(0.3);
    expect(crownOcclusion([1, -0.9, 0])).toBeLessThan(crownOcclusion([1, 0.5, 0]));
  });
});
