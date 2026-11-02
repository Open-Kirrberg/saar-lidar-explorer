/**
 * Pure GeoJSON → render-ready vector data (runs in `vectors.worker.ts`, or on the main thread as a
 * fallback). Lines become per-500 m segment buckets with baked heights where the file has them
 * (contract `heights: 'baked'`, [E, N, z]); terrain-sampled heights are filled in later on the
 * main thread (`resampleBucket`). Label points become flat arrays.
 *
 * No three.js / DOM imports — unit-tested in tests/vectorData.test.ts.
 */
import type { ParcelLabelProps } from '../data/manifest';
import { buildBuckets, extractLines } from './drape';
import type { Origin, SegmentBucket } from './drape';
import { parseParcelPoints } from './labels';
import { buildParcelPolygons, parcelPolygonTransferables } from './parcelPolygons';
import type { ParcelPolygonData } from './parcelPolygons';
import { osmStyleOf, parcelStyleOf } from './styles';

export type LineStyleKind = 'osm' | 'parcel';

export interface LineLayerData {
  buckets: SegmentBucket[];
  lineCount: number;
  segmentCount: number;
  /** Segment ends with a baked (file) height. */
  bakedEnds: number;
}

export interface PointLayerData {
  xs: Float64Array;
  zs: Float64Array;
  /** Baked TRUE heights (NaN = not in the file). */
  hs: Float64Array;
  props: ParcelLabelProps[];
}

export interface Timings {
  fetchMs: number;
  parseMs: number;
  buildMs: number;
}

const styleFor = (k: LineStyleKind) => (k === 'osm' ? osmStyleOf : parcelStyleOf);

/** FeatureCollection → buckets (`bucketSize` m, keyed like terrain chunks). Unknown heights → `fallbackH`, `missing`. */
export function buildLineLayer(fc: unknown, origin: Origin, style: LineStyleKind, bucketSize: number, fallbackH: number): LineLayerData {
  const lines = extractLines(fc, origin, styleFor(style));
  const buckets = buildBuckets(lines, () => NaN, bucketSize, fallbackH).filter((b) => b.count > 0);
  let segmentCount = 0;
  let bakedEnds = 0;
  for (const b of buckets) {
    segmentCount += b.count;
    bakedEnds += 2 * b.count - b.sampled;
  }
  return { buckets, lineCount: lines.length, segmentCount, bakedEnds };
}

export function buildPointLayer(fc: unknown, origin: Origin): PointLayerData {
  const pts = parseParcelPoints(fc, origin);
  return {
    xs: Float64Array.from(pts, (p) => p.x),
    zs: Float64Array.from(pts, (p) => p.z),
    hs: Float64Array.from(pts, (p) => p.h),
    props: pts.map((p) => p.props),
  };
}

/** Transferable buffers of a line layer (bucket data + fixed masks). */
export function lineTransferables(d: LineLayerData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const b of d.buckets) {
    out.push(b.data.buffer as ArrayBuffer);
    if (b.fixed) out.push(b.fixed.buffer as ArrayBuffer);
  }
  return out;
}

export function pointTransferables(d: PointLayerData): ArrayBuffer[] {
  return [d.xs.buffer as ArrayBuffer, d.zs.buffer as ArrayBuffer, d.hs.buffer as ArrayBuffer];
}

/** Parse a GeoJSON response body; rejects HTML (Vite's SPA fallback answers 200 for unknown paths). */
export function parseGeoJsonText(text: string): unknown {
  if (!text.trimStart().startsWith('{')) throw new Error('keine GeoJSON-Antwort');
  return JSON.parse(text);
}

// ---- worker protocol ---------------------------------------------------------------------------

export type VectorRequest =
  | { id: number; kind: 'lines'; url: string; origin: Origin; style: LineStyleKind; bucketSize: number; fallbackH: number }
  | { id: number; kind: 'points'; url: string; origin: Origin }
  | { id: number; kind: 'polygons'; url: string };

export type VectorResponse =
  | { id: number; ok: true; kind: 'lines'; data: LineLayerData; timings: Timings; bytes: number }
  | { id: number; ok: true; kind: 'points'; data: PointLayerData; timings: Timings; bytes: number }
  | { id: number; ok: true; kind: 'polygons'; data: ParcelPolygonData; timings: Timings; bytes: number }
  | { id: number; ok: false; error: string };

/** Shared by the worker and the main-thread fallback. */
export async function handleVectorRequest(req: VectorRequest, fetchText: (url: string) => Promise<string>): Promise<{ res: VectorResponse; transfer: ArrayBuffer[] }> {
  try {
    const t0 = performance.now();
    const text = await fetchText(req.url);
    const t1 = performance.now();
    const fc = parseGeoJsonText(text);
    const t2 = performance.now();
    if (req.kind === 'lines') {
      const data = buildLineLayer(fc, req.origin, req.style, req.bucketSize, req.fallbackH);
      const timings = { fetchMs: t1 - t0, parseMs: t2 - t1, buildMs: performance.now() - t2 };
      return { res: { id: req.id, ok: true, kind: 'lines', data, timings, bytes: text.length }, transfer: lineTransferables(data) };
    }
    if (req.kind === 'polygons') {
      const data = buildParcelPolygons(fc);
      const timings = { fetchMs: t1 - t0, parseMs: t2 - t1, buildMs: performance.now() - t2 };
      return { res: { id: req.id, ok: true, kind: 'polygons', data, timings, bytes: text.length }, transfer: parcelPolygonTransferables(data) };
    }
    const data = buildPointLayer(fc, req.origin);
    const timings = { fetchMs: t1 - t0, parseMs: t2 - t1, buildMs: performance.now() - t2 };
    return { res: { id: req.id, ok: true, kind: 'points', data, timings, bytes: text.length }, transfer: pointTransferables(data) };
  } catch (err) {
    return { res: { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
  }
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
