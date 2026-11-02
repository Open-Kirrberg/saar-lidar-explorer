/**
 * Wave-8 review fix (KB-I71, KB-W8 Felsenpfad): a landscape-garden rock path is a narrow footpath of trodden earth
 * that follows the bank, with the bedrock showing beside it, not a raked gravel walk.
 *
 * - `isTroddenPath`: a path whose surface is 'trodden earth'. Such a path is not painted into the ground classes by
 *   scripts/prepare-terrain.py (so it moves no tree of the viewer's planners) and is drawn by site/features.ts as a
 *   soft earth ribbon whose width breathes along the line.
 * - `pathWidthFactor`: the smooth width variation of that ribbon (0.7–1.2 of the nominal width, ~7 m wavelength) [I].
 * - `outcropPlan`: a few low Buntsandstein outcrops beside the path, mostly on the uphill side, as ledges lying along
 *   the contour (the Buntsandstein beds lie nearly flat) [N landscape-garden rockwork; the Karlslust tumulus and dams
 *   were faced with boulders, research/11 §1.4 D; positions and sizes I]. The inscribed rock itself is U and not drawn.
 *
 * - `edgeStonePlan` (wave 9, garden; visual audit #1: the path still read as a flat pink ruled line at 39-41 / 48): loose
 *   stones and bedded rock heads along both edges of the tread, in irregular runs with gaps, the kind of edging a worn
 *   rock path collects (stones kicked or set aside, bedrock breaking the turf) [N landscape-garden rock paths; I].
 *
 * Pure (no three): coordinates are the local frame (x = E − E0, z = −(N − N0)); tested in model/tests.
 */
import { mulberry32, pointAlong, polylineLength, type P2 } from '../layout/geom.ts';

/** Surface keyword of a trodden earth footpath (catalogue `surface`). */
export const TRODDEN_EARTH = 'trodden earth';

export function isTroddenPath(f: { kind: string; surface?: string }): boolean {
  return f.kind === 'path' && (f.surface ?? '').toLowerCase().includes(TRODDEN_EARTH);
}

/** Smooth 1-D value noise in [0, 1] (cosine-interpolated knots every `wave` m), deterministic for the seed. */
export function smoothNoise1(seed: number, wave: number): (s: number) => number {
  const rnd = mulberry32(seed);
  const knots: number[] = [];
  const knot = (i: number) => {
    while (knots.length <= i) knots.push(rnd());
    return knots[i];
  };
  return (s: number) => {
    const u = Math.max(0, s) / wave;
    const i = Math.floor(u);
    const f = u - i;
    const w = (1 - Math.cos(Math.PI * f)) / 2;
    return knot(i) * (1 - w) + knot(i + 1) * w;
  };
}

/** Width factor of a trodden path at arc length `s` (m): 0.7–1.2, tapering to 0.75 at both ends [I]. */
export function pathWidthFactor(seed: number, length: number): (s: number) => number {
  const a = smoothNoise1(seed ^ 0x5a17, 7);
  const b = smoothNoise1(seed ^ 0x3c3, 2.3);
  return (s: number) => {
    const k = 0.7 + 0.4 * a(s) + 0.1 * b(s);
    const end = Math.min(1, Math.min(s, length - s) / 4);
    return 0.75 + (k - 0.75) * Math.max(0, end);
  };
}

export interface Outcrop {
  /** centre on the ground (local x, z) */
  x: number;
  z: number;
  /** rotation about the vertical (rad): the long axis runs along the path */
  yaw: number;
  /** long axis, short axis, height above ground (m) */
  len: number;
  wid: number;
  h: number;
  /** +1 uphill side of the path, −1 downhill */
  side: 1 | -1;
}

export interface OutcropOptions {
  /** nominal path width (m) */
  width: number;
  /** spacing of the outcrop sites along the path (m, default 22) */
  every?: number;
  /** ground height at local (x, z) (uphill side; flat without it: left of the line) */
  height?: (x: number, z: number) => number;
  /** reject a stone centre here (water, a building) */
  avoid?: (x: number, z: number) => boolean;
}

/**
 * Outcrop sites every ~`every` m along `line` (not within 6 m of the ends), each a ledge of 1.6–3.4 × 0.9–1.7 m,
 * 0.4–0.9 m proud, 0.7–2.3 m beyond the path edge, with 1–3 smaller blocks of the same bed beside it (away from the
 * path); ~1 in 5 sites lies on the downhill side (lower). Deterministic for `seed`.
 */
export function outcropPlan(line: readonly P2[], seed: number, o: OutcropOptions): Outcrop[] {
  const L = polylineLength(line);
  const every = o.every ?? 22;
  const rnd = mulberry32(seed ^ 0x0c7a);
  const out: Outcrop[] = [];
  const half = o.width / 2;
  for (let s = 6 + rnd() * every * 0.5; s < L - 6; s += every * (0.75 + 0.5 * rnd())) {
    const { p, dir } = pointAlong(line, s);
    const n: P2 = [-dir[1], dir[0]];
    // uphill side from the terrain (3 m either side), else the left of the line
    let up: 1 | -1 = 1;
    if (o.height) {
      const hl = o.height(p[0] + n[0] * 3, p[1] + n[1] * 3);
      const hr = o.height(p[0] - n[0] * 3, p[1] - n[1] * 3);
      if (Number.isFinite(hl) && Number.isFinite(hr)) up = hl >= hr ? 1 : -1;
    }
    const u1 = rnd();
    const side: 1 | -1 = u1 < 0.2 ? (-up as 1 | -1) : up;
    const len = 1.6 + 1.8 * rnd();
    const wid = Math.min(len * 0.8, 0.9 + 0.8 * rnd());
    const h = (0.4 + 0.5 * rnd()) * (side === up ? 1 : 0.7);
    const off = half + 0.7 + 1.6 * rnd() + wid / 2;
    const yaw = Math.atan2(dir[1], dir[0]) + (rnd() - 0.5) * 0.5;
    const x = p[0] + n[0] * off * side;
    const z = p[1] + n[1] * off * side;
    // an outcrop is a group: the main ledge and 1-3 smaller blocks of the same bed beside it, away from the path
    const extra = 1 + Math.floor(rnd() * 3);
    if (!o.avoid?.(x, z)) out.push({ x, z, yaw, len, wid, h, side });
    for (let k = 0; k < extra; k++) {
      const along = (rnd() - 0.5) * (len + 1.6);
      const outw = wid * 0.5 + 0.3 + rnd() * 1.1;
      const cx = x + dir[0] * along + n[0] * outw * side;
      const cz = z + dir[1] * along + n[1] * outw * side;
      const f = 0.35 + 0.35 * rnd();
      // the smaller blocks keep clear of the path
      const dc = (cx - p[0]) * n[0] * side + (cz - p[1]) * n[1] * side;
      if (dc > half + 0.6 && !o.avoid?.(cx, cz)) out.push({ x: cx, z: cz, yaw: yaw + (rnd() - 0.5) * 1.2, len: len * f, wid: wid * f * 1.1, h: h * (0.5 + 0.4 * rnd()), side });
    }
  }
  return out;
}

/** Edge stones of a rock path: spacing (m) along each edge, the share of stones dropped (gaps), sizes (m) [I]. */
export const EDGE_STONES = { every: 2.1, gap: 0.5, len: [0.14, 0.5] as const, h: [0.05, 0.15] as const, out: [-0.1, 0.45] as const } as const;

/**
 * Loose stones and rock heads along both edges of a rock path (`width` m nominal; the tread breathes with
 * `pathWidthFactor`, so pass it as `widthAt` to follow it): every ~`EDGE_STONES.every` m per side, in runs broken by
 * gaps (smooth noise, ~`EDGE_STONES.gap` dropped), each 0.14-0.5 m long and 0.05-0.15 m proud, set from just inside
 * the tread edge to 0.45 m beyond it, long axis roughly along the path; not within 1.5 m of the ends. Deterministic.
 */
export function edgeStonePlan(line: readonly P2[], seed: number, o: { width: number; widthAt?: (s: number) => number; avoid?: (x: number, z: number) => boolean }): Outcrop[] {
  const L = polylineLength(line);
  const E = EDGE_STONES;
  const rnd = mulberry32(seed ^ 0xed6e);
  const runs = [smoothNoise1(seed ^ 0x11, 5.5), smoothNoise1(seed ^ 0x23, 4.1)];
  const out: Outcrop[] = [];
  for (const [k, side] of [[0, 1], [1, -1]] as const) {
    for (let s = 1.5 + rnd() * E.every; s < L - 1.5; s += E.every * (0.6 + 0.8 * rnd())) {
      const u = [rnd(), rnd(), rnd(), rnd(), rnd()];
      if (runs[k](s) < E.gap) continue;
      const { p, dir } = pointAlong(line, s);
      const n: P2 = [-dir[1], dir[0]];
      const half = (o.width / 2) * (o.widthAt ? o.widthAt(s) : 1);
      const len = E.len[0] + (E.len[1] - E.len[0]) * u[0] * u[0];
      const wid = len * (0.55 + 0.35 * u[1]);
      const h = E.h[0] + (E.h[1] - E.h[0]) * u[2];
      const off = half + E.out[0] + (E.out[1] - E.out[0]) * u[3] + wid / 2;
      const x = p[0] + n[0] * off * side;
      const z = p[1] + n[1] * off * side;
      if (o.avoid?.(x, z)) continue;
      out.push({ x, z, yaw: Math.atan2(dir[1], dir[0]) + (u[4] - 0.5) * 1.1, len, wid, h, side: side as 1 | -1 });
    }
  }
  return out;
}

/**
 * Vertices (unit icosahedron, jittered and flattened on top: a weathered, bedded sandstone block) and faces of one
 * outcrop, in its own frame (x along the long axis, y up, z across); scale by (len / 2, h, wid / 2) and sink about half.
 */
export function outcropShape(seed: number): { v: [number, number, number][]; f: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const f: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const rnd = mulberry32(seed ^ 0x7ee1);
  const v = raw.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    const j = 0.78 + 0.34 * rnd();
    let yy = (y / l) * j;
    // bedded top: the upper part is flattened (a weathered ledge, not a box)
    if (yy > 0.6) yy = 0.6 + (yy - 0.6) * 0.45;
    return [(x / l) * j, yy, (z / l) * j] as [number, number, number];
  });
  return { v, f };
}
