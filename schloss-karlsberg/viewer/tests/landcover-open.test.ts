import { describe, expect, it } from 'vitest';
import {
  GROUND_CLASS,
  HAY_PARCEL,
  bakeGrid,
  distanceTo,
  fieldBlockCoord,
  forestPlan,
  gridNormal,
  hash12,
  hayCockPlan,
  hayParcel,
  latticeNoise,
  luminance,
  noiseLattice,
  openTreePlan,
  type GroundGrid,
} from '../src/landcover.ts';

// wave-2 review fixes: land-cover bake grid, height-field normals, open-land trees, mantle groups, hay cocks

const grid = (cols: number, rows: number, f: (c: number, r: number) => number, cell = 2): GroundGrid => {
  const ground = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ground[r * cols + c] = f(c, r);
  return { ground, cols, rows, cell };
};
const classAt = (g: GroundGrid, t: { gx: number; gy: number }) => g.ground[Math.floor(t.gy / g.cell) * g.cols + Math.floor(t.gx / g.cell)];

describe('bakeGrid and luminance', () => {
  it('uses 1 m texels when the GPU allows it and coarsens otherwise', () => {
    expect(bakeGrid(2150, 2650, 16384)).toEqual({ width: 2150, height: 2650, cell: 1 });
    const small = bakeGrid(2150, 2650, 2048);
    expect(small.height).toBe(2048);
    expect(small.width).toBeLessThanOrEqual(2048);
    expect(small.cell).toBeCloseTo(2650 / 2048, 9);
    expect(bakeGrid(100, 50, 4096, 2)).toEqual({ width: 50, height: 25, cell: 2 });
  });
  it('luminance is Rec. 709', () => {
    expect(luminance([1, 1, 1])).toBeCloseTo(1, 9);
    expect(luminance([0, 1, 0])).toBeCloseTo(0.7152, 9);
  });
});

describe('gridNormal (chunk-seam fix)', () => {
  // plane h = 0.1 x + 0.2 z on a 1 m grid (col → x east, row → z south)
  const cols = 9;
  const rows = 7;
  const h = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) h[r * cols + c] = 0.1 * c + 0.2 * r;
  const expected = (() => {
    const l = Math.hypot(0.1, 1, 0.2);
    return [-0.1 / l, 1 / l, -0.2 / l];
  })();
  it('matches the analytic normal inside, on the border and for any step', () => {
    for (const [r, c, s] of [
      [3, 4, 1],
      [0, 0, 1],
      [6, 8, 2],
      [3, 4, 4],
    ]) {
      const n = gridNormal(h, cols, rows, 1, r, c, s);
      n.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
    }
  });
  it('is up on flat ground and unit length', () => {
    const flat = new Float32Array(cols * rows).fill(300);
    expect(gridNormal(flat, cols, rows, 1, 2, 2)).toEqual([-0, 1, -0]);
    const n = gridNormal(h, cols, rows, 1, 2, 2);
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
  });
});

describe('distanceTo, latticeNoise, hash12', () => {
  it('distanceTo measures metres to the nearest cell of the classes', () => {
    const g = grid(10, 1, (c) => (c === 0 ? GROUND_CLASS.forest : GROUND_CLASS.meadow));
    const d = distanceTo(g, [GROUND_CLASS.forest]);
    expect(d[0]).toBe(0);
    expect(d[5]).toBeCloseTo(10, 6);
    expect(Math.min(...distanceTo(g, [GROUND_CLASS.water]))).toBe(1e6);
  });
  it('latticeNoise hits the lattice texels at integers, stays in [0, 1] and is continuous', () => {
    const lat = noiseLattice(256, 1789);
    expect(latticeNoise(lat, 3, 5)).toBeCloseTo(lat[(5 * 256 + 3) * 4] / 255, 9);
    expect(latticeNoise(lat, 3 + 256, 5 - 256)).toBeCloseTo(latticeNoise(lat, 3, 5), 9); // repeats like the texture
    for (let i = 0; i < 200; i++) {
      const v = latticeNoise(lat, i * 0.37, i * 0.61);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(latticeNoise(lat, 7.9999, 2.5) - latticeNoise(lat, 8, 2.5))).toBeLessThan(1e-3);
  });
  it('hash12 is deterministic and roughly uniform in [0, 1)', () => {
    expect(hash12(3.3, 7.1)).toBe(hash12(3.3, 7.1));
    let s = 0;
    for (let i = 0; i < 400; i++) {
      const v = hash12(i + 5.3, (i * 7) % 13);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      s += v;
    }
    expect(s / 400).toBeGreaterThan(0.4);
    expect(s / 400).toBeLessThan(0.6);
  });
  it('fieldBlockCoord is the palace-grid frame plus 0-30 m of warp', () => {
    const lat = noiseLattice(256, 1789);
    for (const [x, z] of [
      [0, 0],
      [500, -300],
      [1234, 987],
    ]) {
      const [px, py] = fieldBlockCoord(lat, x, z, [1, 0]);
      expect(px - x).toBeGreaterThanOrEqual(0);
      expect(px - x).toBeLessThanOrEqual(30);
      expect(py - z).toBeGreaterThanOrEqual(0);
      expect(py - z).toBeLessThanOrEqual(30);
    }
  });
});

describe('forest mantle groups (wave-2 review: no "pearl necklace")', () => {
  const g = grid(300, 200, (c, r) => (c >= 50 && c < 250 && r >= 25 && r < 175 ? GROUND_CLASS.forest : GROUND_CLASS.hay));
  const mantle = forestPlan(g).filter((t) => t.role === 'mantle');
  it('has shrubs of 2-5 m in clusters, with gaps along the edge', () => {
    for (const t of mantle) {
      expect(t.scale * 4.5).toBeGreaterThanOrEqual(2);
      expect(t.scale * 4.5).toBeLessThanOrEqual(5.1);
    }
    // clustered: most shrubs have a neighbour within 2.5 m
    let close = 0;
    for (const a of mantle) if (mantle.some((b) => b !== a && Math.hypot(a.gx - b.gx, a.gy - b.gy) < 2.5)) close++;
    expect(close / mantle.length).toBeGreaterThan(0.85);
    // gaps: along the north edge (gy 50-62 m) some 8 m stretches carry no shrub
    let empty = 0;
    for (let x = 104; x < 496; x += 8) if (!mantle.some((t) => t.gy < 62 && t.gx >= x && t.gx < x + 8)) empty++;
    expect(empty).toBeGreaterThan(0);
    expect(empty).toBeLessThan(25);
  });
});

describe('openTreePlan (field trees, Überhälter in the meadow, hedges)', () => {
  // forest block W, meadow in the middle, a lawn strip, fields E, a vineyard patch, a farmstead
  const g = grid(400, 300, (c, r) => {
    if (c < 60) return GROUND_CLASS.forest;
    if (c >= 150 && c < 160) return GROUND_CLASS.lawn;
    if (c >= 120 && c < 130 && r < 20) return GROUND_CLASS.vineyard;
    if (c >= 200 && c < 205 && r >= 100 && r < 105) return GROUND_CLASS.building;
    if (c >= 220) return GROUND_CLASS.field;
    return GROUND_CLASS.meadow;
  });
  const plan = openTreePlan(g, { gridU: [1, 0] });
  const toForest = distanceTo(g, [GROUND_CLASS.forest]);
  const at = (t: { gx: number; gy: number }) => Math.floor(t.gy / g.cell) * g.cols + Math.floor(t.gx / g.cell);
  it('is deterministic and never on lawn, vineyard, buildings or forest', () => {
    expect(openTreePlan(g, { gridU: [1, 0] })).toEqual(plan);
    for (const t of plan) expect([GROUND_CLASS.meadow, GROUND_CLASS.hay, GROUND_CLASS.field]).toContain(classAt(g, t));
  });
  it('puts standards 5-15 m out in front of the forest edge and field trees well away from it', () => {
    const std = plan.filter((t) => t.role === 'standard');
    expect(std.length).toBeGreaterThan(3);
    for (const t of std) {
      expect(toForest[at(t)]).toBeGreaterThanOrEqual(5);
      expect(toForest[at(t)]).toBeLessThanOrEqual(15);
      expect(t.scale).toBeGreaterThan(1.05);
    }
    const field = plan.filter((t) => t.role === 'field');
    expect(field.length).toBeGreaterThan(3);
    for (const t of field) expect(toForest[at(t)]).toBeGreaterThanOrEqual(25);
    // farmstead: walnut / pear near the building
    expect(field.some((t) => t.species === 'juglans' || t.species === 'pyrus')).toBe(true);
  });
  it('draws hedges only on field cells, mostly shrubs with a few hedge trees', () => {
    const hedge = plan.filter((t) => t.role === 'hedge');
    expect(hedge.length).toBeGreaterThan(20);
    for (const t of hedge) expect(classAt(g, t)).toBe(GROUND_CLASS.field);
    const trees = hedge.filter((t) => t.species !== 'shrub').length;
    expect(trees / hedge.length).toBeLessThan(0.15);
    expect(openTreePlan(g, {}).some((t) => t.role === 'hedge')).toBe(false); // no grid axis, no hedges
  });
});

describe('hayParcel and hayCockPlan', () => {
  const g = grid(300, 300, () => GROUND_CLASS.hay);
  const opts = { ox: 0, oz: 0, gridU: [1, 0] as [number, number], centre: [300, 300] as [number, number], radius: 300, share: 1 };
  const lat = noiseLattice(256, 1789);
  it('parcel states follow the bake shares (50 / 28 / 22 %)', () => {
    const n: Record<string, number> = { standing: 0, cut: 0, regrowth: 0 };
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) n[hayParcel(lat, i * HAY_PARCEL[0], j * HAY_PARCEL[1], [1, 0]).state]++;
    expect(n.standing / 1600).toBeGreaterThan(0.4);
    expect(n.cut / 1600).toBeGreaterThan(0.18);
    expect(n.regrowth / 1600).toBeGreaterThan(0.12);
  });
  it('places cocks only on cut parcels, inside the radius and away from the parcel margin', () => {
    const cocks = hayCockPlan(g, opts);
    expect(cocks.length).toBeGreaterThan(10);
    expect(hayCockPlan(g, opts)).toEqual(cocks);
    for (const t of cocks) {
      expect(t.species).toBe('haycock');
      expect(Math.hypot(t.gx - 300, t.gy - 300)).toBeLessThan(302);
      const p = hayParcel(lat, Math.floor(t.gx / 2) * 2 + 1, Math.floor(t.gy / 2) * 2 + 1, [1, 0]);
      expect(p.state).toBe('cut');
    }
    expect(hayCockPlan(g, { ...opts, share: 0 })).toEqual([]);
  });
});
