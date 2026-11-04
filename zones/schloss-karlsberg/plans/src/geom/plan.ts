/**
 * Floor-plan geometry (pure): wall poché from room polygons, wall depth at an opening, rectangle
 * helpers. All coordinates are building-local [s, t] metres (layout/footprint.ts).
 *
 * Wall poché: the clear spaces (rooms + stair halls) of one storey are subtracted from the
 * outline. With axis-aligned rectangles this is exact on a compressed grid: every unique s and
 * t of the outline and the spaces cuts the outline into cells; a free cell is
 *   - wall  if it lies in a free strip no wider than `maxWall` (default 1.3 m) in s or in t,
 *   - void  otherwise (unassigned area: no room in the catalogue -> drawn as "unbekannt").
 * Wall cells within `outerThickness` of the outline are the outer walls (position documented
 * by the footprint); the others are partitions / spine walls (inferred) and get the
 * hypothesis hatch.
 */
import type { PolygonST, ST } from '../../../model/src/spec.ts';

export interface Rect {
  s0: number;
  s1: number;
  t0: number;
  t1: number;
}

export const EPS = 1e-6;

export function rectArea(r: Rect): number {
  return Math.max(0, r.s1 - r.s0) * Math.max(0, r.t1 - r.t0);
}

export function rectPoly(r: Rect): PolygonST {
  return [
    [r.s0, r.t0],
    [r.s1, r.t0],
    [r.s1, r.t1],
    [r.s0, r.t1],
  ];
}

/** Axis-aligned rectangle of a polygon, or null if the polygon is not one. */
export function rectOf(poly: readonly ST[], tol = 0.02): Rect | null {
  if (poly.length < 4) return null;
  const s = poly.map((p) => p[0]);
  const t = poly.map((p) => p[1]);
  const r: Rect = { s0: Math.min(...s), s1: Math.max(...s), t0: Math.min(...t), t1: Math.max(...t) };
  for (const p of poly) {
    const onS = Math.abs(p[0] - r.s0) < tol || Math.abs(p[0] - r.s1) < tol;
    const onT = Math.abs(p[1] - r.t0) < tol || Math.abs(p[1] - r.t1) < tol;
    if (!(onS && onT)) return null;
  }
  return r;
}

export function insetRect(r: Rect, d: number): Rect {
  return { s0: r.s0 + d, s1: r.s1 - d, t0: r.t0 + d, t1: r.t1 - d };
}

function uniq(v: number[], tol = 0.005): number[] {
  const s = [...v].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) if (!out.length || x - out[out.length - 1] > tol) out.push(x);
  return out;
}

function clampRect(r: Rect, o: Rect): Rect {
  return { s0: Math.max(r.s0, o.s0), s1: Math.min(r.s1, o.s1), t0: Math.max(r.t0, o.t0), t1: Math.min(r.t1, o.t1) };
}

export interface WallCell extends Rect {
  outer: boolean;
}

export interface PlanCells {
  walls: WallCell[];
  voids: Rect[];
  /** Area check: outline = spaces + walls + voids (m²). */
  areas: { outline: number; spaces: number; walls: number; voids: number };
}

export interface PlanCellOptions {
  /** Max width of a free strip that counts as wall (m). */
  maxWall?: number;
  /** Outer wall thickness (m) for the outer / inner classification. */
  outerThickness?: number;
  /** Band along the outline that is always wall (never void), m; default = no forced band. */
  outerWall?: number;
}

export function planCells(outline: Rect, spaces: readonly Rect[], o: PlanCellOptions = {}): PlanCells {
  const maxWall = o.maxWall ?? 1.3;
  const outerT = o.outerThickness ?? 1.0;
  const sp = spaces.map((r) => clampRect(r, outline)).filter((r) => r.s1 - r.s0 > EPS && r.t1 - r.t0 > EPS);
  const ow = o.outerWall ?? 0;
  const band = ow > 0 ? { s: [outline.s0 + ow, outline.s1 - ow], t: [outline.t0 + ow, outline.t1 - ow] } : { s: [], t: [] };
  const S = uniq([outline.s0, outline.s1, ...band.s, ...sp.flatMap((r) => [r.s0, r.s1])]).filter((x) => x >= outline.s0 - EPS && x <= outline.s1 + EPS);
  const T = uniq([outline.t0, outline.t1, ...band.t, ...sp.flatMap((r) => [r.t0, r.t1])]).filter((x) => x >= outline.t0 - EPS && x <= outline.t1 + EPS);
  const inBand = (r: Rect) => ow > 0 && (r.s1 <= outline.s0 + ow + EPS || r.s0 >= outline.s1 - ow - EPS || r.t1 <= outline.t0 + ow + EPS || r.t0 >= outline.t1 - ow - EPS);
  const ni = S.length - 1;
  const bandCell = new Set<number>();
  const nj = T.length - 1;
  const free: boolean[][] = [];
  for (let i = 0; i < ni; i++) {
    free.push([]);
    for (let j = 0; j < nj; j++) {
      const cs = (S[i] + S[i + 1]) / 2;
      const ct = (T[j] + T[j + 1]) / 2;
      free[i].push(!sp.some((r) => cs > r.s0 && cs < r.s1 && ct > r.t0 && ct < r.t1));
    }
  }
  // band cells never join a void block
  if (ow > 0)
    for (let i = 0; i < ni; i++)
      for (let j = 0; j < nj; j++) if (free[i][j] && inBand({ s0: S[i], s1: S[i + 1], t0: T[j], t1: T[j + 1] })) bandCell.add(i * nj + j);
  const isFree = (i: number, j: number) => free[i][j] && !bandCell.has(i * nj + j);
  // a free cell is void if some all-free block containing it is wider AND deeper than maxWall
  const blockFree = (i0: number, i1: number, j: number) => {
    for (let i = i0; i <= i1; i++) if (!isFree(i, j)) return false;
    return true;
  };
  const isVoid = (i: number, j: number): boolean => {
    for (let i0 = i; i0 >= 0 && isFree(i0, j); i0--) {
      // smallest i1 >= i with width > maxWall
      let i1 = i;
      while (i1 < ni - 1 && S[i1 + 1] - S[i0] <= maxWall + EPS && isFree(i1 + 1, j)) i1++;
      if (S[i1 + 1] - S[i0] <= maxWall + EPS || !blockFree(i0, i1, j)) continue;
      let j0 = j;
      let j1 = j;
      while (j0 > 0 && blockFree(i0, i1, j0 - 1)) j0--;
      while (j1 < nj - 1 && blockFree(i0, i1, j1 + 1)) j1++;
      if (T[j1 + 1] - T[j0] > maxWall + EPS) return true;
    }
    return false;
  };
  const walls: WallCell[] = [];
  const voids: Rect[] = [];
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      if (!free[i][j]) continue;
      const r: Rect = { s0: S[i], s1: S[i + 1], t0: T[j], t1: T[j + 1] };
      if (inBand(r) || !isVoid(i, j)) {
        const outer =
          r.s1 <= outline.s0 + outerT + 0.05 || r.s0 >= outline.s1 - outerT - 0.05 || r.t1 <= outline.t0 + outerT + 0.05 || r.t0 >= outline.t1 - outerT - 0.05;
        walls.push({ ...r, outer });
      } else voids.push(r);
    }
  }
  return {
    walls: mergeCells(walls),
    voids: mergeRects(voids),
    areas: {
      outline: rectArea(outline),
      spaces: sp.reduce((s, r) => s + rectArea(r), 0),
      walls: walls.reduce((s, r) => s + rectArea(r), 0),
      voids: voids.reduce((s, r) => s + rectArea(r), 0),
    },
  };
}

/** Merge cells with equal t-range that touch along s (fewer SVG elements, same area). */
export function mergeRects<T extends Rect>(cells: T[], same: (a: T, b: T) => boolean = () => true): T[] {
  const sorted = [...cells].sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1 || a.s0 - b.s0);
  const out: T[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t0 - c.t0) < EPS && Math.abs(last.t1 - c.t1) < EPS && Math.abs(last.s1 - c.s0) < EPS && same(last, c)) {
      last.s1 = c.s1;
    } else out.push({ ...c });
  }
  return out;
}

function mergeCells(cells: WallCell[]): WallCell[] {
  return mergeRects(cells, (a, b) => a.outer === b.outer);
}

/**
 * Distance from point p along unit direction dir to the first space rectangle face (the wall's
 * inner face), or `fallback` if no space is hit within `maxD`.
 */
export function wallDepth(p: ST, dir: ST, spaces: readonly Rect[], maxD = 2.5, fallback = 0.7): number {
  let best = Infinity;
  for (const r of spaces) {
    // slab intersection of the ray with the rectangle
    let tmin = 0;
    let tmax = maxD;
    for (const [o, dd, lo, hi] of [
      [p[0], dir[0], r.s0, r.s1],
      [p[1], dir[1], r.t0, r.t1],
    ] as const) {
      if (Math.abs(dd) < 1e-12) {
        if (o < lo || o > hi) {
          tmin = Infinity;
          break;
        }
      } else {
        const a = (lo - o) / dd;
        const b = (hi - o) / dd;
        tmin = Math.max(tmin, Math.min(a, b));
        tmax = Math.min(tmax, Math.max(a, b));
      }
    }
    if (tmin <= tmax && tmin < best) best = tmin;
  }
  return Number.isFinite(best) && best > 0.02 ? best : fallback;
}

/** Thickness of a partition at point p (segment wall): free distance on both sides to spaces. */
export function partitionThickness(p: ST, normal: ST, spaces: readonly Rect[], fallback = 0.16): [number, number] {
  const a = wallDepth(p, normal, spaces, 1.6, fallback / 2);
  const b = wallDepth(p, [-normal[0], -normal[1]], spaces, 1.6, fallback / 2);
  return [a, b];
}

/** Polygon offset with mitred corners (d > 0 shrinks a CCW polygon). Simple polygons only. */
export function offsetPolygon(poly: readonly ST[], d: number): ST[] {
  const n = poly.length;
  const out: ST[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n];
    const b = poly[i];
    const c = poly[(i + 1) % n];
    const e1 = norm([b[0] - a[0], b[1] - a[1]]);
    const e2 = norm([c[0] - b[0], c[1] - b[1]]);
    // inward normals of a CCW polygon = edge rotated CCW
    const n1: ST = [-e1[1], e1[0]];
    const n2: ST = [-e2[1], e2[0]];
    const bis = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const cos = bis[0] * n1[0] + bis[1] * n1[1];
    const m = d / Math.max(0.2, cos);
    out.push([b[0] + bis[0] * m, b[1] + bis[1] * m]);
  }
  return out;
}

function norm(v: ST): ST {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Interval(s) of a line t = const (or s = const) covered by rectangles: used by sections. */
export function coverAlong(rects: readonly Rect[], axis: 's' | 't', at: number): [number, number][] {
  const iv: [number, number][] = [];
  for (const r of rects) {
    if (axis === 's') {
      // line along s at t = at
      if (at > r.t0 + EPS && at < r.t1 - EPS) iv.push([r.s0, r.s1]);
    } else if (at > r.s0 + EPS && at < r.s1 - EPS) iv.push([r.t0, r.t1]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const x of iv) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1] + EPS) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

/** Complement of intervals within [a, b]. */
export function gaps(iv: readonly [number, number][], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  let x = a;
  for (const [p, q] of iv) {
    if (p > x + EPS) out.push([x, Math.min(p, b)]);
    x = Math.max(x, q);
  }
  if (b > x + EPS) out.push([x, b]);
  return out;
}
