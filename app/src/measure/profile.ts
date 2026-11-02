/**
 * Pure profile sampling + statistics (F17) — no three.js / DOM.
 *
 * A polyline (local world frame x/z or UTM, any planar metres) is sampled so that every vertex is
 * a sample and each segment is split into equal parts no longer than `step` (default 0.5 m, i.e.
 * two samples per 1 m DTM cell). Heights come from a callback (true heights, no exaggeration).
 */

export interface XZ {
  x: number;
  z: number;
}

export interface PolylineSamples {
  /** Cumulative horizontal distance from the start (m). */
  d: Float64Array;
  x: Float64Array;
  z: Float64Array;
  /** Index of the sample at each input vertex. */
  vertexIndex: number[];
}

/** Sample a polyline every ≤ `step` metres (vertices included exactly). */
export function samplePolyline(pts: readonly XZ[], step = 0.5): PolylineSamples {
  if (!(step > 0)) throw new Error('samplePolyline: step must be > 0');
  const parts: number[] = [];
  let total = 1;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const k = Math.max(1, Math.ceil(len / step - 1e-9));
    parts.push(k);
    total += k;
  }
  if (pts.length === 0) return { d: new Float64Array(0), x: new Float64Array(0), z: new Float64Array(0), vertexIndex: [] };
  const d = new Float64Array(total);
  const x = new Float64Array(total);
  const z = new Float64Array(total);
  const vertexIndex = [0];
  x[0] = pts[0].x;
  z[0] = pts[0].z;
  let o = 1;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const k = parts[i - 1];
    for (let s = 1; s <= k; s++) {
      const t = s / k;
      x[o] = s === k ? b.x : a.x + (b.x - a.x) * t;
      z[o] = s === k ? b.z : a.z + (b.z - a.z) * t;
      d[o] = acc + len * t;
      o++;
    }
    acc += len;
    vertexIndex.push(o - 1);
  }
  return { d, x, z, vertexIndex };
}

/** Height sample with the resolution level it came from (0 = 1 m; −1 = no data). */
export interface LevelHeight {
  h: number;
  level: number;
}

export interface Profile extends PolylineSamples {
  /** True DTM heights (NaN = no data). */
  dtm: Float64Array;
  /** True DSM heights (NaN where the DSM is not available). */
  dsm: Float64Array;
  /** Samples whose DTM height did not come from level 0 (coarser level or missing). */
  coarse: number;
  /** Samples without any DTM height. */
  missing: number;
  /** Samples with a DSM height. */
  dsmCount: number;
}

/** Sample DTM (+ optional DSM) along a polyline. */
export function sampleProfile(
  pts: readonly XZ[],
  dtmAt: (x: number, z: number) => LevelHeight,
  dsmAt?: (x: number, z: number) => number,
  step = 0.5,
): Profile {
  const s = samplePolyline(pts, step);
  const n = s.d.length;
  const dtm = new Float64Array(n);
  const dsm = new Float64Array(n);
  let coarse = 0;
  let missing = 0;
  let dsmCount = 0;
  for (let i = 0; i < n; i++) {
    const r = dtmAt(s.x[i], s.z[i]);
    const h = Number.isFinite(r.h) ? r.h : NaN;
    dtm[i] = h;
    if (Number.isNaN(h)) missing++;
    if (Number.isNaN(h) || r.level !== 0) coarse++;
    const c = dsmAt ? dsmAt(s.x[i], s.z[i]) : NaN;
    dsm[i] = Number.isFinite(c) ? c : NaN;
    if (!Number.isNaN(dsm[i])) dsmCount++;
  }
  return { ...s, dtm, dsm, coarse, missing, dsmCount };
}

export interface ProfileStats {
  /** Horizontal length (m). */
  length2d: number;
  /** Length along the (true, unexaggerated) surface: Σ √(Δd² + Δh²) over valid sample pairs. */
  length3d: number;
  hMin: number;
  hMax: number;
  hAvg: number;
  /** Distance (m) of hMin / hMax along the line. */
  hMinAt: number;
  hMaxAt: number;
  /** Last valid height − first valid height. */
  dh: number;
  /** Sum of positive / negative height steps between consecutive samples (both ≥ 0). */
  ascent: number;
  descent: number;
  /** Mean / max of |slope| (degrees), central difference over ±`slopeBase`/2. */
  slopeAvgDeg: number;
  slopeMaxDeg: number;
  slopeMaxAt: number;
  /** Valid (finite) height samples. */
  valid: number;
}

/**
 * Statistics of a height series over distances `d`. NaN heights are skipped (they break the 3D
 * length / ascent chain only locally). `slopeBase` (m) is the baseline of the slope estimate:
 * 2 m smooths the bilinear kinks of a 1 m DTM without hiding a ditch flank.
 */
export function profileStats(d: ArrayLike<number>, h: ArrayLike<number>, slopeBase = 2): ProfileStats {
  const n = d.length;
  let hMin = Infinity;
  let hMax = -Infinity;
  let hMinAt = NaN;
  let hMaxAt = NaN;
  let sum = 0;
  let valid = 0;
  let first = NaN;
  let last = NaN;
  let length3d = 0;
  let ascent = 0;
  let descent = 0;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const v = h[i];
    if (!Number.isFinite(v)) continue;
    valid++;
    sum += v;
    if (v < hMin) {
      hMin = v;
      hMinAt = d[i];
    }
    if (v > hMax) {
      hMax = v;
      hMaxAt = d[i];
    }
    if (Number.isNaN(first)) first = v;
    last = v;
    if (prev >= 0) {
      const dh = v - h[prev];
      length3d += Math.hypot(d[i] - d[prev], dh);
      if (dh > 0) ascent += dh;
      else descent -= dh;
    }
    prev = i;
  }
  // Slope: central difference over a window of ±slopeBase/2 (clamped at the ends).
  const half = slopeBase / 2;
  let slopeSum = 0;
  let slopeN = 0;
  let slopeMax = 0;
  let slopeMaxAt = NaN;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(h[i])) continue;
    while (lo < i && d[i] - d[lo] > half + 1e-9) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < n && d[hi + 1] - d[i] <= half + 1e-9) hi++;
    let a = lo;
    let b = hi;
    while (a < i && !Number.isFinite(h[a])) a++;
    while (b > i && !Number.isFinite(h[b])) b--;
    const run = d[b] - d[a];
    if (run <= 1e-9) continue;
    const deg = (Math.atan(Math.abs(h[b] - h[a]) / run) * 180) / Math.PI;
    slopeSum += deg;
    slopeN++;
    if (deg > slopeMax) {
      slopeMax = deg;
      slopeMaxAt = d[i];
    }
  }
  return {
    length2d: n ? d[n - 1] - d[0] : 0,
    length3d,
    hMin: valid ? hMin : NaN,
    hMax: valid ? hMax : NaN,
    hAvg: valid ? sum / valid : NaN,
    hMinAt,
    hMaxAt,
    dh: last - first,
    ascent,
    descent,
    slopeAvgDeg: slopeN ? slopeSum / slopeN : NaN,
    slopeMaxDeg: slopeN ? slopeMax : NaN,
    slopeMaxAt,
    valid,
  };
}

/** Index of the sample nearest to distance `t` (binary search on the ascending `d`). */
export function nearestSample(d: ArrayLike<number>, t: number): number {
  const n = d.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(d[hi] - t) < Math.abs(t - d[lo]) ? hi : lo;
}

/** "Nice" axis ticks (1/2/5 × 10^k) covering [min, max] with about `count` intervals. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max < min) [min, max] = [max, min];
  if (max - min < 1e-9) return [min];
  const raw = (max - min) / Math.max(count, 1);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  const out: number[] = [];
  const start = Math.ceil(min / step - 1e-9) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step || 0);
  return out;
}

/** Level-0 chunk keys a set of world positions needs (deduplicated, in order of first use). */
export function chunkKeysAlong(x: ArrayLike<number>, z: ArrayLike<number>, keyAt: (x: number, z: number) => string): string[] {
  const seen = new Set<string>();
  for (let i = 0; i < x.length; i++) seen.add(keyAt(x[i], z[i]));
  return [...seen];
}

/** |slope| (degrees) at sample `i`: central difference over ±`base`/2 m (NaN without valid data). */
export function localSlopeDeg(d: ArrayLike<number>, h: ArrayLike<number>, i: number, base = 2): number {
  const n = d.length;
  if (i < 0 || i >= n || !Number.isFinite(h[i])) return NaN;
  const half = base / 2;
  let a = i;
  let b = i;
  while (a > 0 && d[i] - d[a - 1] <= half + 1e-9) a--;
  while (b + 1 < n && d[b + 1] - d[i] <= half + 1e-9) b++;
  while (a < i && !Number.isFinite(h[a])) a++;
  while (b > i && !Number.isFinite(h[b])) b--;
  const run = d[b] - d[a];
  return run > 1e-9 ? (Math.atan(Math.abs(h[b] - h[a]) / run) * 180) / Math.PI : NaN;
}
