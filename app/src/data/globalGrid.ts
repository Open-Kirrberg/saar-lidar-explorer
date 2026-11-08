/**
 * Global grid `sle-grid-25832-v1` and the presence bitmap (data contract "Many places (v3, S2)").
 * Pure: no DOM, no three.
 *
 * Grid: EPSG:25832, SW corner (Eg, Ng) = (300 000, 5 400 000), 256 km square, 1 km tiles, level-k
 * chunk side S_k = 500·2^k m (k ≤ 9). Global chunk address (k, I, J): I east, J **south**, both
 * from the NW corner (Eg, NgTop = Ng + 256 000).
 */

export const GRID_ID = 'sle-grid-25832-v1';
export const GRID_E = 300_000;
export const GRID_N = 5_400_000;
export const GRID_EXTENT = 256_000;
export const GRID_N_TOP = GRID_N + GRID_EXTENT;
export const TILE_M = 1000;
export const CHUNK_M = 500;
export const MAX_GRID_LEVEL = 9;

export interface GridDecl {
  id: string;
  origin: { E: number; N: number };
  extent_m: number;
  tile_m: number;
  chunk_m: number;
}

/** The constant `grid` object every v3 manifest, catalog and overview declares. */
export const GLOBAL_GRID: Readonly<GridDecl> = Object.freeze({
  id: GRID_ID,
  origin: Object.freeze({ E: GRID_E, N: GRID_N }),
  extent_m: GRID_EXTENT,
  tile_m: TILE_M,
  chunk_m: CHUNK_M,
});

/** Does `v` declare exactly the global grid (readers reject any other value)? */
export function isGlobalGrid(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const g = v as Partial<GridDecl>;
  return (
    g.id === GRID_ID &&
    !!g.origin &&
    g.origin.E === GRID_E &&
    g.origin.N === GRID_N &&
    g.extent_m === GRID_EXTENT &&
    g.tile_m === TILE_M &&
    g.chunk_m === CHUNK_M
  );
}

/** Level-k chunk side in metres (500 · 2^k). */
export function chunkSide(k: number): number {
  return CHUNK_M * 2 ** k;
}

const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Is the rectangle [E0, N0, E0 + W, N0 + H] (metres) aligned at G (relative to the grid origin)? */
export function isAligned(E0: number, N0: number, W: number, H: number, G: number): boolean {
  return (
    [E0, N0, W, H].every((v) => Number.isFinite(v)) &&
    W > 0 &&
    H > 0 &&
    mod(E0 - GRID_E, G) === 0 &&
    mod(N0 - GRID_N, G) === 0 &&
    mod(W, G) === 0 &&
    mod(H, G) === 0
  );
}

/** Rectangle in metres: SW corner + size (as manifests carry it). */
export interface Rect {
  E0: number;
  N0: number;
  W: number;
  H: number;
}

/** Rectangle-relative chunk (k, i, j) → global address (k, I, J). Integers when `r` is aligned at S_k. */
export function toGlobal(k: number, i: number, j: number, r: Rect): { I: number; J: number } {
  const S = chunkSide(k);
  return { I: i + (r.E0 - GRID_E) / S, J: j + (GRID_N_TOP - (r.N0 + r.H)) / S };
}

/** Global address → chunk indices relative to rectangle `r` (may be outside its chunk grid). */
export function toLocal(k: number, I: number, J: number, r: Rect): { i: number; j: number } {
  const S = chunkSide(k);
  return { i: I - (r.E0 - GRID_E) / S, j: J - (GRID_N_TOP - (r.N0 + r.H)) / S };
}

/** West edge and north edge (metres) of global chunk (k, I, J). */
export function globalChunkEdges(k: number, I: number, J: number): { Ew: number; Nn: number; S: number } {
  const S = chunkSide(k);
  return { Ew: GRID_E + I * S, Nn: GRID_N_TOP - J * S, S };
}

/** Tile id `"{E/1000}_{N/1000}"` of the tile with SW corner (E, N). */
export function tileId(E: number, N: number): string {
  return `${Math.floor(E / TILE_M)}_${Math.floor(N / TILE_M)}`;
}

/** Tile id of the tile containing point (E, N). */
export function tileIdAt(E: number, N: number): string {
  return tileId(Math.floor(E / TILE_M) * TILE_M, Math.floor(N / TILE_M) * TILE_M);
}

/** Parse a tile id; null when malformed or outside the grid. */
export function parseTileId(id: string): { E: number; N: number } | null {
  const m = /^(\d{3})_(\d{4})$/.exec(id);
  if (!m) return null;
  const e = Number(m[1]);
  const n = Number(m[2]);
  if (e < GRID_E / 1000 || e >= (GRID_E + GRID_EXTENT) / 1000 || n < GRID_N / 1000 || n >= GRID_N_TOP / 1000) return null;
  return { E: e * TILE_M, N: n * TILE_M };
}

/**
 * Tile id of the 1 km tile that contains level-k chunk (k, I, J) for k ∈ {0, 1} (level 1 = one
 * tile, level 0 = a quarter tile). Other levels: null.
 */
export function tileOfChunk(k: number, I: number, J: number): string | null {
  if (k !== 0 && k !== 1) return null;
  const tI = k === 0 ? I >> 1 : I;
  const tJ = k === 0 ? J >> 1 : J;
  return tileId(GRID_E + tI * TILE_M, GRID_N_TOP - (tJ + 1) * TILE_M);
}

// ---- presence bitmap ------------------------------------------------------------------------------

export interface BitmapDecl {
  w: number;
  h: number;
  bits: string;
  count: number;
}

/** A decoded bitmap: one byte per cell (0/1), row-major, row 0 = north. */
export interface Bitmap {
  w: number;
  h: number;
  cells: Uint8Array;
  count: number;
}

const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function b64decode(s: string): Uint8Array | null {
  if (!B64.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
  } catch {
    return null;
  }
}

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (let k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
  return btoa(bin);
}

/**
 * Decode + validate a presence bitmap: integer w, h ≥ 1; standard base64 with padding of exactly
 * ceil(w·h/8) bytes; trailing bits after w·h are 0; `count` = number of set bits. Optional expected
 * size. Returns null (with the reason in `why`) when invalid.
 */
export function decodeBitmap(v: unknown, expect?: { w: number; h: number }, why?: (msg: string) => void): Bitmap | null {
  const bad = (msg: string): null => {
    why?.(msg);
    return null;
  };
  if (!v || typeof v !== 'object') return bad('not an object');
  const b = v as Partial<BitmapDecl>;
  if (!Number.isInteger(b.w) || !Number.isInteger(b.h) || b.w! < 1 || b.h! < 1) return bad('w/h');
  const w = b.w!;
  const h = b.h!;
  if (expect && (expect.w !== w || expect.h !== h)) return bad(`size ${w}×${h} ≠ ${expect.w}×${expect.h}`);
  if (typeof b.bits !== 'string') return bad('bits');
  const bytes = b64decode(b.bits);
  if (!bytes) return bad('bad base64');
  const n = w * h;
  if (bytes.length !== Math.ceil(n / 8)) return bad(`${bytes.length} bytes ≠ ${Math.ceil(n / 8)}`);
  const cells = new Uint8Array(n);
  let count = 0;
  for (let k = 0; k < n; k++) {
    const bit = (bytes[k >> 3] >> (k & 7)) & 1;
    cells[k] = bit;
    count += bit;
  }
  for (let k = n; k < bytes.length * 8; k++) if ((bytes[k >> 3] >> (k & 7)) & 1) return bad('trailing bits set');
  if (b.count !== count) return bad(`count ${String(b.count)} ≠ ${count}`);
  return { w, h, cells, count };
}

/** Encode cells (0/1 per cell, row-major, row 0 = north) as a bitmap declaration. */
export function encodeBitmap(cells: ArrayLike<number>, w: number, h: number): BitmapDecl {
  const bytes = new Uint8Array(Math.ceil((w * h) / 8));
  let count = 0;
  for (let k = 0; k < w * h; k++) {
    if (!cells[k]) continue;
    bytes[k >> 3] |= 1 << (k & 7);
    count++;
  }
  return { w, h, bits: b64encode(bytes), count };
}

/** Bit (col, row) of a decoded bitmap; outside → 0. */
export function bitAt(b: Bitmap, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= b.w || row >= b.h) return 0;
  return b.cells[row * b.w + col];
}

/** All bitmap with every bit set (presence absent = every tile present). */
export function fullBitmap(w: number, h: number): Bitmap {
  return { w, h, cells: new Uint8Array(w * h).fill(1), count: w * h };
}

/**
 * Presence of a level-k chunk (i, j) of a v3 manifest whose rectangle presence bitmap counts
 * 1 km tiles: level 0 → tile bit (⌊i/2⌋, ⌊j/2⌋), level 1 → bit (i, j). Other levels: present.
 */
export function chunkPresent(presence: Bitmap | undefined, k: number, i: number, j: number): boolean {
  if (!presence) return true;
  if (k === 0) return bitAt(presence, i >> 1, j >> 1) === 1;
  if (k === 1) return bitAt(presence, i, j) === 1;
  return true;
}

/** Distance (m) from point (E, N) to rectangle [Emin, Nmin, Emax, Nmax] (0 inside). */
export function distanceToBbox(E: number, N: number, b: readonly [number, number, number, number]): number {
  const dx = E < b[0] ? b[0] - E : E > b[2] ? E - b[2] : 0;
  const dy = N < b[1] ? b[1] - N : N > b[3] ? N - b[3] : 0;
  return Math.hypot(dx, dy);
}
