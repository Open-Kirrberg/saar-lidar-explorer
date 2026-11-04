/**
 * Zone footprint (docs/zone-contract.md `footprint`): a simple, concave-ish outline of everything the generator models,
 * as an EPSG:25832 ring with few vertices. Pure (no three, no fs).
 *
 * Raster method, chosen over a convex hull because the castle's parts are scattered over 2 × 2.5 km (palace, gardens,
 * Karlslust, outlying farms): a convex hull would swallow the palace approach where the portal stands.
 *   1. rasterise the geometry (filled rings, lines, points) on a `cell` grid over the crop (+ padding);
 *   2. buffer by `buffer` (Euclidean distance transform);
 *   3. morphological closing with radius `close` joins neighbouring parts into one area, keeps wide bays open;
 *   4. fill holes, clip to the crop minus `inset`, remove diagonal pinches (so the outline is a simple ring);
 *   5. parts still apart (sparse outliers the closing cannot join) get straight corridors `bridge` m wide along the
 *      shortest links between them (minimum spanning tree), so the result is one area;
 *   6. trace the outer boundary (CCW) and simplify it to ≤ `maxVertices` (constrained Visvalingam–Whyatt, see
 *      simplifyInside): every geometry point inside the crop stays inside, ≥ `clearance` from the edge where the
 *      raster allowed it.
 */

export type EN = [number, number];

export interface FootprintGeom {
  /** `ring`: filled polygon; `line`: polyline; `point`: points. */
  kind: 'ring' | 'line' | 'point';
  pts: readonly EN[];
}

export interface Crop {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface FootprintOptions {
  /** Buffer around the geometry (m). */
  buffer: number;
  /** Closing radius (m): gaps narrower than ≈ 2·close between buffered parts are filled. */
  close: number;
  /** Raster cell (m); the crop edges must be multiples of it. */
  cell: number;
  /** The ring stays inside this rectangle, `inset` metres in from its edges. */
  crop: Crop;
  inset: number;
  maxVertices: number;
  /** Corridor width (m) joining parts the closing leaves apart; default 2 · buffer. */
  bridge?: number;
  /** Minimum distance kept between the geometry and a simplified edge (m); default 0.75 · buffer. */
  clearance?: number;
  /** How far the simplified ring may reach beyond the closed raster area (m); default buffer. */
  grow?: number;
}

export interface FootprintResult {
  /** CCW ring, no closing vertex, coordinates on the raster grid. */
  ring: EN[];
  /** Raster area of the closed, clipped mask (m²). */
  areaRaster: number;
  /** Smallest distance of a geometry point to the ring's edges (m), ignoring points within `buffer` of the clip edge. */
  minClearance: number;
  /** Corridors added between parts (EN of the linked cell centres). */
  bridges: [EN, EN][];
}

const INF = 1e20;

/** 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher), in place on `f` (stride access). */
function edt1d(f: Float64Array, off: number, stride: number, n: number, d: Float64Array, v: Int32Array, z: Float64Array, tmp: Float64Array): void {
  for (let i = 0; i < n; i++) tmp[i] = f[off + i * stride]!;
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (tmp[q]! + q * q - (tmp[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (tmp[q]! + q * q - (tmp[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + tmp[v[k]!]!;
  }
  for (let i = 0; i < n; i++) f[off + i * stride] = d[i]!;
}

/** Squared distance (in cells²) from every cell to the nearest cell where `seed` is true. */
export function distanceTransform(seed: Uint8Array, cols: number, rows: number): Float64Array {
  const f = new Float64Array(cols * rows);
  for (let i = 0; i < f.length; i++) f[i] = seed[i] ? 0 : INF;
  const n = Math.max(cols, rows);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const tmp = new Float64Array(n);
  for (let c = 0; c < cols; c++) edt1d(f, c, cols, rows, d, v, z, tmp);
  for (let r = 0; r < rows; r++) edt1d(f, r * cols, 1, cols, d, v, z, tmp);
  return f;
}

/** Raster grid: cell (r, c), row 0 at the north edge; corner (r, c) at E = west + c·cell, N = north − r·cell. */
interface Grid {
  west: number;
  north: number;
  cell: number;
  cols: number;
  rows: number;
}

function pointInRingEN(E: number, N: number, ring: readonly EN[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > N !== yj > N && E < ((xj - xi) * (N - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function rasterise(geoms: readonly FootprintGeom[], g: Grid): Uint8Array {
  const m = new Uint8Array(g.cols * g.rows);
  const mark = (E: number, N: number) => {
    const c = Math.floor((E - g.west) / g.cell);
    const r = Math.floor((g.north - N) / g.cell);
    if (c >= 0 && r >= 0 && c < g.cols && r < g.rows) m[r * g.cols + c] = 1;
  };
  const segment = (a: EN, b: EN) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / (g.cell / 2)));
    for (let i = 0; i <= n; i++) mark(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n);
  };
  for (const geo of geoms) {
    const p = geo.pts;
    if (geo.kind === 'point') p.forEach((q) => mark(q[0], q[1]));
    else {
      for (let i = 0; i + 1 < p.length; i++) segment(p[i]!, p[i + 1]!);
      if (p.length === 1) mark(p[0]![0], p[0]![1]);
    }
    if (geo.kind === 'ring' && p.length >= 3) {
      segment(p[p.length - 1]!, p[0]!);
      let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
      for (const [E, N] of p) {
        e0 = Math.min(e0, E); e1 = Math.max(e1, E); n0 = Math.min(n0, N); n1 = Math.max(n1, N);
      }
      const c0 = Math.max(0, Math.floor((e0 - g.west) / g.cell));
      const c1 = Math.min(g.cols - 1, Math.floor((e1 - g.west) / g.cell));
      const r0 = Math.max(0, Math.floor((g.north - n1) / g.cell));
      const r1 = Math.min(g.rows - 1, Math.floor((g.north - n0) / g.cell));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) if (pointInRingEN(g.west + (c + 0.5) * g.cell, g.north - (r + 0.5) * g.cell, p)) m[r * g.cols + c] = 1;
    }
  }
  return m;
}

/** Cells reachable from the grid border through `free` cells (4-connected). */
function floodFromBorder(free: (i: number) => boolean, cols: number, rows: number): Uint8Array {
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!seen[i] && free(i)) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let c = 0; c < cols; c++) {
    push(c);
    push((rows - 1) * cols + c);
  }
  for (let r = 0; r < rows; r++) {
    push(r * cols);
    push(r * cols + cols - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const r = Math.floor(i / cols);
    const c = i - r * cols;
    if (c > 0) push(i - 1);
    if (c < cols - 1) push(i + 1);
    if (r > 0) push(i - cols);
    if (r < rows - 1) push(i + cols);
  }
  return seen;
}

/** 4-connected component labels of `m` (0 = empty, 1…n); returns the labels and n. */
export function labelComponents(m: Uint8Array, cols: number, rows: number): { lab: Int32Array; n: number } {
  const lab = new Int32Array(m.length);
  let n = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue;
    n++;
    const stack = [s];
    lab[s] = n;
    while (stack.length) {
      const i = stack.pop()!;
      const r = Math.floor(i / cols);
      const c = i - r * cols;
      for (const j of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1]) {
        if (j >= 0 && m[j] && !lab[j]) {
          lab[j] = n;
          stack.push(j);
        }
      }
    }
  }
  return { lab, n };
}

/**
 * Join all components of `m` with straight corridors (`width` cells wide) along a minimum spanning tree of the
 * shortest cell-to-cell links between components (Kruskal). Returns the links as cell index pairs.
 */
function bridgeComponents(m: Uint8Array, cols: number, rows: number, width: number): [number, number][] {
  const { lab, n } = labelComponents(m, cols, rows);
  if (n <= 1) return [];
  const edgeCells: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < m.length; i++) {
    if (!lab[i]) continue;
    const r = Math.floor(i / cols);
    const c = i - r * cols;
    if (c === 0 || c === cols - 1 || r === 0 || r === rows - 1 || !m[i - 1] || !m[i + 1] || !m[i - cols] || !m[i + cols]) edgeCells[lab[i]!]!.push(i);
  }
  const links: { a: number; b: number; i: number; j: number; d: number }[] = [];
  for (let a = 1; a <= n; a++)
    for (let b = a + 1; b <= n; b++) {
      let best = { i: -1, j: -1, d: Infinity };
      for (const i of edgeCells[a]!) {
        const ri = Math.floor(i / cols), ci = i - ri * cols;
        for (const j of edgeCells[b]!) {
          const rj = Math.floor(j / cols), cj = j - rj * cols;
          const d = (ri - rj) ** 2 + (ci - cj) ** 2;
          if (d < best.d) best = { i, j, d };
        }
      }
      links.push({ a, b, ...best });
    }
  links.sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b);
  const par = Array.from({ length: n + 1 }, (_, k) => k);
  const find = (k: number): number => (par[k] === k ? k : (par[k] = find(par[k]!)));
  const used: [number, number][] = [];
  const half = width / 2;
  for (const l of links) {
    if (find(l.a) === find(l.b)) continue;
    par[find(l.a)] = find(l.b);
    used.push([l.i, l.j]);
    const r0 = Math.floor(l.i / cols), c0 = l.i - r0 * cols, r1 = Math.floor(l.j / cols), c1 = l.j - r1 * cols;
    const rr0 = Math.max(0, Math.floor(Math.min(r0, r1) - half - 1)), rr1 = Math.min(rows - 1, Math.ceil(Math.max(r0, r1) + half + 1));
    const cc0 = Math.max(0, Math.floor(Math.min(c0, c1) - half - 1)), cc1 = Math.min(cols - 1, Math.ceil(Math.max(c0, c1) + half + 1));
    for (let r = rr0; r <= rr1; r++)
      for (let c = cc0; c <= cc1; c++) if (segDist([c, r], [c0, r0], [c1, r1]) <= half) m[r * cols + c] = 1;
  }
  return used;
}

/** Fill holes and diagonal-only contacts until stable, so the outer boundary of each component is a simple ring. */
function solidify(m: Uint8Array, cols: number, rows: number): void {
  for (let pass = 0; pass < 100; pass++) {
    const outside = floodFromBorder((i) => !m[i], cols, rows);
    for (let i = 0; i < m.length; i++) if (!m[i] && !outside[i]) m[i] = 1;
    let changed = false;
    for (let r = 0; r + 1 < rows; r++)
      for (let c = 0; c + 1 < cols; c++) {
        const i = r * cols + c;
        const a = m[i], b = m[i + 1], d = m[i + cols], e = m[i + cols + 1];
        if (a && e && !b && !d) {
          m[i + 1] = 1;
          changed = true;
        } else if (b && d && !a && !e) {
          m[i] = 1;
          changed = true;
        }
      }
    if (!changed) return;
  }
  throw new Error('footprint: solidify did not converge');
}

/** Outer boundary of a single solid component as a CCW ring of grid corners (EN), collinear vertices dropped. */
function traceBoundary(m: Uint8Array, g: Grid): EN[] {
  const { cols, rows } = g;
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols && m[r * cols + c] === 1;
  // directed edges between corners (cr, cc) with the inside on the left (EN, N up = row decreasing)
  const next = new Map<number, number>();
  const key = (r: number, c: number) => r * (cols + 1) + c;
  const add = (r0: number, c0: number, r1: number, c1: number) => {
    const k = key(r0, c0);
    if (next.has(k)) throw new Error('footprint: boundary vertex with two exits (pinch)');
    next.set(k, key(r1, c1));
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!inside(r, c)) continue;
      // corners: NW (r, c), NE (r, c+1), SE (r+1, c+1), SW (r+1, c); CCW in EN = NW → SW → SE → NE
      if (!inside(r, c - 1)) add(r, c, r + 1, c); // west side, going south
      if (!inside(r + 1, c)) add(r + 1, c, r + 1, c + 1); // south side, going east
      if (!inside(r, c + 1)) add(r + 1, c + 1, r, c + 1); // east side, going north
      if (!inside(r - 1, c)) add(r, c + 1, r, c); // north side, going west
    }
  if (!next.size) return [];
  const start = Math.min(...next.keys());
  const ringKeys: number[] = [];
  let k = start;
  do {
    ringKeys.push(k);
    k = next.get(k)!;
    if (ringKeys.length > next.size) throw new Error('footprint: boundary does not close');
  } while (k !== start);
  if (ringKeys.length !== next.size) throw new Error(`footprint: ${next.size - ringKeys.length} boundary edges outside the outer ring`);
  const pts: EN[] = ringKeys.map((kk) => {
    const r = Math.floor(kk / (cols + 1));
    const c = kk - r * (cols + 1);
    return [g.west + c * g.cell, g.north - r * g.cell];
  });
  return dropCollinear(pts);
}

function dropCollinear(p: EN[]): EN[] {
  const out: EN[] = [];
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n]!, b = p[i]!, c = p[(i + 1) % n]!;
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}

function segDist(p: EN, a: EN, b: EN): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

const cross3 = (a: EN, b: EN, c: EN): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function inTriangle(p: EN, a: EN, b: EN, c: EN): boolean {
  const d1 = cross3(a, b, p), d2 = cross3(b, c, p), d3 = cross3(c, a, p);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function segmentsTouch(p1: EN, p2: EN, q1: EN, q2: EN): boolean {
  const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2), o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSeg(p1, p2, q1)) || (o2 === 0 && onSeg(p1, p2, q2)) || (o3 === 0 && onSeg(q1, q2, p1)) || (o4 === 0 && onSeg(q1, q2, p2));
}

/**
 * Visvalingam–Whyatt down to `maxVertices`, constrained: the ring stays simple; a vertex is only cut off (convex
 * corner, area removed) if no probe falls into the removed triangle and the new edge comes no closer than `clearance`
 * to any probe (unless it is no closer than the two edges it replaces); a bay vertex (reflex corner, area added) is
 * only removed if `canAdd(a, b, c)` accepts the added triangle (e.g. it stays near the raster). CCW input; returns
 * null if the budget cannot be met.
 */
export function simplifyInside(
  ring: readonly EN[],
  probes: readonly EN[],
  maxVertices: number,
  clearance: number,
  canAdd: (a: EN, b: EN, c: EN) => boolean = () => true,
): EN[] | null {
  const n = ring.length;
  if (n <= maxVertices) return ring.slice();
  const prev = Int32Array.from({ length: n }, (_, i) => (i - 1 + n) % n);
  const next = Int32Array.from({ length: n }, (_, i) => (i + 1) % n);
  const alive = new Uint8Array(n).fill(1);
  let count = n;
  let head = 0;
  const allowed = (i: number): boolean => {
    const ia = prev[i]!, ic = next[i]!;
    const a = ring[ia]!, b = ring[i]!, c = ring[ic]!;
    // new edge a–c must not touch any other edge
    for (let j = next[ic]!; j !== prev[ia]!; j = next[j]!) if (segmentsTouch(a, c, ring[j]!, ring[next[j]!]!)) return false;
    const before = ring[prev[ia]!]!, after = ring[next[ic]!]!;
    if ((orient(a, c, before) === 0 && onSeg(a, c, before)) || (orient(a, c, after) === 0 && onSeg(a, c, after))) return false;
    const turn = cross3(a, b, c);
    if (turn === 0) return true;
    if (turn < 0) return canAdd(a, b, c); // reflex: the triangle is added to the area
    const e0 = Math.min(a[0], b[0], c[0]) - clearance, e1 = Math.max(a[0], b[0], c[0]) + clearance;
    const n0 = Math.min(a[1], b[1], c[1]) - clearance, n1 = Math.max(a[1], b[1], c[1]) + clearance;
    for (const p of probes) {
      if (p[0] < e0 || p[0] > e1 || p[1] < n0 || p[1] > n1) continue;
      if (inTriangle(p, a, b, c)) return false;
      const d = segDist(p, a, c);
      if (d < clearance && d < Math.min(segDist(p, a, b), segDist(p, b, c))) return false;
    }
    return true;
  };
  while (count > maxVertices) {
    const cand: [number, number][] = [];
    let i = head;
    do {
      cand.push([Math.abs(cross3(ring[prev[i]!]!, ring[i]!, ring[next[i]!]!)), i]);
      i = next[i]!;
    } while (i !== head);
    cand.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const pick = cand.find(([, k]) => allowed(k));
    if (!pick) return null;
    const k = pick[1];
    alive[k] = 0;
    next[prev[k]!] = next[k]!;
    prev[next[k]!] = prev[k]!;
    if (head === k) head = next[k]!;
    count--;
  }
  const out: EN[] = [];
  for (let i = 0; i < n; i++) if (alive[i]) out.push(ring[i]!);
  return out;
}

/** Points along every geometry (vertices + every ≤ `step` m along lines and ring edges) inside the crop minus `inset`. */
export function geometryProbes(geoms: readonly FootprintGeom[], step: number, crop: Crop, inset: number): EN[] {
  const out: EN[] = [];
  const add = (p: EN) => {
    if (inCrop(p, crop, inset)) out.push(p);
  };
  for (const g of geoms) {
    const p = g.pts;
    if (g.kind === 'point') {
      p.forEach((q) => add([q[0], q[1]]));
      continue;
    }
    const segs = g.kind === 'ring' && p.length >= 3 ? p.length : p.length - 1;
    if (p.length === 1) add([p[0]![0], p[0]![1]]);
    for (let i = 0; i < segs; i++) {
      const a = p[i]!, b = p[(i + 1) % p.length]!;
      const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 0; j < k; j++) add([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
      if (g.kind === 'line' && i === segs - 1) add([b[0], b[1]]);
    }
  }
  return out;
}

export function signedArea(ring: readonly EN[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

const orient = (a: EN, b: EN, c: EN): number => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const onSeg = (a: EN, b: EN, p: EN): boolean =>
  Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

/** Same rule as app/src/zones/geometry.ts ringIsSimple: no two non-adjacent edges touch. */
export function ringIsSimple(ring: readonly EN[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const p1 = ring[i]!, p2 = ring[(i + 1) % n]!, q1 = ring[j]!, q2 = ring[(j + 1) % n]!;
      const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2), o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
      if (o1 !== o2 && o3 !== o4) return false;
      if ((o1 === 0 && onSeg(p1, p2, q1)) || (o2 === 0 && onSeg(p1, p2, q2)) || (o3 === 0 && onSeg(q1, q2, p1)) || (o4 === 0 && onSeg(q1, q2, p2))) return false;
    }
  return true;
}

export const pointInRing = (p: EN, ring: readonly EN[]): boolean => pointInRingEN(p[0], p[1], ring);

/** Distance from a point to the ring's edges. */
export function distToRing(p: EN, ring: readonly EN[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, segDist(p, ring[i]!, ring[(i + 1) % ring.length]!));
  return d;
}

const inCrop = (p: EN, c: Crop, inset = 0): boolean => p[0] >= c.west + inset && p[0] <= c.east - inset && p[1] >= c.south + inset && p[1] <= c.north - inset;
export { inCrop };

/** The footprint ring of `geoms` (see the module comment). Throws if the parts do not join into one area. */
export function zoneFootprint(geoms: readonly FootprintGeom[], o: FootprintOptions): FootprintResult {
  const { cell, crop } = o;
  for (const v of [crop.west, crop.east, crop.south, crop.north, o.inset]) {
    if (Math.abs(v / cell - Math.round(v / cell)) > 1e-9) throw new Error(`footprint: crop edge / inset ${v} is not a multiple of the cell ${cell}`);
  }
  const pad = Math.ceil((o.buffer + o.close) / cell) + 2;
  const g: Grid = {
    west: crop.west - pad * cell,
    north: crop.north + pad * cell,
    cell,
    cols: Math.round((crop.east - crop.west) / cell) + 2 * pad,
    rows: Math.round((crop.north - crop.south) / cell) + 2 * pad,
  };
  const { cols, rows } = g;
  const seed = rasterise(geoms, g);
  const b2 = (o.buffer / cell) ** 2;
  const c2 = (o.close / cell) ** 2;
  const d0 = distanceTransform(seed, cols, rows);
  const buffered = new Uint8Array(seed.length);
  for (let i = 0; i < seed.length; i++) buffered[i] = d0[i]! <= b2 ? 1 : 0;
  const d1 = distanceTransform(buffered, cols, rows);
  const outsideDilated = new Uint8Array(seed.length);
  for (let i = 0; i < seed.length; i++) outsideDilated[i] = d1[i]! <= c2 ? 0 : 1;
  const d2 = distanceTransform(outsideDilated, cols, rows);
  const m = new Uint8Array(seed.length);
  for (let i = 0; i < seed.length; i++) m[i] = buffered[i] || d2[i]! > c2 ? 1 : 0;
  // clip to the crop minus the inset (cells fully inside)
  const k0 = Math.round(o.inset / cell);
  const clip = () => {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) if (r < pad + k0 || r >= rows - pad - k0 || c < pad + k0 || c >= cols - pad - k0) m[r * cols + c] = 0;
  };
  clip();
  solidify(m, cols, rows);
  const links = bridgeComponents(m, cols, rows, (o.bridge ?? 2 * o.buffer) / cell);
  if (links.length) {
    clip();
    solidify(m, cols, rows);
  }
  const comps = labelComponents(m, cols, rows).n;
  if (comps !== 1) throw new Error(`footprint: ${comps} separate areas after bridging`);
  const centre = (i: number): EN => {
    const r = Math.floor(i / cols);
    return [g.west + (i - r * cols + 0.5) * cell, g.north - (r + 0.5) * cell];
  };
  const bridges = links.map(([i, j]): [EN, EN] => [centre(i), centre(j)]);
  let areaRaster = 0;
  for (let i = 0; i < m.length; i++) areaRaster += m[i]!;
  areaRaster *= cell * cell;
  const full = traceBoundary(m, g);
  if (signedArea(full) <= 0) throw new Error('footprint: traced ring is not CCW');
  const probes = geometryProbes(geoms, cell, crop, o.inset);
  const clearance = o.clearance ?? 0.75 * o.buffer;
  // bays may only be filled where the added triangle stays within `grow` of the closed raster area
  const dOut = distanceTransform(m, cols, rows);
  const g2 = ((o.grow ?? o.buffer) / cell) ** 2;
  const canAdd = (a: EN, b: EN, c: EN): boolean => {
    const c0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - g.west) / cell));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(a[0], b[0], c[0]) - g.west) / cell));
    const r0 = Math.max(0, Math.floor((g.north - Math.max(a[1], b[1], c[1])) / cell));
    const r1 = Math.min(rows - 1, Math.floor((g.north - Math.min(a[1], b[1], c[1])) / cell));
    for (let r = r0; r <= r1; r++)
      for (let k = c0; k <= c1; k++) {
        const i = r * cols + k;
        if (dOut[i]! > g2 && inTriangle([g.west + (k + 0.5) * cell, g.north - (r + 0.5) * cell], a, b, c)) return false;
      }
    return true;
  };
  const ring = simplifyInside(full, probes, o.maxVertices, clearance, canAdd);
  if (!ring) throw new Error(`footprint: cannot reach ${o.maxVertices} vertices with ${clearance} m clearance and ${o.grow ?? o.buffer} m growth`);
  if (!ringIsSimple(ring) || signedArea(ring) <= 0) throw new Error('footprint: simplified ring is not simple / CCW');
  const outside = probes.filter((p) => !pointInRing(p, ring)).length;
  if (outside) throw new Error(`footprint: ${outside} geometry points outside the simplified ring`);
  let minClearance = Infinity;
  for (const p of probes) if (inCrop(p, crop, o.inset + o.buffer)) minClearance = Math.min(minClearance, distToRing(p, ring));
  return { ring, areaRaster, minClearance, bridges };
}
