/**
 * Terrain inputs for the plans, produced by plans/scripts/terrain.py into plans/data/
 * (git-ignored): DTM crop (Float32, PixelIsArea), contour GeoJSON, hillshade/SLRM JPEGs.
 * All optional: if plans/data is missing, sheets render without terrain and say so.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EN } from '../../model/src/spec.ts';

export const DATA_DIR = resolve(import.meta.dirname, '..', 'data');
export const DTM_ATTRIBUTION = 'DGM1 © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet';

export interface Dtm {
  bbox: [number, number, number, number];
  width: number;
  height: number;
  /** Bilinear height at (E, N) between cell centres; NaN outside / nodata. */
  at(E: number, N: number): number;
}

/** Bilinear sampler over a PixelIsArea grid (cell (c, r) centre at E0 + c + 0.5, N1 − r − 0.5). */
export function makeDtm(bbox: [number, number, number, number], width: number, height: number, data: Float32Array): Dtm {
  return {
    bbox,
    width,
    height,
    at(E, N) {
      const x = E - bbox[0] - 0.5;
      const y = bbox[3] - N - 0.5;
      const c0 = Math.floor(x);
      const r0 = Math.floor(y);
      if (c0 < 0 || r0 < 0 || c0 + 1 >= width || r0 + 1 >= height) return NaN;
      const fx = x - c0;
      const fy = y - r0;
      const v = (c: number, r: number) => data[r * width + c];
      const a = v(c0, r0);
      const b = v(c0 + 1, r0);
      const c = v(c0, r0 + 1);
      const d = v(c0 + 1, r0 + 1);
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    },
  };
}

let dtmCache: Dtm | null | undefined;
export function loadDtm(): Dtm | null {
  if (dtmCache !== undefined) return dtmCache;
  const j = resolve(DATA_DIR, 'dtm-core.json');
  const f = resolve(DATA_DIR, 'dtm-core.f32');
  if (!existsSync(j) || !existsSync(f)) return (dtmCache = null);
  const meta = JSON.parse(readFileSync(j, 'utf8')) as { bbox: [number, number, number, number]; width: number; height: number };
  const buf = readFileSync(f);
  const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return (dtmCache = makeDtm(meta.bbox, meta.width, meta.height, data));
}

export interface ContourSet {
  interval: number;
  index: number;
  lines: { h: number; index: boolean; pts: EN[] }[];
}

export function loadContours(id: string): ContourSet | null {
  const p = resolve(DATA_DIR, `contours-${id}.geojson`);
  if (!existsSync(p)) return null;
  const fc = JSON.parse(readFileSync(p, 'utf8')) as {
    interval: number;
    index: number;
    features: { properties: { h: number; index: boolean }; geometry: { coordinates: EN[] } }[];
  };
  return { interval: fc.interval, index: fc.index, lines: fc.features.map((f) => ({ h: f.properties.h, index: f.properties.index, pts: f.geometry.coordinates })) };
}

export interface Underlay {
  bbox: [number, number, number, number];
  href: string;
}

export function loadUnderlay(kind: 'hillshade' | 'slrm', id: string): Underlay | null {
  const j = resolve(DATA_DIR, `${kind}-${id}.json`);
  const img = resolve(DATA_DIR, `${kind}-${id}.jpg`);
  if (!existsSync(j) || !existsSync(img)) return null;
  const meta = JSON.parse(readFileSync(j, 'utf8')) as { bbox: [number, number, number, number] };
  return { bbox: meta.bbox, href: `data:image/jpeg;base64,${readFileSync(img).toString('base64')}` };
}

/** Profile of the DTM along a polyline of EN points (NaN where unknown). */
export function profile(dtm: Dtm | null, pts: EN[]): number[] {
  return pts.map((p) => (dtm ? dtm.at(p[0], p[1]) : NaN));
}
