/**
 * Pure helpers for the castle zone package (docs/zone-contract.md, sle-zone-v1): terrain quantisation, the package
 * terrain meta, the zone index merge and the budget. No fs, no three.
 */
import type { EN } from './footprint.ts';

export const ZONE_FORMAT = 'sle-zone-v1';
export const ZONE_INDEX_FORMAT = 'sle-zones-v1';

/** Contract budget limits (docs/zone-contract.md "Budgets"; app/src/zones/contract.ts ZONE_BUDGET_LIMITS). */
export const BUDGET_LIMITS = {
  downloadBytes: 30_000_000,
  totalBytes: 120_000_000,
  triangles: 1_500_000,
  textureBytesGpu: 128_000_000,
} as const;
export const MODULE_GZIP_LIMIT = 1_500_000;

/**
 * Declared triangles in view (ADR 0040, supersedes the ADR 0033 waiver): `skb.inView()` max over the Rundflug and the
 * highlights in the phone-proxy viewport (390 × 844, `pnpm run perf:zone` sweep), 1.36 M since the far garden crowns
 * became hulls (KB-I105), rounded up. A landscape desktop view sees more (≈ 2.1 M); the contract budget is the phone's.
 */
export const DECLARED_TRIANGLES = 1_400_000;

export interface ZoneBudget {
  downloadBytes: number;
  totalBytes: number;
  triangles: number;
  textureBytesGpu: number;
}

// ---------------------------------------------------------------- terrain

export const U16_NODATA = 65535;
export const U16_SCALE = 0.01;

export interface U16Encoding {
  dtype: 'uint16';
  offset: number;
  scale: number;
  nodata: number;
  /** The file stores gradient residuals (`gradientResidual`), not the steps themselves. */
  predictor?: 'gradient';
  /** The file is a zlib/deflate stream (RFC 1950; the browser's `DecompressionStream('deflate')`). */
  compression?: 'deflate';
}

/**
 * Heights → uint16 steps of `scale` above `offset = floor(min)`; NaN → nodata. Throws if the range does not fit.
 * Max error = scale / 2 (5 mm at the default 1 cm).
 */
export function encodeU16(h: Float32Array, scale = U16_SCALE): { data: Uint16Array; enc: U16Encoding } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    if (Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) throw new Error('encodeU16: no finite heights');
  const offset = Math.floor(lo);
  if (Math.round((hi - offset) / scale) >= U16_NODATA) {
    throw new Error(`encodeU16: range ${offset}..${hi} m does not fit uint16 at ${scale} m steps`);
  }
  const data = new Uint16Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const v = h[i]!;
    data[i] = Number.isNaN(v) ? U16_NODATA : Math.round((v - offset) / scale);
  }
  return { data, enc: { dtype: 'uint16', offset, scale, nodata: U16_NODATA } };
}

/** uint16 steps → Float32 heights (`h = offset + v · scale`, nodata → NaN); the viewer's loadTerrain does the same. */
export function decodeU16(data: Uint16Array, enc: Pick<U16Encoding, 'offset' | 'scale' | 'nodata'>): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] === enc.nodata ? NaN : enc.offset + data[i]! * enc.scale;
  return out;
}

/**
 * Gradient predictor (PNG Paeth's simpler cousin, as in TIFF/LERC terrain codecs): residual = v − (left + up − upLeft)
 * mod 2¹⁶, outside the grid = 0. Lossless (nodata survives exactly); on the 1 m DTM the residuals are mostly 0 ± a few
 * cm, so deflate packs the 11.4 MB uint16 grid into ≈ 2.5 MB (raw deflate: ≈ 8 MB). The viewer's `decodeHeights`
 * inverts it.
 */
export function gradientResidual(v: Uint16Array, cols: number, rows: number): Uint16Array {
  if (v.length !== cols * rows) throw new Error(`gradientResidual: ${v.length} values, expected ${cols * rows}`);
  const out = new Uint16Array(v.length);
  for (let r = 0; r < rows; r++) {
    const i0 = r * cols;
    for (let c = 0; c < cols; c++) {
      const i = i0 + c;
      const left = c ? v[i - 1]! : 0;
      const up = r ? v[i - cols]! : 0;
      const upLeft = r && c ? v[i - cols - 1]! : 0;
      out[i] = v[i]! - left - up + upLeft; // Uint16Array stores mod 2¹⁶
    }
  }
  return out;
}

/** Little-endian bytes, independent of the host's byte order. */
export function u16LE(data: Uint16Array): Uint8Array {
  const out = new Uint8Array(data.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < data.length; i++) dv.setUint16(i * 2, data[i]!, true);
  return out;
}

/** Float32 heights from little-endian bytes (the viewer terrain's dtm1789.f32). */
export function f32FromLE(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4) throw new Error('f32FromLE: byte length not a multiple of 4');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

export const PACKAGE_TERRAIN_FILES = { dtm1789: 'dtm1789.u16.deflate', ground: 'ground.u8.deflate' } as const;

/**
 * The package's terrain/meta.json from the viewer's: 1789 only (no dtm2025, ground2025, counts2025), the dtm as
 * uint16 gradient residuals and the ground classes, both deflated, with an `encoding` block, the file sizes in
 * `bytes` (loading progress without Content-Length) and `h_range` of the 1789 heights.
 */
export function packageTerrainMeta(
  dev: Record<string, unknown>,
  enc: U16Encoding,
  hRange: [number, number],
  bytes: { dtm1789: number; ground: number },
): Record<string, unknown> {
  const meta = structuredClone(dev);
  const grid = meta.grid as Record<string, unknown> | undefined;
  const ground = meta.ground as Record<string, unknown> | undefined;
  if (!grid || !ground || !meta.files) throw new Error('terrain meta: grid, ground or files missing');
  const cells = (grid.cols as number) * (grid.rows as number);
  if (!(cells > 0)) throw new Error('terrain meta: bad grid size');
  grid.dtype = 'uint16 little-endian, h = offset + v * scale, v = nodata -> no data (see encoding.dtm1789)';
  delete ground.counts2025;
  if (typeof ground.tag === 'string') ground.tag = ground.tag.split('; 2025 (')[0]!;
  meta.files = { ...PACKAGE_TERRAIN_FILES };
  meta.encoding = { dtm1789: { ...enc, predictor: 'gradient', compression: 'deflate' }, ground: { compression: 'deflate' } };
  meta.bytes = { ...bytes };
  meta.h_range = hRange;
  return meta;
}

export function finiteRange(h: Float32Array): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    if (Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

// ---------------------------------------------------------------- index

export type BboxEN = [EN, EN];

export interface ZoneIndexEntry {
  id: string;
  bboxEN: BboxEN;
}

export interface ZoneIndex {
  format: typeof ZONE_INDEX_FORMAT;
  zones: ZoneIndexEntry[];
}

/** Bbox of footprint + portals, widened to whole metres (contains both). */
export function zoneBbox(footprint: readonly EN[], portals: readonly { E: number; N: number }[]): BboxEN {
  const pts: EN[] = [...footprint, ...portals.map((p): EN => [p.E, p.N])];
  if (!pts.length) throw new Error('zoneBbox: no points');
  let [e0, n0, e1, n1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [E, N] of pts) {
    e0 = Math.min(e0, E);
    n0 = Math.min(n0, N);
    e1 = Math.max(e1, E);
    n1 = Math.max(n1, N);
  }
  return [
    [Math.floor(e0), Math.floor(n0)],
    [Math.ceil(e1), Math.ceil(n1)],
  ];
}

/**
 * Merge one entry into an existing `zones/index.json` (or null = none yet): replaces the zone with the same id,
 * keeps every other entry untouched, sorts by id. A file that is not an sle-zones-v1 index is an error (never
 * clobbered).
 */
export function mergeZoneIndex(existing: unknown, entry: ZoneIndexEntry): ZoneIndex {
  let zones: unknown[] = [];
  if (existing !== null && existing !== undefined) {
    const ex = existing as { format?: unknown; zones?: unknown };
    if (typeof ex !== 'object' || ex.format !== ZONE_INDEX_FORMAT || !Array.isArray(ex.zones)) {
      throw new Error(`zones/index.json is not an ${ZONE_INDEX_FORMAT} index; refusing to overwrite it`);
    }
    zones = ex.zones;
  }
  const others = zones.filter((z) => !(z && typeof z === 'object' && (z as { id?: unknown }).id === entry.id));
  const all = [...others, { id: entry.id, bboxEN: entry.bboxEN }] as ZoneIndexEntry[];
  const key = (z: ZoneIndexEntry): string => (typeof z?.id === 'string' ? z.id : '');
  all.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { format: ZONE_INDEX_FORMAT, zones: all };
}

// ---------------------------------------------------------------- budget

export interface PackageFile {
  /** Path relative to the zone folder. */
  path: string;
  bytes: number;
  /** Fetched before the loading screen closes. */
  firstView: boolean;
  /** Image size if the file is a texture uploaded to the GPU. */
  texture?: { w: number; h: number };
}

/** GPU bytes of an uncompressed RGBA8 texture with a full mip chain (4 B per texel · 4/3). */
export const textureGpuBytes = (w: number, h: number): number => Math.round((w * h * 4 * 4) / 3);

/**
 * downloadBytes = first-view files + module chunk (gzip); totalBytes = all files + module chunk;
 * textureBytesGpu = Σ textures (RGBA8 + mips); triangles = declared by the caller (max drawn at once).
 */
export function computeBudget(files: readonly PackageFile[], moduleBytes: number, triangles: number): ZoneBudget {
  let first = 0;
  let total = 0;
  let gpu = 0;
  for (const f of files) {
    total += f.bytes;
    if (f.firstView) first += f.bytes;
    if (f.texture) gpu += textureGpuBytes(f.texture.w, f.texture.h);
  }
  return { downloadBytes: first + moduleBytes, totalBytes: total + moduleBytes, triangles, textureBytesGpu: gpu };
}

/** Limit violations (empty = within budget). `trianglesCeiling` replaces the triangle limit (no zone uses one since ADR 0040). */
export function budgetProblems(b: ZoneBudget, moduleBytes: number, trianglesCeiling: number = BUDGET_LIMITS.triangles): string[] {
  const out: string[] = [];
  const limits: ZoneBudget = { ...BUDGET_LIMITS, triangles: trianglesCeiling };
  for (const k of Object.keys(limits) as (keyof ZoneBudget)[]) {
    if (b[k] > limits[k]) out.push(`budget.${k} ${b[k]} > ${limits[k]}`);
  }
  if (moduleBytes > MODULE_GZIP_LIMIT) out.push(`module chunk ${moduleBytes} B gzip > ${MODULE_GZIP_LIMIT}`);
  return out;
}

// ---------------------------------------------------------------- geometry drift

/** Max coordinate difference between two rings of equal length (Infinity if lengths differ). */
export function ringDelta(a: readonly EN[], b: readonly EN[]): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i]![0] - b[i]![0]), Math.abs(a[i]![1] - b[i]![1]));
  return d;
}
