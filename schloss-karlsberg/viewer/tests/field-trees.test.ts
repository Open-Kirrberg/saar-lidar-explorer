// Wave 11 (KB-I84, audit #2): the open-land field trees are thinned to farmsteads, ways, field edges, banks and the
// forest edge, and gain seeded groups there (viewer/src/landcover.ts openTreePlan, FIELD_TREES, fieldTreeContext).
import { describe, expect, it } from 'vitest';
import { FIELD_TREES, GROUND_CLASS, distanceTo, fieldTreeContext, openTreePlan, type GroundGrid } from '../src/landcover.ts';

const C = GROUND_CLASS;
const grid = (cols: number, rows: number, f: (c: number, r: number) => number, cell = 2): GroundGrid => {
  const ground = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ground[r * cols + c] = f(c, r);
  return { ground, cols, rows, cell };
};
const idx = (g: GroundGrid, t: { gx: number; gy: number }) => Math.floor(t.gy / g.cell) * g.cols + Math.floor(t.gx / g.cell);

// 1.6 × 1.2 km: forest W, meadow, a road (gravel) N-S at x 700 m, fields E of x 900 m with a meadow balk strip, a farm
const land = (c: number, r: number) => {
  if (c < 60) return C.forest;
  if (c >= 350 && c < 353) return C.gravel;
  if (c >= 500 && c < 505 && r >= 300 && r < 306) return C.building;
  if (c >= 450 && (r < 280 || r >= 300)) return C.field;
  return C.meadow;
};
const farms = [{ gx: 1005, gy: 606 }];

describe('fieldTreeContext', () => {
  const base = { farm: 1e6, road: 1e6, water: 1e6, field: 1e6, nonField: 0, forest: 1e6, isField: false };
  it('names the context of a point and null for the open strip', () => {
    expect(fieldTreeContext({ ...base, farm: 80 })).toBe('farm');
    expect(fieldTreeContext({ ...base, road: 12 })).toBe('road');
    expect(fieldTreeContext({ ...base, road: 3 })).toBe(null); // on the verge, not beside the way
    expect(fieldTreeContext({ ...base, field: 6 })).toBe('edge');
    expect(fieldTreeContext({ ...base, isField: true, field: 0, nonField: 3 })).toBe('edge');
    expect(fieldTreeContext({ ...base, isField: true, field: 0, nonField: 30 })).toBe(null); // inside the strips
    expect(fieldTreeContext({ ...base, water: 20 })).toBe('water');
    expect(fieldTreeContext({ ...base, forest: 30 })).toBe('forest');
    expect(fieldTreeContext(base)).toBe(null);
  });
  it('keeps the old single trees on meadow and hay away from the ploughland, not beside the strips', () => {
    expect(fieldTreeContext({ ...base, isPasture: true })).toBe('pasture');
    expect(fieldTreeContext({ ...base, isPasture: true, field: FIELD_TREES.keep.pasture })).toBe('pasture');
    expect(fieldTreeContext({ ...base, isPasture: true, field: 25 })).toBe(null);
    expect(fieldTreeContext({ ...base, isPasture: false })).toBe(null);
  });
});

describe('openTreePlan, clustered field trees (wave 11)', () => {
  const g = grid(800, 600, land);
  const plan = openTreePlan(g, { farms });
  const field = plan.filter((t) => t.role === 'field');
  const old = openTreePlan(g, { farms, clustered: false }).filter((t) => t.role === 'field');
  const toNonField = distanceTo(g, Object.values(C).filter((k) => k !== C.field));
  const toForest = distanceTo(g, [C.forest]);
  const toHard = distanceTo(g, [C.gravel, C.building]);

  it('is deterministic and keeps the Überhälter of the wave-2 plan', () => {
    expect(openTreePlan(g, { farms })).toEqual(plan);
    const std = (p: typeof plan) => p.filter((t) => t.role === 'standard');
    expect(std(plan)).toEqual(std(openTreePlan(g, { farms, clustered: false })));
  });
  it('plants no tree inside a field strip, on a way, or close to the forest', () => {
    expect(field.length).toBeGreaterThan(10);
    for (const t of field) {
      const i = idx(g, t);
      expect([C.meadow, C.hay, C.field]).toContain(g.ground[i]);
      if (g.ground[i] === C.field) expect(toNonField[i]).toBeLessThanOrEqual(4.5);
      expect(toForest[i]).toBeGreaterThanOrEqual(20);
      expect(toHard[i]).toBeGreaterThanOrEqual(6);
    }
  });
  it('keeps only lattice trees that stand in a context, and fewer than the even scatter overall in the open', () => {
    const key = (t: { gx: number; gy: number }) => `${t.gx.toFixed(3)},${t.gy.toFixed(3)}`;
    const oldKeys = new Set(old.map(key));
    const kept = field.filter((t) => oldKeys.has(key(t)));
    expect(kept.length).toBeLessThan(old.length);
    // the wave-2 scatter put trees into the field strips; the clustered plan does not
    const inStrip = (p: typeof field) => p.filter((t) => g.ground[idx(g, t)] === C.field && toNonField[idx(g, t)] > 4.5).length;
    expect(inStrip(old)).toBeGreaterThan(0);
    expect(inStrip(field)).toBe(0);
  });
  it('returns the thinned-away lattice trees as ghosts in their old order (the forest tiles keep their streams)', () => {
    const withGhosts = openTreePlan(g, { farms, ghosts: true });
    const lattice = withGhosts.filter((t) => t.role === 'field' && !t.own);
    const key = (t: { gx: number; gy: number; species: string; scale: number }) => `${t.gx},${t.gy},${t.species},${t.scale}`;
    expect(lattice.map(key)).toEqual(old.map(key));
    expect(lattice.filter((t) => !t.ghost).map(key)).toEqual(field.filter((t) => !t.own).map(key));
    expect(withGhosts.filter((t) => !t.ghost)).toEqual(plan);
    expect(field.some((t) => t.own)).toBe(true);
  });
  it('groups trees near the ploughland: most have a neighbour within 2 × the group spacing (pasture trees stand alone)', () => {
    const toField = distanceTo(g, [C.field]);
    const arable = field.filter((t) => toField[idx(g, t)] < FIELD_TREES.keep.pasture);
    expect(arable.length).toBeGreaterThan(10);
    const near = arable.filter((t) => field.some((o) => o !== t && Math.hypot(o.gx - t.gx, o.gy - t.gy) < 2 * FIELD_TREES.spacing[1])).length;
    expect(near / arable.length).toBeGreaterThan(0.5);
  });
  it('is seeded per cell: changing the land in one corner moves no tree far from it', () => {
    // a new field block in the NW meadow (x 200-300 m, y 100-200 m)
    const g2 = grid(800, 600, (c, r) => (c >= 100 && c < 150 && r >= 50 && r < 100 ? C.field : land(c, r)));
    const plan2 = openTreePlan(g2, { farms }).filter((t) => t.role === 'field');
    // distance transforms reach ≤ 150 m (the farm context; the others ≤ 45 m): trees beyond 400 m of the change stay
    const far = (p: typeof field) => p.filter((t) => Math.hypot(t.gx - 250, t.gy - 150) > 400).map((t) => [t.gx, t.gy, t.species, t.scale]);
    expect(far(plan2)).toEqual(far(field));
  });
});
