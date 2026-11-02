/**
 * Free-standing walls (WALL class, catalogue `line`) against building footprints (pure, no three.js).
 *
 * Fix round 1 (review-1 #1): the Orangerie-Stützmauer KB-B14 runs exactly along the W face of KB-B10. It is the
 * building's basement front, not a second wall in front of it. Consumers (exterior, plans) build only the parts
 * of a wall line that do NOT coincide with a placed building footprint.
 */
import type { EN, RingEN } from '../spec.ts';
import { pointInPolygon, polylineLength, pointAlong } from './geom.ts';

/** Distance from point p to the boundary of a ring (m). */
export function distanceToRing(p: EN, ring: RingEN): number {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * u), p[1] - (a[1] + dy * u)));
  }
  return best;
}

/**
 * Parts of a wall centre line that lie neither inside a footprint nor within `tol` m of its boundary, as
 * [d0, d1] intervals of distance along the line (from line[0]). Pieces shorter than `minLength` are dropped.
 */
export function wallFreeSpans(line: EN[], footprints: RingEN[], tol = 0.8, step = 0.25, minLength = 1.0): [number, number][] {
  const len = polylineLength(line);
  if (len <= 0) return [];
  const n = Math.max(1, Math.ceil(len / step));
  const free: boolean[] = [];
  for (let i = 0; i <= n; i++) {
    const { p } = pointAlong(line, (len * i) / n);
    const q = p as EN;
    free.push(!footprints.some((r) => pointInPolygon(q, r) || distanceToRing(q, r) <= tol));
  }
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    if (free[i] && start < 0) start = i;
    if ((!free[i] || i === n) && start >= 0) {
      const end = free[i] ? i : i - 1;
      const d0 = (len * start) / n;
      const d1 = (len * end) / n;
      if (d1 - d0 >= minLength) out.push([d0, d1]);
      start = -1;
    }
  }
  return out;
}
