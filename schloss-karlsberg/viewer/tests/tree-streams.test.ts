// KB-I96 (wave-11 review fix): the open-land tree planners take their seeded order from the planner base ground, so a
// land-cover edit painted over it (the wave-11 Gewann fill) hides trees as ghosts but never changes which trees the
// forest tiles' random streams see (viewer/src/landcover.ts plannerBaseGround, openTreePlan `base`; viewer/src/forest.ts
// buildTile draws every main-stream entry's looks in plan order, ghosts included). Also the old field-edge trees and the
// farmstead exemption of the group placer (wave-11 review, poses 12 and 46).
import { describe, expect, it } from 'vitest';
import { FIELD_TREES, GROUND_CLASS, fieldTreeContext, openTreePlan, plannerBaseGround, tileKey, type GroundGrid } from '../src/landcover.ts';

const C = GROUND_CLASS;
const grid = (cols: number, rows: number, f: (c: number, r: number) => number, cell = 2): GroundGrid => {
  const ground = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ground[r * cols + c] = f(c, r);
  return { ground, cols, rows, cell };
};
// forest W, meadow, a road, hay in the middle, fields E, a farm
const land = (c: number, r: number) => {
  if (c < 60) return C.forest;
  if (c >= 350 && c < 353) return C.gravel;
  if (c >= 500 && c < 505 && r >= 300 && r < 306) return C.building;
  if (c >= 200 && c < 330 && r >= 100 && r < 260) return C.hay;
  if (c >= 450 && (r < 280 || r >= 300)) return C.field;
  return C.meadow;
};
const farms = [{ gx: 1005, gy: 606 }];
/** The forest tiles' main stream: every non-`own` entry per 320 m tile, in order (ghost flags excluded). */
const streams = (plan: ReturnType<typeof openTreePlan>) => {
  const by = new Map<string, string[]>();
  for (const p of plan) {
    if (p.own) continue;
    const k = tileKey(p.gx, p.gy, 320);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(`${p.role}:${p.species}:${p.gx.toFixed(3)},${p.gy.toFixed(3)}:${p.scale.toFixed(4)}`);
  }
  return by;
};

describe('plannerBaseGround', () => {
  it('returns the ground itself without runs and applies [row, col0, length, class] runs to a copy', () => {
    const g = grid(10, 4, () => C.field);
    expect(plannerBaseGround(g.ground, 10, undefined)).toBe(g.ground);
    expect(plannerBaseGround(g.ground, 10, [])).toBe(g.ground);
    const b = plannerBaseGround(g.ground, 10, [
      [1, 2, 3, C.meadow],
      [3, 0, 1, C.hay],
    ]);
    expect(b).not.toBe(g.ground);
    expect([...b.slice(10, 20)]).toEqual([8, 8, 0, 0, 0, 8, 8, 8, 8, 8]);
    expect(b[30]).toBe(C.hay);
    expect(g.ground[12]).toBe(C.field); // the ground itself is untouched
  });
});

describe('openTreePlan on a planner base (KB-I96)', () => {
  const g = grid(800, 600, land);
  const ref = openTreePlan(g, { farms, ghosts: true, base: g.ground });
  it('painting field over meadow and hay keeps every main-stream entry: the changed trees only turn into ghosts', () => {
    // a Gewann fill over part of the meadow and the hay
    const painted = { ...g, ground: g.ground.slice() };
    for (let r = 150; r < 420; r++) for (let c = 120; c < 300; c++) if (painted.ground[r * g.cols + c] === C.meadow || painted.ground[r * g.cols + c] === C.hay) painted.ground[r * g.cols + c] = C.field;
    const plan = openTreePlan(painted, { farms, ghosts: true, base: g.ground });
    expect(streams(plan)).toEqual(streams(ref));
    // trees in the painted area turned into ghosts (old ones may stay as balk trees), none outside it changed its flag
    const key = (p: { gx: number; gy: number; role: string }) => `${p.role}:${p.gx.toFixed(3)},${p.gy.toFixed(3)}`;
    const before = new Map(ref.filter((p) => !p.own).map((p) => [key(p), !!p.ghost]));
    let newGhosts = 0;
    for (const p of plan.filter((q) => !q.own)) {
      const inside = p.gx >= 240 && p.gx < 600 && p.gy >= 300 && p.gy < 840;
      const was = before.get(key(p));
      if (!was && p.ghost) {
        newGhosts++;
        // a ghost from the paint stands in or near the painted area (the context distances reach ≤ 60 m beyond it)
        expect(p.gx >= 180 && p.gx < 660 && p.gy >= 240 && p.gy < 900).toBe(true);
      }
      if (!inside && p.role === 'standard') expect(!!p.ghost).toBe(was);
    }
    expect(newGhosts).toBeGreaterThan(0);
  });
  it('without a base the same paint drops entries from the stream (the wave-11 re-roll it fixes)', () => {
    const painted = { ...g, ground: g.ground.slice() };
    for (let r = 150; r < 420; r++) for (let c = 120; c < 300; c++) if (painted.ground[r * g.cols + c] === C.meadow) painted.ground[r * g.cols + c] = C.field;
    expect(streams(openTreePlan(painted, { farms, ghosts: true }))).not.toEqual(streams(ref));
  });
  it('keeps an old tree on the grass a fill turned into strips as a balk tree, young ones become ghosts', () => {
    const painted = { ...g, ground: g.ground.slice() };
    for (let i = 0; i < painted.ground.length; i++) if (painted.ground[i] === C.meadow) painted.ground[i] = C.field;
    const plan = openTreePlan(painted, { farms, ghosts: true, base: g.ground }).filter((p) => p.role === 'field' && !p.own);
    const onFormerMeadow = plan.filter((p) => g.ground[Math.floor(p.gy / 2) * g.cols + Math.floor(p.gx / 2)] === C.meadow);
    expect(onFormerMeadow.length).toBeGreaterThan(10);
    for (const p of onFormerMeadow) expect(!!p.ghost).toBe(p.scale < FIELD_TREES.oldScale);
  });
});

describe('field-tree rules of the wave-11 review', () => {
  const ctx = { farm: 1e6, road: 1e6, water: 1e6, field: 1e6, nonField: 0, forest: 1e6, isField: false, isPasture: true };
  it('keeps an old tree on meadow or hay beside the ploughland as a field-edge tree (Grenzbaum), not a young one', () => {
    expect(fieldTreeContext({ ...ctx, field: 25 })).toBe(null);
    expect(fieldTreeContext({ ...ctx, field: 25, old: true })).toBe('edge');
    expect(fieldTreeContext({ ...ctx, field: FIELD_TREES.keep.oldEdge, old: true })).toBe('pasture'); // ≥ keep.pasture anyway
    // inside the strips even an old tree has no place (the lattice keeps only the repainted ones, as balk trees)
    expect(fieldTreeContext({ ...ctx, isPasture: false, isField: true, field: 0, nonField: 30, old: true })).toBe(null);
  });
  it('puts no group within offBuilding m of a building that is not the farmstead\'s own (pose 46: Barrière guard house)', () => {
    // a farm house at (1005, 606); a lodge 150 m W of it at (850, 606) on the meadow
    const g = grid(800, 600, (c, r) => {
      if (c < 60) return C.forest;
      if (c >= 500 && c < 505 && r >= 300 && r < 306) return C.building;
      if (c >= 423 && c < 427 && r >= 300 && r < 306) return C.building;
      if (c >= 600) return C.field;
      return C.meadow;
    });
    const plan = openTreePlan(g, { farms, ghosts: true }).filter((p) => p.own);
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(Math.hypot(p.gx - 850, p.gy - 606)).toBeGreaterThan(FIELD_TREES.offBuilding - 4);
  });
});
