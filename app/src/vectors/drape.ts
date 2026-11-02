/**
 * Pure draping math for vector layers (F10 OSM ways, F12 Flurstücke): GeoJSON in EPSG:25832
 * → local world frame (float64 subtraction, then float32) → per-segment buffers with the TRUE
 * terrain height per vertex. Exaggeration is applied later in the vertex shader
 * (`y = hRef + (h − hRef) · exag`), so the slider never detaches lines from the ground.
 *
 * No three.js / DOM imports — unit-tested in tests/vectors.test.ts.
 */

export interface Origin {
  E0: number;
  N0: number;
}

/** Local world frame: x = E − E0, z = −(N − N0) (float64 in, float64 out). */
export function toLocal(E: number, N: number, o: Origin): { x: number; z: number } {
  return { x: E - o.E0, z: -(N - o.N0) };
}

/**
 * Insert vertices so that no segment is longer than `maxSeg` (flat array [x0, z0, x1, z1, …]).
 * Already-dense input is returned unchanged in content (a copy).
 */
export function densifyLine(xz: ArrayLike<number>, maxSeg: number): number[] {
  const n = Math.floor(xz.length / 2);
  const out: number[] = [];
  if (n === 0) return out;
  out.push(xz[0], xz[1]);
  for (let i = 1; i < n; i++) {
    const x0 = xz[2 * i - 2];
    const z0 = xz[2 * i - 1];
    const x1 = xz[2 * i];
    const z1 = xz[2 * i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const k = maxSeg > 0 ? Math.max(1, Math.ceil(len / maxSeg - 1e-9)) : 1;
    for (let s = 1; s < k; s++) {
      const t = s / k;
      out.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    }
    out.push(x1, z1);
  }
  return out;
}

/**
 * Like `densifyLine`, plus a per-vertex height array `h` (baked z, NaN = unknown) interpolated
 * linearly at inserted vertices (NaN if either end is unknown).
 */
export function densifyLineH(xz: ArrayLike<number>, h: ArrayLike<number>, maxSeg: number): { xz: number[]; h: number[] } {
  const n = Math.floor(xz.length / 2);
  const out: number[] = [];
  const oh: number[] = [];
  if (n === 0) return { xz: out, h: oh };
  out.push(xz[0], xz[1]);
  oh.push(h[0]);
  for (let i = 1; i < n; i++) {
    const x0 = xz[2 * i - 2];
    const z0 = xz[2 * i - 1];
    const x1 = xz[2 * i];
    const z1 = xz[2 * i + 1];
    const h0 = h[i - 1];
    const h1 = h[i];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const k = maxSeg > 0 ? Math.max(1, Math.ceil(len / maxSeg - 1e-9)) : 1;
    for (let s = 1; s < k; s++) {
      const t = s / k;
      out.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      oh.push(h0 + (h1 - h0) * t); // NaN propagates
    }
    out.push(x1, z1);
    oh.push(h1);
  }
  return { xz: out, h: oh };
}

/** Polyline in the local frame with a style index (see styles.ts). */
export interface LocalLine {
  xz: Float64Array; // [x0, z0, x1, z1, …]
  style: number;
  /**
   * Baked TRUE heights per vertex (contract `heights: 'baked'`, z of [E, N, z]); NaN where a
   * coordinate had no finite z. Absent when no coordinate of the line had one.
   */
  h?: Float64Array;
}

type Position = number[];
interface GeoJsonGeometry {
  type: string;
  coordinates?: unknown;
}
interface GeoJsonFeature {
  type?: string;
  geometry?: GeoJsonGeometry | null;
  properties?: Record<string, unknown> | null;
}

function isPos(p: unknown): p is Position {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** LineString / MultiLineString / (Multi)Polygon rings → arrays of positions. Others → []. */
export function lineParts(g: GeoJsonGeometry | null | undefined): Position[][] {
  if (!g || !Array.isArray(g.coordinates)) return [];
  const c = g.coordinates as unknown[];
  switch (g.type) {
    case 'LineString':
      return [c as Position[]];
    case 'MultiLineString':
    case 'Polygon':
      return c as Position[][];
    case 'MultiPolygon':
      return (c as Position[][][]).flat();
    default:
      return [];
  }
}

/**
 * Extract lines from a FeatureCollection, convert to the local frame and densify to ≤ `maxSeg`.
 * `styleOf` maps feature properties to a style index (return < 0 to skip the feature).
 */
export function extractLines(
  fc: unknown,
  origin: Origin,
  styleOf: (props: Record<string, unknown>) => number,
  maxSeg = 2,
): LocalLine[] {
  const feats = (fc as { features?: unknown })?.features;
  if (!Array.isArray(feats)) return [];
  const out: LocalLine[] = [];
  for (const f of feats as GeoJsonFeature[]) {
    if (!f || typeof f !== 'object') continue;
    const style = styleOf(f.properties ?? {});
    if (style < 0) continue;
    for (const part of lineParts(f.geometry)) {
      if (!Array.isArray(part)) continue;
      const flat: number[] = [];
      const hs: number[] = [];
      let anyZ = false;
      for (const p of part) {
        if (!isPos(p)) continue;
        const { x, z } = toLocal(p[0], p[1], origin);
        flat.push(x, z);
        const h = p.length >= 3 && Number.isFinite(p[2]) ? (p[2] as number) : NaN;
        if (!Number.isNaN(h)) anyZ = true;
        hs.push(h);
      }
      if (flat.length < 4) continue;
      if (anyZ) {
        const d = densifyLineH(flat, hs, maxSeg);
        out.push({ xz: Float64Array.from(d.xz), style, h: Float64Array.from(d.h) });
      } else {
        out.push({ xz: Float64Array.from(densifyLine(flat, maxSeg)), style });
      }
    }
  }
  return out;
}

/** Floats per segment instance: start (x, h, z), end (x, h, z), style. */
export const SEG_STRIDE = 7;

/** Segments of one spatial bucket (one terrain chunk, keyed by segment midpoint). */
export interface SegmentBucket {
  key: string; // "i_j"
  i: number;
  j: number;
  /** [x0, h0, z0, x1, h1, z1, style] × count, local frame, TRUE heights. */
  data: Float32Array;
  count: number;
  /** Bounds (local frame, true heights) — hMin/hMax over valid samples. */
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  hMin: number;
  hMax: number;
  /** Vertices whose height was unknown (chunk not loaded) — re-sample later. */
  missing: number;
  /**
   * Per segment end (2 × count): 1 = baked height from the file (never re-sampled), 0 = sampled
   * from the terrain. Absent when nothing in the bucket is baked.
   */
  fixed?: Uint8Array;
  /** Number of segment ends sampled from the terrain (0 → fully baked, never re-sampled). */
  sampled: number;
}

export type HeightFn = (x: number, z: number) => number;

/**
 * Split lines into segments, bucket them by `bucketSize` cells (local frame, midpoint) and take
 * the true terrain height at each vertex: the baked `line.h` where finite, else `heightAt`.
 * Unknown heights (NaN) are replaced by `fallbackH` and counted in `missing` so the caller can
 * `resampleBucket` once the terrain chunk arrives.
 */
export function buildBuckets(
  lines: LocalLine[],
  heightAt: HeightFn,
  bucketSize: number,
  fallbackH: number,
): SegmentBucket[] {
  // Pass 1: count per bucket.
  const counts = new Map<string, number>();
  const bakedIn = new Set<string>();
  const keyOf = (x: number, z: number) => {
    const i = Math.floor(x / bucketSize);
    const j = Math.floor(-z / bucketSize); // row index from the AOI's N0 edge (z ≤ 0 inside)
    return `${i}_${j}`;
  };
  for (const l of lines) {
    const n = l.xz.length / 2;
    for (let k = 0; k + 1 < n; k++) {
      const key = keyOf((l.xz[2 * k] + l.xz[2 * k + 2]) / 2, (l.xz[2 * k + 1] + l.xz[2 * k + 3]) / 2);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (l.h) bakedIn.add(key);
    }
  }
  const buckets = new Map<string, SegmentBucket>();
  for (const [key, count] of counts) {
    const [i, j] = key.split('_').map(Number);
    buckets.set(key, {
      key,
      i,
      j,
      data: new Float32Array(count * SEG_STRIDE),
      count: 0,
      xMin: Infinity,
      xMax: -Infinity,
      zMin: Infinity,
      zMax: -Infinity,
      hMin: Infinity,
      hMax: -Infinity,
      missing: 0,
      sampled: 0,
      ...(bakedIn.has(key) ? { fixed: new Uint8Array(count * 2) } : {}),
    });
  }
  // Pass 2: fill. Heights are sampled once per line vertex and shared by both adjacent segments.
  for (const l of lines) {
    const n = l.xz.length / 2;
    const bh = l.h;
    const isBaked = (k: number) => bh !== undefined && Number.isFinite(bh[k]);
    const hOf = (k: number) => (isBaked(k) ? bh![k] : heightAt(l.xz[2 * k], l.xz[2 * k + 1]));
    let hPrev = hOf(0);
    for (let k = 0; k + 1 < n; k++) {
      const x0 = l.xz[2 * k];
      const z0 = l.xz[2 * k + 1];
      const x1 = l.xz[2 * k + 2];
      const z1 = l.xz[2 * k + 3];
      const h1 = hOf(k + 1);
      const b = buckets.get(keyOf((x0 + x1) / 2, (z0 + z1) / 2))!;
      const f0 = isBaked(k);
      const f1 = isBaked(k + 1);
      if (b.fixed) {
        b.fixed[2 * b.count] = f0 ? 1 : 0;
        b.fixed[2 * b.count + 1] = f1 ? 1 : 0;
      }
      b.sampled += (f0 ? 0 : 1) + (f1 ? 0 : 1);
      const o = b.count * SEG_STRIDE;
      b.data[o] = x0;
      b.data[o + 2] = z0;
      b.data[o + 3] = x1;
      b.data[o + 5] = z1;
      b.data[o + 6] = l.style;
      b.count++;
      b.xMin = Math.min(b.xMin, x0, x1);
      b.xMax = Math.max(b.xMax, x0, x1);
      b.zMin = Math.min(b.zMin, z0, z1);
      b.zMax = Math.max(b.zMax, z0, z1);
      setHeights(b, o, hPrev, h1, fallbackH);
      hPrev = h1;
    }
  }
  return [...buckets.values()];
}

function setHeights(b: SegmentBucket, o: number, h0: number, h1: number, fallbackH: number): void {
  for (const [off, h] of [
    [1, h0],
    [4, h1],
  ] as const) {
    if (Number.isFinite(h)) {
      b.data[o + off] = h;
      if (h < b.hMin) b.hMin = h;
      if (h > b.hMax) b.hMax = h;
    } else {
      b.data[o + off] = fallbackH;
      b.missing++;
    }
  }
}

/**
 * Re-sample the terrain-sampled heights of a bucket (e.g. after its terrain chunk loaded or a
 * finer level arrived); baked heights (`fixed`) are kept. Returns `missing`.
 */
export function resampleBucket(b: SegmentBucket, heightAt: HeightFn, fallbackH: number): number {
  b.missing = 0;
  b.hMin = Infinity;
  b.hMax = -Infinity;
  const f = b.fixed;
  for (let s = 0; s < b.count; s++) {
    const o = s * SEG_STRIDE;
    const h0 = f && f[2 * s] ? b.data[o + 1] : heightAt(b.data[o], b.data[o + 2]);
    const h1 = f && f[2 * s + 1] ? b.data[o + 4] : heightAt(b.data[o + 3], b.data[o + 5]);
    setHeights(b, o, h0, h1, fallbackH);
  }
  return b.missing;
}

/** Squared horizontal distance from (x, z) to a bucket's bounding rectangle (0 inside). */
export function bucketDist2(b: Pick<SegmentBucket, 'xMin' | 'xMax' | 'zMin' | 'zMax'>, x: number, z: number): number {
  const dx = x < b.xMin ? b.xMin - x : x > b.xMax ? x - b.xMax : 0;
  const dz = z < b.zMin ? b.zMin - z : z > b.zMax ? z - b.zMax : 0;
  return dx * dx + dz * dz;
}

/** Displayed height with the shared exaggeration formula (same as the terrain vertex shader). */
export function displayY(h: number, hRef: number, exag: number): number {
  return hRef + (h - hRef) * exag;
}
