/**
 * Pure spatial helpers for vector layers: a uniform-grid point index (label LOD: nearest N
 * Flurnummern around the camera) and a segment index (local parcel lookup: "does the straight
 * line from the query point to a label point cross a parcel boundary?").
 * Coordinates are the local world frame (x, z), but nothing here depends on that.
 */

const cellKey = (cx: number, cz: number) => `${cx},${cz}`;

/** Uniform grid over points; `nearest` returns indices sorted by distance. */
export class PointIndex {
  private readonly cells = new Map<string, number[]>();

  constructor(
    readonly xs: Float64Array,
    readonly zs: Float64Array,
    readonly cellSize = 100,
  ) {
    for (let k = 0; k < xs.length; k++) {
      const key = cellKey(Math.floor(xs[k] / cellSize), Math.floor(zs[k] / cellSize));
      let c = this.cells.get(key);
      if (!c) this.cells.set(key, (c = []));
      c.push(k);
    }
  }

  get size(): number {
    return this.xs.length;
  }

  /**
   * Indices of points within `radius` of (x, z), nearest first, at most `max`.
   * `accept` can reject points (e.g. outside the view frustum) before the count limit applies.
   */
  nearest(x: number, z: number, radius: number, max = Infinity, accept?: (k: number) => boolean): number[] {
    const cs = this.cellSize;
    const r2 = radius * radius;
    const hits: Array<[number, number]> = [];
    const cx0 = Math.floor((x - radius) / cs);
    const cx1 = Math.floor((x + radius) / cs);
    const cz0 = Math.floor((z - radius) / cs);
    const cz1 = Math.floor((z + radius) / cs);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const c = this.cells.get(cellKey(cx, cz));
        if (!c) continue;
        for (const k of c) {
          const d2 = (this.xs[k] - x) ** 2 + (this.zs[k] - z) ** 2;
          if (d2 <= r2) hits.push([d2, k]);
        }
      }
    }
    hits.sort((a, b) => a[0] - b[0]);
    const out: number[] = [];
    for (const [, k] of hits) {
      if (out.length >= max) break;
      if (!accept || accept(k)) out.push(k);
    }
    return out;
  }

  /**
   * Like `nearest`, but by 3D distance from (x, y, z): point heights come from `yOf(k)` (only
   * evaluated for points inside the horizontal radius; non-finite heights are dropped). A camera
   * high above the ground therefore gets few or no points even though many lie below it.
   */
  nearest3d(
    x: number,
    y: number,
    z: number,
    radius: number,
    yOf: (k: number) => number,
    max = Infinity,
    accept?: (k: number) => boolean,
  ): number[] {
    const r2 = radius * radius;
    const hits: Array<[number, number]> = [];
    for (const k of this.nearest(x, z, radius)) {
      const py = yOf(k);
      if (!Number.isFinite(py)) continue;
      const d2 = (this.xs[k] - x) ** 2 + (py - y) ** 2 + (this.zs[k] - z) ** 2;
      if (d2 <= r2) hits.push([d2, k]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    const out: number[] = [];
    for (const [, k] of hits) {
      if (out.length >= max) break;
      if (!accept || accept(k)) out.push(k);
    }
    return out;
  }
}

/** Do segments AB and CD properly intersect (touching endpoints count as crossing)? */
export function segmentsIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az);
  const d2 = o(cx, cz, dx, dz, bx, bz);
  const d3 = o(ax, az, bx, bz, cx, cz);
  const d4 = o(ax, az, bx, bz, dx, dz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const onSeg = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
    Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(pz, qz) <= rz && rz <= Math.max(pz, qz);
  return (
    (d1 === 0 && onSeg(cx, cz, dx, dz, ax, az)) ||
    (d2 === 0 && onSeg(cx, cz, dx, dz, bx, bz)) ||
    (d3 === 0 && onSeg(ax, az, bx, bz, cx, cz)) ||
    (d4 === 0 && onSeg(ax, az, bx, bz, dx, dz))
  );
}

/** Uniform grid over line segments [x0, z0, x1, z1] (each registered in every cell its bbox touches). */
export class SegmentIndex {
  private readonly cells = new Map<string, number[]>();
  readonly segs: Float64Array;

  /** `polylines` = flat [x0, z0, x1, z1, …] lines, or one packed Float64Array of segments (4 per segment). */
  constructor(polylines: ArrayLike<number>[] | Float64Array, readonly cellSize = 25) {
    if (polylines instanceof Float64Array) {
      this.segs = polylines;
      this.indexAll();
      return;
    }
    let n = 0;
    for (const p of polylines) n += Math.max(0, p.length / 2 - 1);
    this.segs = new Float64Array(n * 4);
    let s = 0;
    for (const p of polylines) {
      for (let k = 0; k + 3 < p.length; k += 2) {
        const o = s * 4;
        this.segs[o] = p[k];
        this.segs[o + 1] = p[k + 1];
        this.segs[o + 2] = p[k + 2];
        this.segs[o + 3] = p[k + 3];
        s++;
      }
    }
    this.indexAll();
  }

  /**
   * From segment records with a stride (e.g. draped-line bucket data [x0, h0, z0, x1, h1, z1, style]):
   * x0/z0/x1/z1 are read at offsets `at` = [0, 2, 3, 5] by default.
   */
  static fromRecords(
    records: Array<{ data: ArrayLike<number>; count: number }>,
    stride: number,
    cellSize = 25,
    at: [number, number, number, number] = [0, 2, 3, 5],
  ): SegmentIndex {
    let n = 0;
    for (const r of records) n += r.count;
    const segs = new Float64Array(n * 4);
    let s = 0;
    for (const r of records) {
      for (let k = 0; k < r.count; k++, s++) {
        const o = k * stride;
        segs[s * 4] = r.data[o + at[0]];
        segs[s * 4 + 1] = r.data[o + at[1]];
        segs[s * 4 + 2] = r.data[o + at[2]];
        segs[s * 4 + 3] = r.data[o + at[3]];
      }
    }
    return new SegmentIndex(segs, cellSize);
  }

  private indexAll(): void {
    const g = this.segs;
    for (let s = 0; s < g.length / 4; s++) {
      const o = s * 4;
      this.forCells(g[o], g[o + 1], g[o + 2], g[o + 3], (key) => {
        let c = this.cells.get(key);
        if (!c) this.cells.set(key, (c = []));
        c.push(s);
      });
    }
  }

  get size(): number {
    return this.segs.length / 4;
  }

  private forCells(x0: number, z0: number, x1: number, z1: number, fn: (key: string) => void): void {
    const cs = this.cellSize;
    const ax = Math.floor(Math.min(x0, x1) / cs);
    const bx = Math.floor(Math.max(x0, x1) / cs);
    const az = Math.floor(Math.min(z0, z1) / cs);
    const bz = Math.floor(Math.max(z0, z1) / cs);
    for (let cx = ax; cx <= bx; cx++) for (let cz = az; cz <= bz; cz++) fn(cellKey(cx, cz));
  }

  /** Does the segment (x0, z0)–(x1, z1) cross any indexed segment? */
  crosses(x0: number, z0: number, x1: number, z1: number): boolean {
    const seen = new Set<number>();
    let hit = false;
    this.forCells(x0, z0, x1, z1, (key) => {
      if (hit) return;
      for (const s of this.cells.get(key) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        const o = s * 4;
        const g = this.segs;
        if (segmentsIntersect(x0, z0, x1, z1, g[o], g[o + 1], g[o + 2], g[o + 3])) {
          hit = true;
          return;
        }
      }
    });
    return hit;
  }
}

/**
 * Local parcel lookup: the nearest label point within `maxDist` that is reachable from (x, z)
 * without crossing a parcel boundary (so it lies in the same parcel). Returns its index or -1.
 */
export function findParcelLabel(
  x: number,
  z: number,
  labels: PointIndex,
  boundaries: SegmentIndex,
  maxDist = 60,
): number {
  for (const k of labels.nearest(x, z, maxDist, 12)) {
    if (!boundaries.crosses(x, z, labels.xs[k], labels.zs[k])) return k;
  }
  return -1;
}

/** Screen-space label box, centred at (x, y), in CSS px. */
export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Greedy label decluttering: boxes are taken in priority order (e.g. nearest first); a box is
 * kept unless it overlaps (with `pad` px margin) a box kept before it. Returns a keep flag per box.
 * Uniform grid (`cell` px) over kept boxes → ~O(n) for typical label counts.
 */
export function declutter(boxes: ScreenBox[], pad = 2, cell = 64): boolean[] {
  const keep = new Array<boolean>(boxes.length).fill(false);
  const grid = new Map<string, number[]>();
  const range = (b: ScreenBox) => ({
    x0: Math.floor((b.x - b.w / 2 - pad) / cell),
    x1: Math.floor((b.x + b.w / 2 + pad) / cell),
    y0: Math.floor((b.y - b.h / 2 - pad) / cell),
    y1: Math.floor((b.y + b.h / 2 + pad) / cell),
  });
  const overlaps = (a: ScreenBox, b: ScreenBox) =>
    Math.abs(a.x - b.x) * 2 < a.w + b.w + 2 * pad && Math.abs(a.y - b.y) * 2 < a.h + b.h + 2 * pad;
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k];
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const r = range(b);
    let hit = false;
    for (let cx = r.x0; cx <= r.x1 && !hit; cx++) {
      for (let cy = r.y0; cy <= r.y1 && !hit; cy++) {
        for (const o of grid.get(cellKey(cx, cy)) ?? []) {
          if (overlaps(b, boxes[o])) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) continue;
    keep[k] = true;
    for (let cx = r.x0; cx <= r.x1; cx++) {
      for (let cy = r.y0; cy <= r.y1; cy++) {
        const key = cellKey(cx, cy);
        let c = grid.get(key);
        if (!c) grid.set(key, (c = []));
        c.push(k);
      }
    }
  }
  return keep;
}
