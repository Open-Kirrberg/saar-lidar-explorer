/**
 * Pure opening cut-out math for facade walls (no three.js; unit-tested in model/tests/exterior.cut.test.ts).
 *
 * A wall band is the rectangle [0, length] × [h0, h1] in facade coordinates (a = metres along the side from
 * p0, h = absolute height). Holes are axis-aligned rectangles; arched heads are cut as their bounding rectangle
 * and the spandrels between the rectangle top and the arch are filled back (archSpandrels).
 */
import type { HeadForm } from '../spec.ts';

export interface Rect {
  a0: number;
  a1: number;
  h0: number;
  h1: number;
}

const EPS = 1e-6;

/** Clip a rectangle to a band; null if nothing is left. */
export function clipRect(r: Rect, band: Rect): Rect | null {
  const a0 = Math.max(r.a0, band.a0);
  const a1 = Math.min(r.a1, band.a1);
  const h0 = Math.max(r.h0, band.h0);
  const h1 = Math.min(r.h1, band.h1);
  if (a1 - a0 < 1e-4 || h1 - h0 < 1e-4) return null;
  return { a0, a1, h0, h1 };
}

function merge(iv: [number, number][]): [number, number][] {
  const s = iv.slice().sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Solid pieces of `band` minus `holes` (slab decomposition): vertical slabs between all hole edges, in each slab
 * the free height intervals. Adjacent slabs with identical intervals are merged, so a plain wall stays 1 quad.
 * The union of the pieces is exactly band − holes, pieces do not overlap.
 */
export function wallPieces(band: Rect, holes: Rect[]): Rect[] {
  const hs = holes.map((h) => clipRect(h, band)).filter((h): h is Rect => h !== null);
  const xs = new Set<number>([band.a0, band.a1]);
  for (const h of hs) {
    xs.add(h.a0);
    xs.add(h.a1);
  }
  const cuts = [...xs].sort((a, b) => a - b);
  const out: Rect[] = [];
  let prev: { a0: number; a1: number; free: [number, number][] } | null = null;
  const flush = () => {
    if (!prev) return;
    for (const [h0, h1] of prev.free) out.push({ a0: prev.a0, a1: prev.a1, h0, h1 });
    prev = null;
  };
  for (let i = 0; i < cuts.length - 1; i++) {
    const a0 = cuts[i];
    const a1 = cuts[i + 1];
    if (a1 - a0 < EPS) continue;
    const mid = (a0 + a1) / 2;
    const covered = merge(hs.filter((h) => h.a0 <= mid && h.a1 >= mid).map((h): [number, number] => [h.h0, h.h1]));
    const free: [number, number][] = [];
    let y = band.h0;
    for (const [c0, c1] of covered) {
      if (c0 > y + EPS) free.push([y, c0]);
      y = Math.max(y, c1);
    }
    if (band.h1 > y + EPS) free.push([y, band.h1]);
    if (prev && sameIntervals(prev.free, free)) {
      prev.a1 = a1;
      continue;
    }
    flush();
    prev = { a0, a1, free };
  }
  flush();
  return out;
}

function sameIntervals(a: [number, number][], b: [number, number][]): boolean {
  if (a.length !== b.length) return false;
  return a.every(([x, y], i) => Math.abs(x - b[i][0]) < EPS && Math.abs(y - b[i][1]) < EPS);
}

export function area(r: Rect): number {
  return (r.a1 - r.a0) * (r.h1 - r.h0);
}

/** Rise of an arched head for an opening of width w (segmental: 1/6 of the width [N]; round: w/2). */
export function archRise(head: HeadForm | undefined, w: number): number {
  if (head === 'segmental') return w / 6;
  if (head === 'round') return w / 2;
  return 0;
}

/**
 * Points of the arch intrados from the left springer (a0, hs) over the top to the right springer (a1, hs),
 * hs = top − rise. Segmental = circular arc through the springers and the crown.
 */
export function archCurve(a0: number, a1: number, top: number, head: HeadForm | undefined, n = 8): [number, number][] {
  const w = a1 - a0;
  const rise = archRise(head, w);
  const hs = top - rise;
  if (rise <= 0) return [
    [a0, top],
    [a1, top],
  ];
  const half = w / 2;
  // circle through (±half, 0) and (0, rise): R = (half² + rise²) / (2 rise), centre at (0, rise − R)
  const R = (half * half + rise * rise) / (2 * rise);
  const cy = rise - R;
  const phi = Math.asin(Math.min(1, half / R));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = -phi + (2 * phi * i) / n;
    pts.push([a0 + half + R * Math.sin(t), hs + cy + R * Math.cos(t)]);
  }
  pts[0] = [a0, hs];
  pts[n] = [a1, hs];
  return pts;
}

/**
 * The two spandrel polygons (wall material) between the rectangular cut [a0, a1] × [.., top] and the arch:
 * left = top-left corner down to the left springer along the arch to the crown; right likewise. Empty for
 * straight heads. Polygons are counter-clockwise in (a, h).
 */
export function archSpandrels(a0: number, a1: number, top: number, head: HeadForm | undefined, n = 8): [number, number][][] {
  const c = archCurve(a0, a1, top, head, n);
  if (c.length <= 2) return [];
  const mid = Math.floor(c.length / 2);
  const left: [number, number][] = [[a0, top], ...c.slice(0, mid + 1)];
  const right: [number, number][] = [...c.slice(mid), [a1, top]];
  // left: (a0,top) → springer (a0,hs) → … → crown: clockwise? make CCW by signed area
  return [ccw(left), ccw(right)];
}

export function signedArea2(p: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

function ccw(p: [number, number][]): [number, number][] {
  return signedArea2(p) < 0 ? p.slice().reverse() : p;
}
