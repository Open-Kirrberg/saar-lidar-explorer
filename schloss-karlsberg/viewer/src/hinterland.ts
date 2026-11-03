/**
 * The 1789 hinterland vegetation outside the gardens (backlog KB-I44 follow-up; research/11 §1.5, §6.3): hedgerows
 * along the boundaries of the catalogue land-cover parcels (fields, hay meadows) and fruit-tree meadows (Baumgärten)
 * beside the farmsteads and the hamlet. Pure and deterministic (no three.js), unit-tested in
 * viewer/tests/hinterland.test.ts; the Forest renders the result in its tiles (instanced, culled per tile).
 *
 * Evidence and tags (all hypotheses, confidence low):
 * - Hedges: PV 1791 draws "dark tree rows and hedges in curving bands" across the open slopes [D PV, schematic;
 *   research/11 §1.5]. Their lines are not located, so they follow some of the land-cover parcel edges (LC polygons,
 *   extents ±50 m [I]) [I placement]. Only HEDGE_SHARE (~28 %) of the eligible edge length carries a hedge (wave-3
 *   review: hedges on nearly every edge read as Norman bocage), chosen where hedges grew in an open-field landscape:
 *   slope balks (Stufenraine) along the contours of sloping fields, beside ways, and at the village and farmstead
 *   margins; flat strip ends rarely [N]. A hedge is an irregular mass 1–3 shrubs deep, 1.5–5 m high, with real gaps
 *   (not a single file of equal shrubs). Composition (hawthorn, blackthorn, hazel, dog rose, with oak, field maple and
 *   wild cherry as hedge trees every 30–70 m) is period-normal [N].
 * - No hedges inside the fields: the arable land was an open strip field (Gewannflur) worked in common, without
 *   hedges between the strips [N]. (The wave-2 hedges on a third of the bake's Gewann block edges are dropped.)
 * - Fruit-tree meadows next to farmsteads (standard apple, pear, plum and cherry on grass, 9–11 m apart) are
 *   period-normal [N]; the estate itself planted fruit trees (Apfelallee TF-14) [D]. Positions [I], confidence low.
 * - Roadside avenues: only the catalogue avenues (TF-10, TF-12, TF-14) are located; they are drawn by the site
 *   features. The chaussée to Homburg (PV 8) and the Homburg–Erbach road avenue (1782 Oberamt map) are documented
 *   but not located in the crop [D presence; U position], so they are not drawn.
 */
import { hashString, mulberry32, smoothstep } from '@model/layout/geom.ts';
import { GROUND_CLASS, cellAt, distanceTo, latticeNoise, noiseLattice, type ForestSpecies, type ForestTree, type GroundGrid } from './landcover.ts';

/** Species of the hinterland that the forest palette lacks [N; I hues]. */
export const HINTERLAND_SPECIES: Record<string, ForestSpecies> = {
  // hedge shrubs: hawthorn (dark), blackthorn (dark, bluish), hazel (lighter, taller), dog rose (low, open) [N]
  crataegus: { key: 'crataegus', height: 4.0, crown: 2.3, stretch: 0.85, trunkFrac: 0.05, leaf: '#46612F', bark: '#5A4E40' },
  prunus_spinosa: { key: 'prunus_spinosa', height: 3.2, crown: 2.0, stretch: 0.8, trunkFrac: 0.04, leaf: '#3F5733', bark: '#4A4038' },
  corylus: { key: 'corylus', height: 4.6, crown: 2.6, stretch: 0.95, trunkFrac: 0.04, leaf: '#5E7C3D', bark: '#6E6458' },
  rosa_canina: { key: 'rosa_canina', height: 2.2, crown: 1.7, stretch: 0.75, trunkFrac: 0.03, leaf: '#55703A', bark: '#5A4E40' },
  // hedge trees [N]
  acer_campestre: { key: 'acer_campestre', height: 11, crown: 4.0, stretch: 1.05, trunkFrac: 0.28, leaf: '#58763A', bark: '#6A6258' },
  prunus_avium: { key: 'prunus_avium', height: 13, crown: 3.8, stretch: 1.35, trunkFrac: 0.32, leaf: '#4E6C34', bark: '#5B4A42' },
  // standard fruit trees of a Baumgarten: apple low and wide, pear taller and narrow, plum small [N]
  malus_std: { key: 'malus_std', height: 7, crown: 3.4, stretch: 0.8, trunkFrac: 0.27, leaf: '#5F7A38', bark: '#5A4A3C' },
  pyrus_std: { key: 'pyrus_std', height: 11, crown: 3.2, stretch: 1.45, trunkFrac: 0.25, leaf: '#4D6833', bark: '#4E463E' },
  prunus_dom: { key: 'prunus_dom', height: 6, crown: 2.5, stretch: 1.0, trunkFrac: 0.3, leaf: '#56713A', bark: '#4F433A' },
};

/** Hedge shrub mix (share) [N]. */
const HEDGE_SHRUBS: [string, number][] = [
  ['crataegus', 0.38],
  ['prunus_spinosa', 0.27],
  ['corylus', 0.22],
  ['rosa_canina', 0.13],
];
const HEDGE_TREES: [string, number][] = [
  ['quercus', 0.55],
  ['acer_campestre', 0.25],
  ['prunus_avium', 0.2],
];
const ORCHARD: [string, number][] = [
  ['malus_std', 0.55],
  ['pyrus_std', 0.25],
  ['prunus_dom', 0.2],
];

export type HinterlandKind = 'hedgerow' | 'hedge_tree' | 'orchard';

export interface HinterlandTree extends ForestTree {
  gx: number;
  gy: number;
  kind: HinterlandKind;
}

/** A land-cover parcel as in catalogue.json `landcover` (only what the planner reads). */
export interface LandcoverParcel {
  id: string;
  cover: string;
  geometry: { type: string; coordinates: number[][][] };
}

export interface HinterlandOptions {
  /** grid west / north edge (EPSG:25832) to turn catalogue E/N into grid metres */
  west: number;
  north: number;
  parcels: readonly LandcoverParcel[];
  /** farmstead and hamlet buildings (grid metres) that get a fruit-tree meadow */
  farms?: readonly { id: string; gx: number; gy: number }[];
  /** keep the formal core clear: no orchards within `coreRadius` m of `core` (grid metres) */
  core?: [number, number];
  coreRadius?: number;
  seed?: number;
  /** hedge spacing along the line (m) */
  step?: number;
  /** share of the eligible parcel-edge length that carries a hedge (default HEDGE_SHARE) */
  hedgeShare?: number;
  /** ground height (m) at grid metres, for the slope-balk preference (optional; flat without it) */
  height?: (gx: number, gy: number) => number;
}

/**
 * Share of the eligible parcel-edge length (open land on both sides, clear of forest and ways) that carries a hedge.
 * The one tunable density constant of the hedgerows [I; wave-3 review: 20–35 %].
 */
export const HEDGE_SHARE = 0.28;

export interface HinterlandPlan {
  trees: HinterlandTree[];
  /** hedgerow line length (m): eligible parcel edges and the planted part */
  hedgeLength: { eligible: number; planted: number };
  /** per kind: count and evidence tag (for skb.forest.hinterland and the backlog log) */
  summary: Record<HinterlandKind, { count: number; tag: string }>;
}

export const HINTERLAND_TAGS: Record<HinterlandKind, string> = {
  hedgerow: 'D PV 1791 hedges in bands (schematic); N composition; I placement on LC parcel edges; low',
  hedge_tree: 'N hedge trees (oak, field maple, wild cherry); I placement; low',
  orchard: 'N fruit-tree meadows at farmsteads; D estate fruit trees (Apfelallee TF-14); I placement; low',
};

/** Covers whose parcel edges can carry a hedge, and the classes a hedge may stand between. */
const HEDGE_COVERS = new Set(['field', 'hay']);
/**
 * Wave 11 (KB-I84): the field areas that fill the open meadow between the first-cut parcels (catalogue-v2/landcover.ts
 * GEWANN_FILL_IDS). The open Gewannflur had no hedges between its strips [N; KB-I57], so their outlines carry none;
 * skipping them also leaves every other parcel's hedgerow exactly where it was.
 */
export const GEWANN_FILL = new Set(['LC-06', 'LC-07', 'LC-08']);
const OPEN = new Set<number>([GROUND_CLASS.meadow, GROUND_CLASS.hay, GROUND_CLASS.field]);

function pick(list: [string, number][], u: number): string {
  let acc = 0;
  for (const [k, s] of list) {
    acc += s;
    if (u < acc) return k;
  }
  return list[list.length - 1][0];
}

/**
 * Deterministic hinterland plan on the class grid. Positions are grid metres (gx east of the west edge, gy south of
 * the north edge), like `forestPlan`.
 */
export function hinterlandPlan(g: GroundGrid, opts: HinterlandOptions): HinterlandPlan {
  const C = GROUND_CLASS;
  const seed = opts.seed ?? 1789;
  const rnd = mulberry32(seed ^ 0x48e1);
  const lat = noiseLattice(256, seed ^ 0x77);
  const toForest = distanceTo(g, [C.forest]);
  const toHard = distanceTo(g, [C.gravel, C.cobbles, C.sand, C.water, C.building, C.parterre_sand, C.lawn, C.vineyard, C.kitchen_garden]);
  const toBuilding = distanceTo(g, [C.building]);
  const W = g.cols * g.cell;
  const H = g.rows * g.cell;
  const at = (x: number, y: number) => cellAt(g, x, y);
  const trees: HinterlandTree[] = [];
  const step = opts.step ?? 2.6;
  const share = opts.hedgeShare ?? HEDGE_SHARE;
  const hgt = opts.height;

  // ---- hedgerows along parcel edges
  // 1. candidate line points on all eligible edges, each with a preference score. Wobble and noise are functions of
  //    the position, so a shared edge walked from both parcels gives the same line (deduplicated by owner cells).
  type Cand = { x: number; y: number; tx: number; ty: number; score: number };
  const cands: Cand[] = [];
  const owner = new Map<number, number>(); // 3 m cell → parcel walk
  const cellOf = (x: number, y: number) => Math.floor(y / 3) * 100000 + Math.floor(x / 3);
  let walk = 0;
  for (const p of opts.parcels) {
    if (!HEDGE_COVERS.has(p.cover) || GEWANN_FILL.has(p.id) || p.geometry?.type !== 'Polygon') continue;
    walk++;
    const ring = p.geometry.coordinates[0].map(([E, N]) => [E - opts.west, opts.north - N] as [number, number]);
    for (let k = 0; k + 1 < ring.length; k++) {
      const [x0, y0] = ring[k];
      const [x1, y1] = ring[k + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const tx = (x1 - x0) / len;
      const ty = (y1 - y0) / len;
      for (let d = step / 2; d < len; d += step) {
        const bx = x0 + tx * d;
        const by = y0 + ty * d;
        // the hedge line meanders a little (a planted bank follows the ground, not the surveyor's line) [I]
        const wob = (latticeNoise(lat, bx / 37 + 3.7, by / 37 + 11.3) - 0.5) * 4;
        const x = bx - ty * wob;
        const y = by + tx * wob;
        const i = at(x, y);
        if (i < 0) continue;
        // only between open land, clear of the forest mantle, ways, gardens and buildings
        if (!OPEN.has(g.ground[i]) || toForest[i] < 9 || toHard[i] < 7) continue;
        const iL = at(x - ty * 4, y + tx * 4);
        const iR = at(x + ty * 4, y - tx * 4);
        if (iL < 0 || iR < 0 || !OPEN.has(g.ground[iL]) || !OPEN.has(g.ground[iR])) continue;
        // a shared edge is planted once: skip when a neighbouring cell already belongs to another parcel's walk
        const cell = cellOf(bx, by);
        let dup = false;
        for (let dy = -1; dy <= 1 && !dup; dy++)
          for (let dx = -1; dx <= 1 && !dup; dx++) {
            const o = owner.get(cell + dy * 100000 + dx);
            if (o !== undefined && o !== walk) dup = true;
          }
        if (dup) continue;
        owner.set(cell, walk);
        // preference [N]: slope balks along the contours (Stufenraine), ways, village / farmstead margins; plus a
        // smooth noise so hedges run in stretches of ~40-150 m
        let score = 0.55 * latticeNoise(lat, x / 61 + 40.3, y / 61 + 17.9);
        if (hgt) {
          const gx = (hgt(x + 6, y) - hgt(x - 6, y)) / 12;
          const gy = (hgt(x, y + 6) - hgt(x, y - 6)) / 12;
          const gl = Math.hypot(gx, gy);
          if (gl > 1e-6) score += 0.5 * smoothstep(0.04, 0.12, gl) * (1 - Math.abs(tx * gx + ty * gy) / gl);
        }
        score += 0.25 * (1 - smoothstep(10, 25, toHard[i]));
        score += 0.3 * (1 - smoothstep(60, 150, toBuilding[i]));
        cands.push({ x, y, tx, ty, score });
      }
    }
  }
  // 2. keep the best-scoring `share` of the eligible length
  const sorted = cands.map((c) => c.score).sort((a, b) => a - b);
  const thr = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((1 - share) * sorted.length))] : Infinity;
  // 3. plant: 1-3 shrubs across the line (depth and height follow smooth noises, so neighbours merge into masses),
  //    a hedge tree every 30-70 m of planted line
  let planted = 0;
  let run = 0;
  let nextTree = 20 + rnd() * 40;
  for (const c of cands) {
    const u0 = rnd();
    if (c.score < thr || u0 < 0.05) continue;
    planted++;
    run += step;
    const nx = -c.ty;
    const ny = c.tx;
    if (run >= nextTree) {
      nextTree = run + 30 + rnd() * 40;
      const u = rnd();
      trees.push({ gx: c.x, gy: c.y, x: c.x, z: c.y, species: pick(HEDGE_TREES, rnd()), scale: 0.55 + u * 0.4, role: 'hedge', edge: 0, kind: 'hedge_tree' });
      continue;
    }
    const dn = latticeNoise(lat, c.x / 25 + 90.1, c.y / 25 + 33.3);
    const depth = 1 + (dn > 0.38 ? 1 : 0) + (dn > 0.66 ? 1 : 0);
    const hn = latticeNoise(lat, c.x / 18 + 7.7, c.y / 18 + 61.2);
    for (let j = 0; j < depth; j++) {
      const across = (depth === 1 ? 0 : (j / (depth - 1) - 0.5) * 2 * (0.8 + 0.3 * (depth - 2))) + (rnd() - 0.5) * 1.1;
      const along = (rnd() - 0.5) * 1.6;
      const x = c.x + nx * across + c.tx * along;
      const y = c.y + ny * across + c.ty * along;
      const species = pick(HEDGE_SHRUBS, rnd());
      // 1.5-5 m: a smooth height along the line, the middle row taller [N hedge heights; I]
      const mid = depth === 3 && j === 1 ? 1.15 : 1;
      const H = Math.min(5, Math.max(1.5, (1.5 + 3.3 * hn) * (0.8 + 0.4 * rnd()) * mid));
      trees.push({ gx: x, gy: y, x, z: y, species, scale: H / HINTERLAND_SPECIES[species].height, role: 'hedge', edge: 0, kind: 'hedgerow' });
    }
  }
  const hedgeLength = { eligible: cands.length * step, planted: planted * step };

  // ---- fruit-tree meadows beside farmsteads
  const core = opts.core;
  const coreR = opts.coreRadius ?? 380;
  const sp = 10; // tree spacing (m) [N 9-11 m]
  const anchors = opts.farms ?? [];
  const seen = new Set<number>();
  for (const a of anchors) {
    if (core && Math.hypot(a.gx - core[0], a.gy - core[1]) < coreR) continue;
    // one meadow per farmstead group: anchors within 70 m of an earlier one share it
    const grp = anchors.findIndex((b) => Math.hypot(b.gx - a.gx, b.gy - a.gy) < 70);
    if (seen.has(grp)) continue;
    seen.add(grp);
    const ar = mulberry32(seed ^ hashString(a.id));
    const rot = ar() * Math.PI; // rows run in one direction per meadow
    const cr = Math.cos(rot);
    const srt = Math.sin(rot);
    // 20-45 trees per farmstead [I]
    const cap = 20 + Math.floor(ar() * 26);
    let n = 0;
    for (let v = -9; v <= 9; v++)
      for (let u = -9; u <= 9; u++) {
        const ox = (u + (ar() - 0.5) * 0.25) * sp;
        const oy = (v + (ar() - 0.5) * 0.25) * sp;
        const x = a.gx + ox * cr - oy * srt;
        const y = a.gy + ox * srt + oy * cr;
        const u1 = ar();
        const u2 = ar();
        const u3 = ar();
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = at(x, y);
        if (i < 0 || !OPEN.has(g.ground[i]) || g.ground[i] === C.field) continue;
        if (toBuilding[i] < 12 || toBuilding[i] > 70 || toHard[i] < 5 || toForest[i] < 10) continue;
        if (core && Math.hypot(x - core[0], y - core[1]) < coreR) continue;
        // a meadow on one or two sides of the farmstead, not a ring: irregular outline and missing trees (~12 %)
        if (latticeNoise(lat, x / 60 + 70, y / 60 + 70) < 0.5 || u1 < 0.12 || n >= cap) continue;
        // a few young replacements among the old standards
        const scale = u2 < 0.15 ? 0.45 + u3 * 0.2 : 0.8 + u3 * 0.35;
        trees.push({ gx: x, gy: y, x, z: y, species: pick(ORCHARD, ar()), scale, role: 'field', edge: 0, kind: 'orchard' });
        n++;
      }
  }

  const summary = { hedgerow: { count: 0, tag: HINTERLAND_TAGS.hedgerow }, hedge_tree: { count: 0, tag: HINTERLAND_TAGS.hedge_tree }, orchard: { count: 0, tag: HINTERLAND_TAGS.orchard } };
  for (const t of trees) summary[t.kind].count++;
  return { trees, summary, hedgeLength };
}
