/**
 * Central overview levels `sle-overview-v1` (data contract "Central overview levels"). Pure parse +
 * tolerance; `loadOverview` fetches. Levels ≥ 2 anchored at the global grid; `(i, j)` relative to
 * the overview bbox NW corner.
 */
import type { Bitmap } from './globalGrid';
import { chunkSide, decodeBitmap, isAligned, isGlobalGrid } from './globalGrid';
import type { HeightSource, ImageLayerSource, LayerSource } from './manifest';
import { isAvifPath, parseImageLayer } from './manifest';

export const OVERVIEW_FORMAT = 'sle-overview-v1';

export interface OverviewLevel {
  level: number;
  cellSize: number;
  chunkSize: number;
  size: { width: number; height: number };
  chunks: { nx: number; ny: number };
  presence: Bitmap;
  height: { dtm: HeightSource };
  layers: Record<string, LayerSource>;
  imageLayers: Record<string, ImageLayerSource>;
}

export interface Overview {
  format: typeof OVERVIEW_FORMAT;
  /** Absolute URL of the overview file (paths resolve against it). */
  url: string;
  /** Directory URL (ending in '/') the level paths resolve against. */
  baseUrl: string;
  bbox: [number, number, number, number];
  heightRange: { min: number; max: number };
  /**
   * Revision 3.1 „Overview no-data“: 1 km tiles of `bbox` with real source data (row 0 = north,
   * bit (col, row) = tile `(bbox[0]/1000 + col, bbox[3]/1000 − 1 − row)`). Absent (3.0 file or
   * invalid) → readers take the catalog's owned tiles as the covered set.
   */
  coverage?: Bitmap;
  levels: OverviewLevel[];
  attribution: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Parse an overview. Invalid format/grid/bbox → throws (no levels ≥ 2). Levels: contiguous from
 * level 2 (a list starting elsewhere is rejected as a whole), each with cellSize 2^k, chunkSize
 * 500, exact size / chunks from the bbox, the bbox aligned at its S_k, a valid presence bitmap
 * (w = nx, h = ny) and a terrarium `height.dtm` that is not AVIF; the first malformed level ends
 * the list (valid contiguous prefix).
 */
export function parseOverview(raw: unknown, url: string, warn: (m: string) => void = (m) => console.warn(`[overview] ${m}`)): Overview {
  if (!isObj(raw)) throw new Error('overview: not an object');
  if (raw.format !== OVERVIEW_FORMAT) throw new Error(`overview: format ${String(raw.format)}`);
  if (!isGlobalGrid(raw.grid)) throw new Error('overview: grid is not sle-grid-25832-v1');
  const b = raw.bbox;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum) || !(b[0] < b[2]) || !(b[1] < b[3])) throw new Error('overview: bbox');
  const bbox = b as [number, number, number, number];
  const W = bbox[2] - bbox[0];
  const H = bbox[3] - bbox[1];
  const hr = raw.heightRange as { min?: unknown; max?: unknown } | undefined;
  const heightRange = isObj(hr) && isNum(hr.min) && isNum(hr.max) ? { min: hr.min, max: hr.max } : { min: 0, max: 1000 };
  let coverage: Bitmap | undefined;
  if (raw.coverage !== undefined) {
    const expect = { w: W / 1000, h: H / 1000 };
    const c = Number.isInteger(expect.w) && Number.isInteger(expect.h)
      ? decodeBitmap(raw.coverage, expect, (m) => warn(`coverage ${m}; ignored (covered set = owned tiles)`))
      : (warn('coverage: bbox not on the 1 km grid; ignored'), null);
    if (c) coverage = c;
  }
  const levels: OverviewLevel[] = [];
  const list = Array.isArray(raw.levels) ? raw.levels : [];
  for (let n = 0; n < list.length; n++) {
    const e = list[n] as Record<string, unknown> | null;
    const k = 2 + n;
    const bad = (why: string) => warn(`levels[${n}] (k=${k}): ${why}; coarser levels ignored`);
    if (!isObj(e)) { bad('not an object'); break; }
    if (e.level !== k) { bad(`level ${String(e.level)} ≠ ${k}`); break; }
    const f = 2 ** k;
    if (e.cellSize !== f) { bad(`cellSize ${String(e.cellSize)} ≠ ${f}`); break; }
    if (e.chunkSize !== 500) { bad('chunkSize ≠ 500'); break; }
    if (!isAligned(bbox[0], bbox[1], W, H, chunkSide(k))) { bad(`bbox not aligned at ${chunkSide(k)} m`); break; }
    const size = { width: W / f, height: H / f };
    const chunks = { nx: W / chunkSide(k), ny: H / chunkSide(k) };
    const sz = e.size as { width?: unknown; height?: unknown } | undefined;
    if (!isObj(sz) || sz.width !== size.width || sz.height !== size.height) { bad('size mismatch'); break; }
    const ch = e.chunks as { nx?: unknown; ny?: unknown } | undefined;
    if (!isObj(ch) || ch.nx !== chunks.nx || ch.ny !== chunks.ny) { bad('chunks mismatch'); break; }
    const presence = decodeBitmap(e.presence, { w: chunks.nx, h: chunks.ny }, (m) => bad(`presence ${m}`));
    if (!presence) break;
    const dtm = (e.height as { dtm?: Record<string, unknown> } | undefined)?.dtm;
    if (!isObj(dtm) || typeof dtm.path !== 'string' || !dtm.path || dtm.encoding !== 'terrarium' || isAvifPath(dtm.path)) {
      bad('height.dtm missing, not terrarium or AVIF');
      break;
    }
    const layers: Record<string, LayerSource> = {};
    const imageLayers: Record<string, ImageLayerSource> = {};
    const lv = isObj(e.layers) ? e.layers : {};
    if (isObj(lv.vat)) {
      const v = lv.vat;
      if (typeof v.path === 'string' && v.path && v.encoding === 'u8' && isNum(v.min) && isNum(v.max)) {
        layers.vat = {
          path: v.path.replaceAll('{level}', String(k)), encoding: 'u8', min: v.min, max: v.max,
          ...(typeof v.label_de === 'string' ? { label_de: v.label_de } : {}),
          ...(v.lossy === true ? { lossy: true } : {}),
        };
      } else warn(`levels[${n}].layers.vat malformed, ignored`);
    }
    if (isObj(lv.ortho)) {
      const img = parseImageLayer('ortho', lv.ortho, k);
      if (img) imageLayers.ortho = img;
    }
    levels.push({
      level: k, cellSize: f, chunkSize: 500, size, chunks, presence,
      height: { dtm: { path: dtm.path.replaceAll('{level}', String(k)), encoding: 'terrarium', apron: isNum(dtm.apron) ? dtm.apron : 1 } },
      layers, imageLayers,
    });
  }
  const baseUrl = url.replace(/[^/]*$/, '');
  return { format: OVERVIEW_FORMAT, url, baseUrl, bbox, heightRange, ...(coverage ? { coverage } : {}), levels, attribution: typeof raw.attribution === 'string' ? raw.attribution : '' };
}

export async function loadOverview(url: string, fetchFn: typeof fetch = fetch): Promise<Overview> {
  const res = await fetchFn(url, { cache: 'no-cache', mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`overview: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trimStart().startsWith('{')) throw new Error('overview: not JSON');
  return parseOverview(JSON.parse(text), res.url || url);
}
