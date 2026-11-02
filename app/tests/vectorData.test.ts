import { describe, expect, it } from 'vitest';
import { SEG_STRIDE, bucketDist2, buildBuckets, densifyLineH, extractLines, resampleBucket } from '../src/vectors/drape';
import { parseParcelPoints } from '../src/vectors/labels';
import { SegmentIndex, declutter } from '../src/vectors/spatial';
import { osmStyleOf } from '../src/vectors/styles';
import { buildLineLayer, buildPointLayer, handleVectorRequest, parseGeoJsonText } from '../src/vectors/vectorData';

const origin = { E0: 382000, N0: 5466000 };
const plane = (x: number, z: number) => 300 + 0.01 * x - 0.02 * z;

describe('baked heights (contract heights: baked)', () => {
  it('densifyLineH interpolates z and propagates NaN', () => {
    const d = densifyLineH([0, 0, 4, 0, 8, 0], [10, 14, NaN], 2);
    expect(d.xz).toEqual([0, 0, 2, 0, 4, 0, 6, 0, 8, 0]);
    expect(d.h.slice(0, 3)).toEqual([10, 12, 14]);
    expect(Number.isNaN(d.h[3])).toBe(true);
    expect(Number.isNaN(d.h[4])).toBe(true);
  });

  it('extractLines keeps z per vertex only when a coordinate has one', () => {
    const fc = {
      features: [
        { properties: { kind: 'road' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000, 301.25], [382001, 5466000, 301.5]] } },
        { properties: { kind: 'road' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000], [382001, 5466000]] } },
        { properties: { kind: 'road' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000, null], [382001, 5466000, 299]] } },
      ],
    };
    const [a, b, c] = extractLines(fc, origin, osmStyleOf, 2);
    expect(Array.from(a.h!)).toEqual([301.25, 301.5]);
    expect(b.h).toBeUndefined();
    expect(Number.isNaN(c.h![0])).toBe(true);
    expect(c.h![1]).toBe(299);
  });

  it('buildBuckets uses baked z where finite, samples the rest, and resample keeps baked values', () => {
    const fc = {
      features: [
        { properties: { kind: 'path' }, geometry: { type: 'LineString', coordinates: [[382010, 5465990, 123.45], [382012, 5465990, 'x'], [382014, 5465990, 124]] } },
      ],
    };
    const lines = extractLines(fc, origin, osmStyleOf, 2);
    const [b] = buildBuckets(lines, plane, 500, 0);
    expect(b.count).toBe(2);
    expect(b.sampled).toBe(2); // the middle vertex (shared by both segments) is sampled
    expect(Array.from(b.fixed!)).toEqual([1, 0, 0, 1]);
    expect(b.data[1]).toBeCloseTo(123.45, 4);
    expect(b.data[4]).toBeCloseTo(plane(12, 10), 4);
    expect(b.data[SEG_STRIDE + 4]).toBe(124);
    // terrain refines: baked values stay, sampled ones change
    resampleBucket(b, () => 500, 0);
    expect(b.data[1]).toBeCloseTo(123.45, 4);
    expect(b.data[4]).toBe(500);
    expect(b.data[SEG_STRIDE + 1]).toBe(500);
    expect(b.data[SEG_STRIDE + 4]).toBe(124);
    expect(b.hMin).toBeCloseTo(123.45, 4);
    expect(b.hMax).toBe(500);
  });

  it('fully baked buckets need no terrain sampling', () => {
    const fc = { features: [{ properties: { kind: 'road' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000, 1], [382003, 5466000, 4]] } }] };
    const d = buildLineLayer(fc, origin, 'osm', 500, -1);
    expect(d.segmentCount).toBe(2);
    expect(d.bakedEnds).toBe(4);
    expect(d.buckets[0].sampled).toBe(0);
    expect(d.buckets[0].missing).toBe(0);
  });

  it('non-baked layers come out of the worker step with missing heights (fallback) to resample', () => {
    const fc = { features: [{ properties: { kind: 'road' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000], [382002, 5466000]] } }] };
    const d = buildLineLayer(fc, origin, 'osm', 500, -7);
    expect(d.buckets[0].missing).toBe(2);
    expect(d.buckets[0].data[1]).toBe(-7);
    expect(resampleBucket(d.buckets[0], plane, -7)).toBe(0);
  });

  it('label points carry baked z (NaN when absent)', () => {
    const fc = {
      features: [
        { geometry: { type: 'Point', coordinates: [382001, 5465999, 310.12] }, properties: { text: '12/3' } },
        { geometry: { type: 'Point', coordinates: [382002, 5465998] }, properties: { text: '13' } },
      ],
    };
    const pts = parseParcelPoints(fc, origin);
    expect(pts[0].h).toBe(310.12);
    expect(Number.isNaN(pts[1].h)).toBe(true);
    const flat = buildPointLayer(fc, origin);
    expect(Array.from(flat.xs)).toEqual([1, 2]);
    expect(Array.from(flat.zs)).toEqual([1, 2]);
    expect(flat.props.map((p) => p.text)).toEqual(['12/3', '13']);
  });
});

describe('bucket distance + segment index from records', () => {
  it('bucketDist2 is 0 inside and squared distance outside', () => {
    const b = { xMin: 0, xMax: 500, zMin: -500, zMax: 0 };
    expect(bucketDist2(b, 250, -250)).toBe(0);
    expect(bucketDist2(b, 503, -250)).toBe(9);
    expect(bucketDist2(b, -3, 4)).toBe(25);
  });

  it('SegmentIndex.fromRecords matches the polyline constructor', () => {
    const fc = { features: [{ properties: { kind: 'road' }, geometry: { type: 'LineString', coordinates: [[382010, 5465950], [382010, 5466050]] } }] };
    const lines = extractLines(fc, origin, osmStyleOf, 2);
    const buckets = buildBuckets(lines, plane, 500, 0);
    const a = new SegmentIndex(lines.map((l) => l.xz), 25);
    const b = SegmentIndex.fromRecords(buckets, SEG_STRIDE, 25);
    expect(b.size).toBe(a.size);
    for (const idx of [a, b]) {
      expect(idx.crosses(0, 0, 20, 0)).toBe(true);
      expect(idx.crosses(0, 0, 5, 0)).toBe(false);
    }
  });
});

describe('declutter', () => {
  it('keeps the first of overlapping boxes, in priority order', () => {
    const keep = declutter([
      { x: 100, y: 100, w: 30, h: 13 },
      { x: 110, y: 104, w: 30, h: 13 }, // overlaps #0
      { x: 200, y: 100, w: 30, h: 13 },
      { x: 131, y: 100, w: 30, h: 13 }, // 31 px right of #0: touches within pad 2 → dropped
      { x: 100, y: 120, w: 30, h: 13 }, // 20 px below: free
    ]);
    expect(keep).toEqual([true, false, true, false, true]);
  });

  it('handles boxes across grid cells and non-finite positions', () => {
    const keep = declutter(
      [
        { x: 63, y: 63, w: 20, h: 10 },
        { x: 66, y: 66, w: 20, h: 10 },
        { x: NaN, y: 0, w: 20, h: 10 },
      ],
      0,
      64,
    );
    expect(keep).toEqual([true, false, false]);
  });

  it('is linear-ish for a few hundred labels', () => {
    const boxes = Array.from({ length: 400 }, (_, k) => ({ x: (k * 37) % 1200, y: Math.floor(k / 30) * 9, w: 40, h: 13 }));
    const t0 = performance.now();
    const keep = declutter(boxes);
    expect(performance.now() - t0).toBeLessThan(50);
    // no two kept boxes overlap
    const kept = boxes.filter((_, k) => keep[k]);
    for (let i = 0; i < kept.length; i++)
      for (let j = i + 1; j < kept.length; j++) {
        const a = kept[i];
        const b = kept[j];
        expect(Math.abs(a.x - b.x) * 2 < a.w + b.w + 4 && Math.abs(a.y - b.y) * 2 < a.h + b.h + 4).toBe(false);
      }
  });
});

describe('worker request handling', () => {
  it('rejects HTML (SPA fallback) and reports errors per request', async () => {
    expect(() => parseGeoJsonText('<!doctype html>')).toThrow(/GeoJSON/);
    const { res } = await handleVectorRequest({ id: 3, kind: 'points', url: 'x', origin }, async () => '<html>');
    expect(res).toEqual({ id: 3, ok: false, error: 'keine GeoJSON-Antwort' });
  });

  it('returns buckets + transferables for lines', async () => {
    const text = JSON.stringify({ features: [{ properties: { kind: 'road' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000, 5], [382004, 5466000, 9]] } }] });
    const { res, transfer } = await handleVectorRequest(
      { id: 1, kind: 'lines', url: 'x', origin, style: 'osm', bucketSize: 500, fallbackH: 0 },
      async () => text,
    );
    expect(res.ok).toBe(true);
    if (!res.ok || res.kind !== 'lines') throw new Error('bad');
    expect(res.data.segmentCount).toBe(2);
    expect(res.bytes).toBe(text.length);
    expect(transfer.length).toBe(2); // data + fixed mask of one bucket
  });
});
