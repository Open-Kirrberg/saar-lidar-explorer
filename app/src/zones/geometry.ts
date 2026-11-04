/** V2.6: planar ring helpers for zone footprints (EPSG:25832 metres). Pure. */
import type { EN } from './contract';

/** Signed area (shoelace): > 0 = counter-clockwise. */
export function ringSignedArea(ring: readonly EN[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * Drop a closing vertex and consecutive duplicates, orient CCW. Null if fewer than 3 distinct
 * vertices remain or the area is (near) zero.
 */
export function normaliseRing(input: readonly EN[]): EN[] | null {
  const ring: EN[] = [];
  for (const p of input) {
    const last = ring[ring.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) ring.push([p[0], p[1]]);
  }
  while (ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]) ring.pop();
  if (ring.length < 3) return null;
  const a = ringSignedArea(ring);
  if (Math.abs(a) < 1e-6) return null;
  return a > 0 ? ring : ring.reverse();
}

const orient = (a: EN, b: EN, c: EN): number => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const onSeg = (a: EN, b: EN, p: EN): boolean =>
  Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

function segmentsIntersect(p1: EN, p2: EN, q1: EN, q2: EN): boolean {
  const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2), o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSeg(p1, p2, q1)) || (o2 === 0 && onSeg(p1, p2, q2)) || (o3 === 0 && onSeg(q1, q2, p1)) || (o4 === 0 && onSeg(q1, q2, p2));
}

/** True if no two non-adjacent edges touch (O(n²); footprints are small). */
export function ringIsSimple(ring: readonly EN[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      if (segmentsIntersect(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

/** Even-odd point-in-polygon (boundary counts as inside within floating-point limits). */
export function pointInRing(E: number, N: number, ring: readonly EN[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > N !== yj > N && E < ((xj - xi) * (N - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function ringBbox(ring: readonly EN[]): [EN, EN] {
  let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
  for (const [e, n] of ring) {
    e0 = Math.min(e0, e); n0 = Math.min(n0, n); e1 = Math.max(e1, e); n1 = Math.max(n1, n);
  }
  return [[e0, n0], [e1, n1]];
}
