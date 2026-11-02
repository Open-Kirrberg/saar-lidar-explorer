/** Small 2D geometry helpers (pure). Points are [x, y] tuples (EN or ST). */

export type P2 = [number, number];

/** Remove the closing point of a ring if present. */
export function openRing<T extends P2>(ring: readonly T[]): T[] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring.slice();
}

/** Close a ring (append the first point if needed). */
export function closeRing<T extends P2>(pts: readonly T[]): T[] {
  const o = openRing(pts);
  return o.length ? [...o, [o[0][0], o[0][1]] as T] : [];
}

/** Signed area (shoelace); > 0 for counter-clockwise in a right-handed (x right, y up) plane. */
export function signedArea(pts: readonly P2[]): number {
  const p = openRing(pts);
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function isCCW(pts: readonly P2[]): boolean {
  return signedArea(pts) > 0;
}

/** Same ring, counter-clockwise; keeps open/closed form. */
export function ensureCCW<T extends P2>(pts: readonly T[]): T[] {
  if (signedArea(pts) >= 0) return pts.slice();
  const closed = pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  const o = openRing(pts).reverse();
  return closed ? closeRing(o) : o;
}

export function centroid(pts: readonly P2[]): P2 {
  const p = openRing(pts);
  const A = signedArea(p);
  if (Math.abs(A) < 1e-9) {
    const sx = p.reduce((s, q) => s + q[0], 0);
    const sy = p.reduce((s, q) => s + q[1], 0);
    return [sx / p.length, sy / p.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    const f = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  return [cx / (6 * A), cy / (6 * A)];
}

/** Monotone-chain convex hull, CCW, open. */
export function convexHull(pts: readonly P2[]): P2[] {
  const p = openRing(pts)
    .map((q) => [q[0], q[1]] as P2)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export interface OrientedRect {
  centre: P2;
  /** Unit vector of the LONG axis. */
  axis: P2;
  /** Extent along `axis`. */
  length: number;
  /** Extent across. */
  width: number;
  area: number;
}

/** Minimum-area enclosing rectangle (rotating calipers over hull edges). */
export function minAreaRect(pts: readonly P2[]): OrientedRect {
  const h = convexHull(pts);
  if (h.length < 3) throw new Error('minAreaRect: need at least 3 non-collinear points');
  let best: OrientedRect | null = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const q of h) {
      const u = q[0] * ux + q[1] * uy;
      const v = -q[0] * uy + q[1] * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area - 1e-9) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const centre: P2 = [cu * ux - cv * uy, cu * uy + cv * ux];
      const lu = maxU - minU;
      const lv = maxV - minV;
      best =
        lu >= lv
          ? { centre, axis: [ux, uy], length: lu, width: lv, area }
          : { centre, axis: [-uy, ux], length: lv, width: lu, area };
    }
  }
  return best!;
}

/** Least-squares-free circle estimate: centroid + mean distance; `cv` = coefficient of variation of radii. */
export function circleEstimate(pts: readonly P2[]): { centre: P2; radius: number; cv: number } {
  const p = openRing(pts);
  const c = centroid(p);
  const r = p.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]));
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / r.length);
  return { centre: c, radius: mean, cv: mean > 0 ? sd / mean : 0 };
}

export function pointInPolygon(pt: P2, poly: readonly P2[]): boolean {
  const p = openRing(poly);
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polyline length and point/tangent at distance d along it. */
export function polylineLength(line: readonly P2[]): number {
  let L = 0;
  for (let i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return L;
}

export function pointAlong(line: readonly P2[], d: number): { p: P2; dir: P2 } {
  let rest = d;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg < 1e-12) continue;
    const dir: P2 = [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
    if (rest <= seg || i === line.length - 1) {
      const t = Math.max(0, Math.min(seg, rest));
      return { p: [a[0] + dir[0] * t, a[1] + dir[1] * t], dir };
    }
    rest -= seg;
  }
  return { p: [line[0][0], line[0][1]], dir: [1, 0] };
}

/** Deterministic PRNG (mulberry32) in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a) - for per-building seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Clamp x to [a, b]. */
export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** GLSL `smoothstep(a, b, x)`. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** GLSL `fract(x)`. */
export const fract = (x: number): number => x - Math.floor(x);

/** CPU twin of the shaders' `hash12` (Dave Hoskins, no sin: stable in float32 on the GPU), in [0, 1). */
export function hash12(x: number, y: number): number {
  let p0 = fract(x * 0.1031);
  let p1 = fract(y * 0.1031);
  let p2 = fract(x * 0.1031);
  const dd = p0 * (p1 + 33.33) + p1 * (p2 + 33.33) + p2 * (p0 + 33.33);
  p0 += dd;
  p1 += dd;
  p2 += dd;
  return fract((p0 + p1) * p2);
}
