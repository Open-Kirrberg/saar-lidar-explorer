/**
 * Pure codec for `sle-pts-v1` point tiles (docs/data-contract.md "Point clouds"). No three/DOM.
 *
 * The app never converts records to floats on the CPU: the record body (offset 16, stride 10) is
 * uploaded unchanged as one interleaved vertex buffer. three.js derives the GL type of an
 * interleaved buffer from its typed array, so the whole body is viewed as a Uint16Array (5 u16 per
 * record): x, y, h, agl (i16 reinterpreted as u16), and cls | intensity << 8 (bytes 8/9). The
 * vertex shader undoes the reinterpretation (see PointMaterial.ts). Assumes a little-endian host
 * (every realistic browser platform); the file is little-endian.
 */
import { SLEP_HEADER_BYTES, SLEP_MAGIC, SLEP_RECORD_BYTES, SLEP_VERSION, parseSlepHeader } from '../data/manifest';

/** u16 words per record. */
export const SLEP_WORDS = SLEP_RECORD_BYTES / 2;

export interface SlepTile {
  count: number;
  /** Minimum true height of the tile's points (m, DHHN2016). */
  hBase: number;
  /** Record body as u16 words (length 5·count), a view on the fetched buffer (no copy). */
  words: Uint16Array;
}

/** Validate the header (throws on a malformed buffer) and view the body without copying. */
export function decodeSlep(buf: ArrayBuffer): SlepTile {
  const { count, hBase } = parseSlepHeader(buf);
  return { count, hBase, words: new Uint16Array(buf, SLEP_HEADER_BYTES, count * SLEP_WORDS) };
}

/** One record in metres, relative to the tile's lower-left corner (dE east, dN north). */
export interface SlepPoint {
  dE: number;
  dN: number;
  /** True height (m). */
  h: number;
  /** Height above the 1 m DTM (m, exaggeration-free). */
  agl: number;
  cls: number;
  intensity: number;
}

/** Signed value of the i16 `agl` field seen as u16 (GPU view) → cm. */
export const aglFromWord = (w: number): number => (w >= 32768 ? w - 65536 : w);

export function readSlepPoint(t: SlepTile, k: number): SlepPoint {
  const o = k * SLEP_WORDS;
  const w = t.words;
  return {
    dE: w[o] / 100,
    dN: w[o + 1] / 100,
    h: t.hBase + w[o + 2] / 100,
    agl: aglFromWord(w[o + 3]) / 100,
    cls: w[o + 4] & 0xff,
    intensity: w[o + 4] >> 8,
  };
}

/** Points per LAS class code among the first `n` records (default all). */
export function slepClassCounts(t: SlepTile, n = t.count): Map<number, number> {
  const out = new Map<number, number>();
  const w = t.words;
  for (let k = 0, m = Math.min(n, t.count); k < m; k++) {
    const c = w[k * SLEP_WORDS + 4] & 0xff;
    out.set(c, (out.get(c) ?? 0) + 1);
  }
  return out;
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * Encode points (metres relative to the tile corner, TRUE heights) into a `sle-pts-v1` tile.
 * Used by the fixture generator and tests; the pipeline has its own (Python) writer. Points whose
 * height exceeds hBase + 655.35 m are dropped (contract). Order is kept (the caller shuffles).
 */
export function encodeSlep(points: readonly SlepPoint[]): ArrayBuffer {
  let hMin = Infinity;
  for (const p of points) if (p.h < hMin) hMin = p.h;
  const hBase = points.length ? Math.floor(hMin * 100) / 100 : 0;
  const f32Base = Math.fround(hBase);
  const kept = points.filter((p) => Math.round((p.h - f32Base) * 100) <= 65535);
  const buf = new ArrayBuffer(SLEP_HEADER_BYTES + SLEP_RECORD_BYTES * kept.length);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, SLEP_MAGIC.charCodeAt(i));
  dv.setUint16(4, SLEP_VERSION, true);
  dv.setUint16(6, 0, true);
  dv.setUint32(8, kept.length, true);
  dv.setFloat32(12, hBase, true);
  kept.forEach((p, k) => {
    const o = SLEP_HEADER_BYTES + k * SLEP_RECORD_BYTES;
    dv.setUint16(o, clampInt(p.dE * 100, 0, 65535), true);
    dv.setUint16(o + 2, clampInt(p.dN * 100, 0, 65535), true);
    dv.setUint16(o + 4, clampInt((p.h - f32Base) * 100, 0, 65535), true);
    dv.setInt16(o + 6, clampInt(p.agl * 100, -32767, 32767), true);
    dv.setUint8(o + 8, clampInt(p.cls, 0, 255));
    dv.setUint8(o + 9, clampInt(p.intensity, 0, 255));
  });
  return buf;
}
