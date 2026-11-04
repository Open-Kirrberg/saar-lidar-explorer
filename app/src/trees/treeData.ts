/**
 * V2.4 trees — pure data side of the `sle-trees-v1` layer (docs/data-contract.md "Trees"): tolerant
 * manifest parse, chunk decode/encode, stable ids, instance rows. No three/DOM imports, so the
 * castle viewer can import `decodeTrees` as is.
 */

export const TREES_FORMAT = 'sle-trees-v1';
export const TREE_HEADER_BYTES = 16;
export const TREE_RECORD_BYTES = 10;
/** Bit of `type` that marks fill trees (estimated position, ADR 0030). */
export const TREE_FILL_FLAG = 0x80;
export const TREE_MAGIC = [0x53, 0x4c, 0x45, 0x54] as const; // 'SLET'

/** Base type codes (low 7 bits of `type`). */
export const TreeKind = { Unknown: 0, Conifer: 1, Broadleaf: 2 } as const;
export type TreeKind = (typeof TreeKind)[keyof typeof TreeKind];

export interface ManifestTrees {
  format: typeof TREES_FORMAT;
  /** Template with `{i}` and `{j}`, relative to the AOI dir. */
  path: string;
  /** Only chunks that have a file: [i, j, count]. */
  chunks: Array<[number, number, number]>;
  count: number;
  fill: number;
  fillFlag: number;
  heightRange?: { min: number; max: number };
  crownRadiusRange?: { min: number; max: number };
  label_de?: string;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Tolerant parse of the optional `trees` key: absent, non-object, wrong `format` or a path without
 * `{i}`/`{j}` → undefined (logged, not fatal). Bad `chunks` entries are skipped.
 */
export function parseTrees(v: unknown, grid: { nx: number; ny: number }): ManifestTrees | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    console.warn('[manifest] trees: not an object, ignored');
    return undefined;
  }
  const x = v as Record<string, unknown>;
  if (x.format !== TREES_FORMAT) {
    console.warn(`[manifest] trees: unsupported format ${String(x.format)}, ignored`);
    return undefined;
  }
  if (typeof x.path !== 'string' || !x.path.includes('{i}') || !x.path.includes('{j}')) {
    console.warn('[manifest] trees: path without {i}/{j}, ignored');
    return undefined;
  }
  const chunks: Array<[number, number, number]> = [];
  let skipped = 0;
  for (const c of Array.isArray(x.chunks) ? x.chunks : []) {
    const ok =
      Array.isArray(c) && c.length === 3 && isInt(c[0]) && isInt(c[1]) && isInt(c[2]) &&
      c[0] >= 0 && c[0] < grid.nx && c[1] >= 0 && c[1] < grid.ny && c[2] >= 1;
    if (ok) chunks.push([c[0], c[1], c[2]]);
    else skipped++;
  }
  if (skipped) console.warn(`[manifest] trees: ${skipped} invalid chunk entries skipped`);
  const range = (r: unknown) => {
    const o = r as { min?: unknown; max?: unknown } | undefined;
    return o && typeof o.min === 'number' && typeof o.max === 'number' ? { min: o.min, max: o.max } : undefined;
  };
  const out: ManifestTrees = {
    format: TREES_FORMAT,
    path: x.path,
    chunks,
    count: isInt(x.count) ? x.count : chunks.reduce((a, c) => a + c[2], 0),
    fill: isInt(x.fill) ? x.fill : 0,
    fillFlag: isInt(x.fillFlag) ? x.fillFlag : TREE_FILL_FLAG,
  };
  const hr = range(x.heightRange);
  if (hr) out.heightRange = hr;
  const rr = range(x.crownRadiusRange);
  if (rr) out.crownRadiusRange = rr;
  if (typeof x.label_de === 'string') out.label_de = x.label_de;
  return out;
}

/** MurmurHash3 32-bit finalizer (contract "Order = LOD"). */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Stable id from a top-cell centre (E, N) in EPSG:25832: lower-left cell corner, mod 65536 each. */
export function treeId(E: number, N: number): number {
  const ec = Math.round(E - 0.5);
  const nc = Math.round(N - 0.5);
  const m = (v: number) => ((v % 65536) + 65536) % 65536;
  return ((m(ec) << 16) | m(nc)) >>> 0;
}

/** LOD rank in [0, 1): fmix32(id) / 2³². Records are sorted by it, so a prefix is a subsample. */
export function treeRank(id: number): number {
  return fmix32(id) / 4294967296;
}

/** Second, independent hash in [0, 1) for shape/rotation/tint variation (never for LOD). */
export function treeSeed(id: number): number {
  return fmix32((id ^ 0x9e3779b9) >>> 0) / 4294967296;
}

/** Where a level-0 chunk sits in EPSG:25832 (west and south edge in metres). */
export interface TreeChunkRef {
  i: number;
  j: number;
  west: number;
  south: number;
}

/** Chunk edges per contract: E = E0 + i·L, N = N0 + height − (j+1)·L with L = chunkSize·cellSize. */
export function treeChunkRef(
  m: { origin: { E0: number; N0: number }; size: { height: number }; chunkSize: number; cellSize: number },
  i: number,
  j: number,
): TreeChunkRef {
  const L = m.chunkSize * m.cellSize;
  return { i, j, west: m.origin.E0 + i * L, south: m.origin.N0 + m.size.height * m.cellSize - (j + 1) * L };
}

/** One decoded chunk, struct of arrays in record (= LOD) order. */
export interface DecodedTrees {
  ref: TreeChunkRef;
  count: number;
  gBase: number;
  /** Top-cell centre, EPSG:25832 (exact: dm grid). */
  E: Float64Array;
  N: Float64Array;
  /** True ground height (m, DHHN2016) = gBase + g/100. */
  ground: Float32Array;
  /** Tree height above ground (m). */
  height: Float32Array;
  /** Crown radius (m). */
  radius: Float32Array;
  /** Raw `type` byte: low 7 bits base type, bit 7 fill flag. */
  type: Uint8Array;
  id: Uint32Array;
  /** fmix32(id)/2³², ascending in a valid file. */
  rank: Float32Array;
}

export function treeKind(type: number): TreeKind {
  const k = type & 0x7f;
  return k === TreeKind.Conifer || k === TreeKind.Broadleaf ? k : TreeKind.Unknown;
}

export function isFillTree(type: number): boolean {
  return (type & TREE_FILL_FLAG) !== 0;
}

/** Decode a `trees/{i}_{j}.bin` chunk. Throws on a bad header (magic, version, size). */
export function decodeTrees(buf: ArrayBuffer, chunk: TreeChunkRef): DecodedTrees {
  if (buf.byteLength < TREE_HEADER_BYTES) throw new Error(`trees ${chunk.i}_${chunk.j}: ${buf.byteLength} B < header`);
  const dv = new DataView(buf);
  for (let k = 0; k < 4; k++) {
    if (dv.getUint8(k) !== TREE_MAGIC[k]) throw new Error(`trees ${chunk.i}_${chunk.j}: bad magic`);
  }
  const version = dv.getUint16(4, true);
  if (version !== 1) throw new Error(`trees ${chunk.i}_${chunk.j}: unsupported version ${version}`);
  const count = dv.getUint32(8, true);
  if (buf.byteLength !== TREE_HEADER_BYTES + TREE_RECORD_BYTES * count) {
    throw new Error(`trees ${chunk.i}_${chunk.j}: size ${buf.byteLength} ≠ 16 + 10·${count}`);
  }
  const gBase = dv.getFloat32(12, true);
  const out: DecodedTrees = {
    ref: chunk,
    count,
    gBase,
    E: new Float64Array(count),
    N: new Float64Array(count),
    ground: new Float32Array(count),
    height: new Float32Array(count),
    radius: new Float32Array(count),
    type: new Uint8Array(count),
    id: new Uint32Array(count),
    rank: new Float32Array(count),
  };
  for (let k = 0, o = TREE_HEADER_BYTES; k < count; k++, o += TREE_RECORD_BYTES) {
    const E = chunk.west + dv.getUint16(o, true) / 10;
    const N = chunk.south + dv.getUint16(o + 2, true) / 10;
    out.E[k] = E;
    out.N[k] = N;
    out.ground[k] = gBase + dv.getUint16(o + 4, true) / 100;
    out.height[k] = dv.getUint16(o + 6, true) / 100;
    out.radius[k] = dv.getUint8(o + 8) / 10;
    out.type[k] = dv.getUint8(o + 9);
    const id = treeId(E, N);
    out.id[k] = id;
    out.rank[k] = treeRank(id);
  }
  return out;
}

export interface TreeRecordIn {
  E: number;
  N: number;
  ground: number;
  height: number;
  radius: number;
  type: number;
}

/** Encode records as a contract chunk, sorted by fmix32(id) (fixtures and tests). */
export function encodeTrees(records: readonly TreeRecordIn[], chunk: TreeChunkRef): ArrayBuffer {
  const recs = records
    .map((r) => ({ r, h: fmix32(treeId(r.E, r.N)) }))
    .sort((a, b) => a.h - b.h)
    .map((x) => x.r);
  const gBase = recs.length ? Math.floor(Math.min(...recs.map((r) => r.ground)) * 100) / 100 : 0;
  const buf = new ArrayBuffer(TREE_HEADER_BYTES + TREE_RECORD_BYTES * recs.length);
  const dv = new DataView(buf);
  TREE_MAGIC.forEach((b, k) => dv.setUint8(k, b));
  dv.setUint16(4, 1, true);
  dv.setUint32(8, recs.length, true);
  dv.setFloat32(12, gBase, true);
  recs.forEach((r, k) => {
    const o = TREE_HEADER_BYTES + TREE_RECORD_BYTES * k;
    dv.setUint16(o, Math.round((r.E - chunk.west) * 10), true);
    dv.setUint16(o + 2, Math.round((r.N - chunk.south) * 10), true);
    dv.setUint16(o + 4, Math.round((r.ground - Math.fround(gBase)) * 100), true);
    dv.setUint16(o + 6, Math.round(r.height * 100), true);
    dv.setUint8(o + 8, Math.max(1, Math.min(255, Math.round(r.radius * 10))));
    dv.setUint8(o + 9, r.type & 0xff);
  });
  return buf;
}

/**
 * GPU instance row (Float32 × 8), identical for every LOD mesh that draws the tree:
 *   [x, g, z, h, r, rank, seed, kind]   x = E − E0, z = −(N − N0) (world frame), g true ground,
 *   kind = base type + 4·fill.
 */
export const TREE_STRIDE = 8;

export function buildInstanceRows(t: DecodedTrees, origin: { E0: number; N0: number }): Float32Array {
  const a = new Float32Array(t.count * TREE_STRIDE);
  for (let k = 0; k < t.count; k++) {
    const o = k * TREE_STRIDE;
    a[o] = t.E[k] - origin.E0;
    a[o + 1] = t.ground[k];
    a[o + 2] = -(t.N[k] - origin.N0);
    a[o + 3] = t.height[k];
    a[o + 4] = t.radius[k];
    a[o + 5] = t.rank[k];
    a[o + 6] = treeSeed(t.id[k]);
    a[o + 7] = treeKind(t.type[k]) + (isFillTree(t.type[k]) ? 4 : 0);
  }
  return a;
}

/** Bounds of a chunk's rows in true metres (for culling / distance planning). */
export interface RowBounds {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  /** Ground height range (true m). */
  gMin: number;
  gMax: number;
  /** Largest tree height and crown radius (m). */
  hMax: number;
  rMax: number;
}

export function rowBounds(rows: Float32Array): RowBounds {
  const b: RowBounds = { xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity, gMin: Infinity, gMax: -Infinity, hMax: 0, rMax: 0 };
  for (let o = 0; o < rows.length; o += TREE_STRIDE) {
    b.xMin = Math.min(b.xMin, rows[o]);
    b.xMax = Math.max(b.xMax, rows[o]);
    b.gMin = Math.min(b.gMin, rows[o + 1]);
    b.gMax = Math.max(b.gMax, rows[o + 1]);
    b.zMin = Math.min(b.zMin, rows[o + 2]);
    b.zMax = Math.max(b.zMax, rows[o + 2]);
    b.hMax = Math.max(b.hMax, rows[o + 3]);
    b.rMax = Math.max(b.rMax, rows[o + 4]);
  }
  return b;
}

/**
 * Copy the rows within `radius` (horizontal) of (cx, cz) from several chunks into `out`
 * (grown when too small). Rows are copied verbatim — a tree has the same instance data in the
 * near mesh as in the chunk meshes. Returns the (possibly new) buffer and the row count.
 */
export function gatherRows(
  sources: Iterable<Float32Array>,
  cx: number,
  cz: number,
  radius: number,
  out: Float32Array,
): { rows: Float32Array; count: number } {
  const r2 = radius * radius;
  let n = 0;
  let buf = out;
  for (const src of sources) {
    for (let o = 0; o < src.length; o += TREE_STRIDE) {
      const dx = src[o] - cx;
      const dz = src[o + 2] - cz;
      if (dx * dx + dz * dz > r2) continue;
      if ((n + 1) * TREE_STRIDE > buf.length) {
        const grown = new Float32Array(Math.max(buf.length * 2, 1024 * TREE_STRIDE));
        grown.set(buf.subarray(0, n * TREE_STRIDE));
        buf = grown;
      }
      buf.set(src.subarray(o, o + TREE_STRIDE), n * TREE_STRIDE);
      n++;
    }
  }
  return { rows: buf, count: n };
}
