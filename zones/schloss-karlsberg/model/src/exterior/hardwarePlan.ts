/**
 * KB-I22 roof hardware planning (pure, no three.js; unit-tested in model/tests/exterior.hardware.test.ts): where the
 * Hemmer lightning-rod masts stand on a ridge, which building corner carries the down-conductor and its path over the
 * roof, cornice and wall, and where the downpipes run (corners and risalit flanks first, piers only where wide enough,
 * never inside a risalit or on a shutter leaf; DOWNPIPE.maxSpacing apart at most). Numbers come from layout/grammar.ts (LIGHTNING_ROD, DOWNPIPE); geometry is drawn by exterior/hardware.ts.
 */
import type { BuildingLayout } from '../layout/building.ts';
import { halfProfile } from './roof.ts';
import { ARTICULATION, CHIMNEY, DOWNPIPE, HEMMER_ROD, LIGHTNING_ROD } from '../layout/grammar.ts';
import { roofHeightAtInset } from '../layout/roof.ts';
import type { SideName } from '../spec.ts';

export type P3 = [number, number, number]; // [s, t, h]

/**
 * Mast positions (s) on a ridge of `ridgeLength` m centred at `sMid`: one per ≤ `spacing` m, evenly spread
 * [N Hemmer 1786; I spacing]. A ridge shorter than 0.5 m (pavilion apex) gets one mast at the apex.
 */
export function rodMasts(ridgeLength: number, sMid = 0, spacing: number = LIGHTNING_ROD.spacing): number[] {
  const n = ridgeLength < 0.5 ? 1 : Math.max(1, Math.ceil(ridgeLength / spacing));
  return Array.from({ length: n }, (_, i) => sMid - ridgeLength / 2 + (ridgeLength * (i + 0.5)) / n);
}

/**
 * Hemmer masts on the high points of a ridge of `ridgeLength` m centred at `sMid` (wave-8 review fix) [I, HEMMER_ROD]:
 * an apex (< 0.5 m) or a short ridge (< `single`) gets one central mast, a longer ridge one mast `endInset` from each
 * end and no intermediates. A mast within `chimneyClear` + the stack half-width of a chimney station (`chimneys`, s
 * positions on the ridge line) moves clear of it toward the ridge centre. Ascending.
 */
export function hemmerMasts(
  ridgeLength: number,
  sMid = 0,
  rule: { endInset: number; single: number; chimneyClear?: number } = HEMMER_ROD,
  chimneys: readonly { s: number; half: number }[] = [],
): number[] {
  const raw = ridgeLength < rule.single ? [sMid] : [sMid - ridgeLength / 2 + rule.endInset, sMid + ridgeLength / 2 - rule.endInset];
  const clear = rule.chimneyClear ?? 0;
  return raw.map((s) => {
    for (const c of chimneys) {
      const need = c.half + clear;
      if (Math.abs(s - c.s) >= need) continue;
      // move toward the ridge centre (a central mast moves to the side with more ridge left)
      const dir = s === sMid ? (c.s <= sMid ? 1 : -1) : Math.sign(sMid - s) || 1;
      s = c.s + dir * need;
    }
    return s;
  });
}

/**
 * Mast height above the ridge: `mastRoofShare` x the roof rise above the eaves, clamped to [mastMin, mast] [I]. A building
 * whose footprint (`area` m², optional) is under `pointArea` carries only a short point of `pointMast` m (wave 9) [I].
 */
export function hemmerMastHeight(
  roofRise: number,
  rule: { mast: number; mastMin: number; mastRoofShare: number; pointArea?: number; pointMast?: number } = HEMMER_ROD,
  area = Infinity,
): number {
  if (rule.pointArea !== undefined && rule.pointMast !== undefined && area < rule.pointArea) return rule.pointMast;
  return Math.max(rule.mastMin, Math.min(rule.mast, rule.mastRoofShare * Math.max(0, roofRise)));
}

/**
 * Chimney stations of a building (CHIMNEY grammar; drawn by exterior/facade.ts chimneys()): plan position (s, t), the
 * stack section and its foot and top heights. Empty for roofs without chimneys (none, flat, dome) or no court axes.
 */
export function chimneyStations(L: BuildingLayout): { s: number; t: number; section: [number, number]; base: number; top: number }[] {
  const spec = L.roofSpec.chimneys;
  if (!spec || L.roof.type === 'none' || L.roof.type === 'flat' || L.roof.type === 'dome') return [];
  const cs = typeof spec === 'object' ? spec : {};
  const kitchen = /küche|kitchen/i.test(L.building.function + ' ' + L.building.name_de);
  const every = cs.every_axes ?? CHIMNEY.everyAxes;
  const sec = (cs.section ?? (kitchen ? CHIMNEY.kitchenSection : CHIMNEY.section)) as [number, number];
  const above = cs.above_roof ?? (kitchen ? CHIMNEY.kitchenAbove : CHIMNEY.aboveRidge);
  const lay = L.sides.court;
  const sd = L.frame.sides.court;
  if (!lay || !sd || !lay.axes) return [];
  const count = Math.max(2, Math.round(lay.axes / every));
  const ridgeInset = L.roof.ridge_inset;
  const tOff = L.roof.deck_width > 0 ? L.roof.deck_width / 4 : 0;
  const out: { s: number; t: number; section: [number, number]; base: number; top: number }[] = [];
  for (let i = 0; i < count; i++) {
    const axis = Math.round(((i + 0.5) * lay.axes) / count - 0.5);
    const bay = lay.bays[Math.max(0, Math.min(lay.axes - 1, axis))];
    const s = sd.p0[0] + sd.tangent[0] * bay.a;
    if (L.raised.some((r) => s > r.s0 - 1 && s < r.s1 + 1)) continue;
    if (Math.abs(s) > L.frame.length / 2 - Math.max(2, L.roofPlan.ridgeEndInset)) continue;
    for (const t of tOff ? [tOff * (i % 2 ? 1 : -1)] : [0]) {
      const base = roofHeightAtInset(L.roof, Math.min(ridgeInset, L.frame.width / 2 - Math.abs(t))) - 0.6;
      out.push({ s, t, section: sec, base, top: L.roof.ridge_h + above });
    }
  }
  return out;
}

/** A building corner: sx = −1 (end_a) / +1 (end_b), ty = −1 (garden) / +1 (court). */
export interface Corner {
  sx: -1 | 1;
  ty: -1 | 1;
}

/** Corners in preference order for the down-conductor: garden side first (the court front stays clean) [I]. */
export const CORNER_ORDER: readonly Corner[] = [
  { sx: 1, ty: -1 },
  { sx: -1, ty: -1 },
  { sx: 1, ty: 1 },
  { sx: -1, ty: 1 },
];

/** Does a risalit sit on the corner (either adjoining side has a risalit reaching that end)? */
export function cornerHasRisalit(L: BuildingLayout, c: Corner): boolean {
  const f = L.frame;
  const sideT: SideName = c.ty > 0 ? 'court' : 'garden';
  const sideS: SideName = c.sx > 0 ? 'end_b' : 'end_a';
  for (const name of [sideT, sideS]) {
    const sd = f.sides[name];
    const lay = L.sides[name];
    if (!sd || !lay) continue;
    // facade position of this corner on that side: a = 0 at p0, = length at p1
    const cs = (c.sx * f.length) / 2;
    const ct = (c.ty * f.width) / 2;
    const a = (cs - sd.p0[0]) * sd.tangent[0] + (ct - sd.p0[1]) * sd.tangent[1];
    if (lay.risalits.some((r) => a >= r.a0 - 0.3 && a <= r.a1 + 0.3)) return true;
  }
  return false;
}

/**
 * The first corner (CORNER_ORDER) that is free: no risalit on it and `free(s, t)` true for a point 1 m out on the
 * diagonal (not inside another building, e.g. at the palace-group junctions). Null if none.
 */
export function conductorCorner(L: BuildingLayout, free: (s: number, t: number) => boolean): Corner | null {
  const f = L.frame;
  for (const c of CORNER_ORDER) {
    if (cornerHasRisalit(L, c)) continue;
    if (!free(c.sx * (f.length / 2 + 1), c.ty * (f.width / 2 + 1))) continue;
    return c;
  }
  return null;
}

/**
 * Down-conductor path [s, t, h] from the foot of the mast at `sMast` on the ridge: along the ridge to its end, down the
 * hip line (hipped roofs) or the gable verge, round the main cornice and down the wall corner to `ground`. The roof part
 * floats `LIGHTNING_ROD.standoff` m above the cover, the wall part as far out from both faces [N brackets; I].
 */
export function conductorPath(L: BuildingLayout, c: Corner, sMast: number, ground: number): P3[] {
  const f = L.frame;
  const L2 = f.length / 2;
  const D2 = f.width / 2;
  const so = LIGHTNING_ROD.standoff;
  const sec = L.roof;
  const prof = halfProfile(sec);
  const hipped = L.roofPlan.hippedEnds;
  const cd = L.members.cornice;
  const pts: P3[] = [];
  const top = prof[prof.length - 1];
  // ridge end on this corner's side
  const sEnd = hipped ? c.sx * Math.max(0, L2 - top[0]) : c.sx * L2;
  pts.push([sMast, 0, sec.ridge_h + so]);
  if (Math.abs(sEnd - sMast) > 0.05) pts.push([sEnd, 0, sec.ridge_h + so]);
  // down the hip line / verge: profile points from the top to the eaves (inset d from both eaves lines)
  for (let i = prof.length - 1; i >= 0; i--) {
    const [d, h] = prof[i];
    const s = hipped ? c.sx * (L2 - d) : c.sx * L2;
    const t = c.ty * Math.max(0, D2 - d);
    const p: P3 = [s, t, h + so];
    const q = pts[pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 0.05) pts.push(p);
  }
  // round the cornice: out over its top, down its face, back to the wall corner
  const e = sec.eaves_h;
  const pj = cd.projection + so;
  pts.push([c.sx * (L2 + pj), c.ty * (D2 + pj), e + so]);
  pts.push([c.sx * (L2 + pj), c.ty * (D2 + pj), e - cd.height - so]);
  const w = ARTICULATION.ecklisene.projection + so;
  pts.push([c.sx * (L2 + w), c.ty * (D2 + w), e - cd.height - so]);
  pts.push([c.sx * (L2 + w), c.ty * (D2 + w), ground]);
  return pts;
}

/** Opening interval on a side (facade position a and width), for pier finding; `leaf` = open shutter leaf width. */
export interface SideOpening {
  a: number;
  width: number;
  /** Width of each open shutter leaf lying flat against the wall beside the surround (0 / absent: no shutters). */
  leaf?: number;
  /** A passage (Durchfahrt, carriage gate, portal): its flanks are preferred pipe spots like a risalit's. */
  passage?: boolean;
}

export interface DownpipeOptions {
  /** Risalit / frontispiece spans [a0, a1] on the side: no pipe inside; their flanks are preferred spots. */
  risalits?: readonly (readonly [number, number])[];
  /** Largest distance between neighbouring pipes along the front (m). */
  maxSpacing?: number;
  /** Smallest free pier (after surrounds and shutter leaves) a pipe may stand in (m). */
  minPier?: number;
  /**
   * Fallback corner position (m from the corner) on the arris of the corner lisene, used when the outer window's open
   * shutter reaches the corner pipe at `inset` (default 0.15).
   */
  arris?: number;
}

/** Half width blocked round an opening: surround, open shutter leaf and the pipe's own clearance [N; I]. */
export function openingBlock(o: SideOpening): number {
  const r = DOWNPIPE.diameter / 2;
  const sf = ARTICULATION.surround.face;
  return o.leaf ? o.width / 2 + sf + 0.02 + o.leaf + 0.04 + r : o.width / 2 + sf + 0.12 + r;
}

/**
 * Downpipe positions (facade a) on a side of length `len` (research/09 §2.8: box gutters drain "through a few downpipes
 * at the corners and next to risalits"; G5 one per 15–20 m of eaves) [N], wave-4 review rules (passage flanks count as
 * risalit flanks [I]):
 *  - len ≤ DOWNPIPE.maxEaves: one pipe at the corner `lone` (court and garden take opposite corners, a diagonal pair);
 *  - longer: pipes at both free corners first; while two neighbouring pipes are more than `maxSpacing` apart (an
 *    end run without a corner pipe: half of it), one more goes in the middle 60 % of that run: at a risalit flank (the
 *    re-entrant corner beside a risalit) if there is one, else in the free pier nearest the middle of the run;
 *  - never inside a risalit / frontispiece (its outer building corner excepted) and never on a surround or an open
 *    shutter leaf (`openingBlock`); a pier must leave `minPier` free.
 * `cornerFree[0|1]`: may a pipe stand at a = 0 / a = len (not inside a junction)? Corner pipes stand `inset` m in, or
 * on the corner arris (`opts.arris`) where the outer shutter reaches that far. A run with no free spot (every pier taken
 * by shutter leaves, as on the louvred palace fronts) stays longer than `maxSpacing`: its gutter drains to the corners.
 */
export function downpipePositions(len: number, openings: readonly SideOpening[], cornerFree: readonly [boolean, boolean], lone: 0 | 1, inset: number, opts: DownpipeOptions = {}): number[] {
  const maxSpacing = opts.maxSpacing ?? DOWNPIPE.maxSpacing;
  const minPier = opts.minPier ?? 0.35;
  const r = DOWNPIPE.diameter / 2;
  const ris = (opts.risalits ?? []).map(([a0, a1]) => [Math.min(a0, a1), Math.max(a0, a1)] as [number, number]);
  const ops = openings.map((o) => [o.a - openingBlock(o), o.a + openingBlock(o)] as [number, number]);
  const merge = (iv: [number, number][]) => {
    const out: [number, number][] = [];
    for (const [x0, x1] of [...iv].sort((x, y) => x[0] - y[0])) {
      const last = out[out.length - 1];
      if (last && x0 <= last[1]) last[1] = Math.max(last[1], x1);
      else out.push([x0, x1]);
    }
    return out;
  };
  const opBlocked = merge(ops);
  const inOpening = (p: number) => opBlocked.some(([x0, x1]) => p > x0 && p < x1);
  const rc = 0.15 + r; // clear of a risalit's return face
  const inRisalit = (p: number) => ris.some(([a0, a1]) => p > a0 - rc && p < a1 + rc);
  const arris = opts.arris ?? 0.15;
  const corner = (k: 0 | 1): number | null => {
    if (!cornerFree[k]) return null;
    for (const d of [inset, Math.min(inset, arris)]) {
      const p = k === 0 ? d : len - d;
      if (!inOpening(p)) return p;
    }
    return null;
  };
  if (len <= DOWNPIPE.maxEaves) {
    const p = corner(lone) ?? corner(lone === 0 ? 1 : 0);
    return p === null ? [] : [p];
  }
  // candidate spots: risalit flanks first, then piers (free gaps between surrounds, leaves and risalits)
  const lo = inset;
  const hi = len - inset;
  const flanks: number[] = [];
  for (const [a0, a1] of ris) for (const p of [a0 - rc - 0.05, a1 + rc + 0.05]) if (p >= lo && p <= hi && !inOpening(p) && !inRisalit(p)) flanks.push(p);
  for (const o of openings) if (o.passage) for (const p of [o.a - openingBlock(o) - 0.01, o.a + openingBlock(o) + 0.01]) if (p >= lo && p <= hi && !inOpening(p) && !inRisalit(p)) flanks.push(p);
  const piers: number[] = [];
  let a = lo + 0.3;
  for (const [x0, x1] of [...merge([...ops, ...ris.map(([a0, a1]) => [a0 - rc, a1 + rc] as [number, number])]), [hi - 0.3, len] as [number, number]]) {
    if (x0 - a >= minPier) piers.push((a + x0) / 2);
    a = Math.max(a, x1);
  }
  const out: number[] = [];
  for (const k of [0, 1] as const) {
    const p = corner(k);
    if (p !== null) out.push(p);
  }
  const done = new Set<string>();
  for (let iter = 0; iter < 64; iter++) {
    const pts = [...out].sort((x, y) => x - y);
    // runs between pipes; an open end (no corner pipe) counts double, its gutter drains one way only
    const runs: { from: number; to: number; excess: number }[] = [];
    const bounds = [0, ...pts, len];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const x0 = bounds[i];
      const x1 = bounds[i + 1];
      const openEnd = (i === 0 && !pts.length) || (i === 0 && pts[0] > inset + 0.5) || (i === bounds.length - 2 && pts[pts.length - 1] < len - inset - 0.5);
      const span = (x1 - x0) * (openEnd ? 2 : 1);
      if (span > maxSpacing && !done.has(`${x0}|${x1}`)) runs.push({ from: x0, to: x1, excess: span - maxSpacing });
    }
    if (!runs.length) break;
    runs.sort((x, y) => y.excess - x.excess);
    const run = runs[0];
    const mid = (run.from + run.to) / 2;
    // only a spot in the middle 60 % of the run shortens it usefully (not a pipe 3 m from the corner pipe)
    const reach = Math.max(1, 0.3 * (run.to - run.from));
    const pick = (cands: number[]) => cands.filter((p) => p > run.from + 1 && p < run.to - 1 && Math.abs(p - mid) <= reach).sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid))[0];
    const p = pick(flanks) ?? pick(piers);
    if (p === undefined) done.add(`${run.from}|${run.to}`);
    else out.push(p);
  }
  return out.sort((x, y) => x - y);
}

/**
 * Downpipe positions on the `side` of a building layout: its openings (windows carry their open shutter leaves when the
 * facade has louvred or plank shutters, as exterior/facade.ts draws them: one leaf = half the window width) and its
 * risalits feed `downpipePositions`.
 */
export function sideDownpipes(L: BuildingLayout, side: SideName, cornerFree: readonly [boolean, boolean], lone: 0 | 1, inset: number, opts: DownpipeOptions = {}): number[] {
  const sd = L.frame.sides[side];
  const lay = L.sides[side];
  if (!sd || !lay) return [];
  const f = L.building.facade;
  const st = f.shutter_type ?? (f.shutters ? 'louvred' : 'none');
  const shutters = st === 'louvred' || st === 'plank';
  const ops: SideOpening[] = L.openings
    .filter((o) => o.side === side)
    .map((o) => ({ a: o.a, width: o.width, leaf: shutters && o.kind === 'window' ? o.width / 2 : 0, passage: o.kind === 'durchfahrt' || o.kind === 'carriage_gate' || o.kind === 'portal' }));
  return downpipePositions(sd.length, ops, cornerFree, lone, inset, { risalits: lay.risalits.map((r) => [r.a0, r.a1] as const), ...opts });
}
