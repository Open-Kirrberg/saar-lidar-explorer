import { describe, expect, it } from 'vitest';
import {
  SEG_STRIDE,
  buildBuckets,
  densifyLine,
  displayY,
  extractLines,
  lineParts,
  resampleBucket,
  toLocal,
} from '../src/vectors/drape';
import { formatParcel, parseParcelPoints } from '../src/vectors/labels';
import { PointIndex, SegmentIndex, findParcelLabel, segmentsIntersect } from '../src/vectors/spatial';
import { PARCEL_STYLE, STYLES, osmStyleOf } from '../src/vectors/styles';

const origin = { E0: 382000, N0: 5466000 };

describe('drape: frame', () => {
  it('maps UTM to x = E − E0, z = −(N − N0) in float64', () => {
    expect(toLocal(382150.25, 5466210.75, origin)).toEqual({ x: 150.25, z: -210.75 });
    // centimetre precision survives the subtraction even for large eastings
    const p = toLocal(382000.01, 5466000.01, origin);
    expect(p.x).toBeCloseTo(0.01, 9);
    expect(p.z).toBeCloseTo(-0.01, 9);
  });

  it('extracts LineString / MultiLineString / Polygon rings and skips bad features', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'road' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000], [382001, 5466000]] } },
        { type: 'Feature', properties: { kind: 'path' }, geometry: { type: 'MultiLineString', coordinates: [[[382010, 5466010], [382010, 5466011]], [[382020, 5466020], [382021, 5466020]]] } },
        { type: 'Feature', properties: { kind: 'unknown' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000], [382001, 5466000]] } },
        { type: 'Feature', properties: { kind: 'water' }, geometry: { type: 'Point', coordinates: [382000, 5466000] } },
        { type: 'Feature', properties: { kind: 'rail' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000], ['x', 1]] } },
        { type: 'Feature', properties: { kind: 'track' }, geometry: null },
      ],
    };
    const lines = extractLines(fc, origin, osmStyleOf, 2);
    expect(lines).toHaveLength(3);
    expect(Array.from(lines[0].xz)).toEqual([0, -0, 1, -0]);
    expect(STYLES[lines[0].style].key).toBe('road');
    expect(Array.from(lines[1].xz)).toEqual([10, -10, 10, -11]);
    expect(STYLES[lines[2].style].key).toBe('path');
    expect(lineParts({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] })).toHaveLength(1);
    expect(extractLines({ nope: true }, origin, osmStyleOf)).toEqual([]);
  });
});

describe('drape: densify', () => {
  it('splits long segments into ≤ maxSeg pieces, keeps original vertices', () => {
    const out = densifyLine([0, 0, 10, 0, 10, 3], 2);
    // 10 m → 5 pieces, 3 m → 2 pieces
    expect(out.length / 2).toBe(1 + 5 + 2);
    for (let k = 2; k < out.length; k += 2) {
      expect(Math.hypot(out[k] - out[k - 2], out[k + 1] - out[k - 1])).toBeLessThanOrEqual(2 + 1e-9);
    }
    expect(out.slice(10, 12)).toEqual([10, 0]);
    expect(out.slice(-2)).toEqual([10, 3]);
  });

  it('leaves already-dense lines unchanged (exactly 2 m stays one piece)', () => {
    expect(densifyLine([0, 0, 2, 0, 3.5, 0], 2)).toEqual([0, 0, 2, 0, 3.5, 0]);
  });

  it('extractLines densifies too', () => {
    const fc = { features: [{ properties: { kind: 'track' }, geometry: { type: 'LineString', coordinates: [[382000, 5466000], [382000, 5466009]] } }] };
    const [l] = extractLines(fc, origin, osmStyleOf, 2);
    expect(l.xz.length / 2).toBe(6); // 9 m → 5 pieces
    expect(l.xz[l.xz.length - 1]).toBeCloseTo(-9, 12);
  });
});

describe('drape: buckets + heights', () => {
  // Plane h(x, z) = 300 + 0.1·x − 0.2·z, defined only for x < 500 (chunk 0 "loaded")
  const plane = (x: number, z: number) => 300 + 0.1 * x - 0.2 * z;
  const partial = (x: number, z: number) => (x < 500 ? plane(x, z) : NaN);

  it('stores start/end/style with TRUE heights per vertex, bucketed by midpoint chunk', () => {
    const lines = [
      { xz: Float64Array.from([10, -10, 12, -10, 14, -10]), style: 1 },
      { xz: Float64Array.from([499, -600, 501, -600]), style: 2 }, // midpoint x = 500 → bucket 1_1
    ];
    const buckets = buildBuckets(lines, plane, 500, 0);
    const b00 = buckets.find((b) => b.key === '0_0')!;
    const b11 = buckets.find((b) => b.key === '1_1')!;
    expect(b00.count).toBe(2);
    expect(Array.from(b00.data.slice(0, SEG_STRIDE))).toEqual([10, plane(10, -10), -10, 12, plane(12, -10), -10, 1].map(Math.fround));
    expect(b00.data[SEG_STRIDE + 1]).toBe(Math.fround(plane(12, -10))); // shared vertex height
    expect(b11.count).toBe(1);
    expect(b11.i).toBe(1);
    expect(b11.j).toBe(1);
    expect(b00.hMin).toBeCloseTo(plane(10, -10), 4);
    expect(b00.hMax).toBeCloseTo(plane(14, -10), 4);
    expect([b00.xMin, b00.xMax, b00.zMin, b00.zMax]).toEqual([10, 14, -10, -10]);
  });

  it('marks unknown heights as missing with a fallback, and resamples them later', () => {
    const lines = [{ xz: Float64Array.from([498, -10, 500, -10, 502, -10]), style: 0 }];
    const buckets = buildBuckets(lines, partial, 500, 250);
    const b0 = buckets.find((b) => b.key === '0_0')!;
    const b1 = buckets.find((b) => b.key === '1_0')!;
    expect(b0.missing).toBe(1); // segment 498→500: end at x = 500 unknown
    expect(b1.missing).toBe(2); // segment 500→502: both ends unknown
    expect(b1.data[4]).toBe(250);
    expect(b1.hMin).toBe(Infinity);
    expect(resampleBucket(b1, plane, 250)).toBe(0);
    expect(b1.data[4]).toBeCloseTo(plane(502, -10), 3);
    expect(b1.hMax).toBeCloseTo(plane(502, -10), 3);
  });

  it('displayY uses the shared exaggeration formula', () => {
    expect(displayY(310, 300, 3)).toBe(330);
    expect(displayY(290, 300, 1)).toBe(290);
  });
});

describe('spatial', () => {
  it('PointIndex returns nearest within radius, honouring accept + max', () => {
    const xs = Float64Array.from([0, 50, 120, -30, 400]);
    const zs = Float64Array.from([0, 0, 0, 40, 0]);
    const idx = new PointIndex(xs, zs, 100);
    expect(idx.nearest(10, 0, 130)).toEqual([0, 1, 3, 2]);
    expect(idx.nearest(10, 0, 130, 2)).toEqual([0, 1]);
    expect(idx.nearest(10, 0, 130, 2, (k) => k !== 0)).toEqual([1, 3]);
    expect(idx.nearest(1000, 0, 50)).toEqual([]);
  });

  it('PointIndex.nearest3d uses camera height: high cameras see fewer/no points', () => {
    // Points on flat ground y = 0 at x = 0, 100, 200, 290.
    const idx = new PointIndex(Float64Array.from([0, 100, 200, 290]), Float64Array.from([0, 0, 0, 0]), 100);
    const y0 = () => 0;
    expect(idx.nearest3d(0, 10, 0, 300, y0)).toEqual([0, 1, 2, 3]);
    // 250 m up: only points with hypot(dx, 250) <= 300 → dx <= 165.8
    expect(idx.nearest3d(0, 250, 0, 300, y0)).toEqual([0, 1]);
    // 800 m up: nothing within 300 m although all are within 300 m horizontally
    expect(idx.nearest(0, 0, 300)).toHaveLength(4);
    expect(idx.nearest3d(0, 800, 0, 300, y0)).toEqual([]);
    // non-finite heights dropped, max + accept honoured, ordered by 3D distance
    expect(idx.nearest3d(0, 10, 0, 300, (k) => (k === 1 ? NaN : 0))).toEqual([0, 2, 3]);
    expect(idx.nearest3d(0, 10, 0, 300, y0, 2, (k) => k !== 0)).toEqual([1, 2]);
    // a hill label (y = 240) next to a valley camera at 250 is nearer in 3D than a flat one
    expect(idx.nearest3d(150, 250, 0, 300, (k) => (k === 3 ? 240 : 0))[0]).toBe(3);
    expect(idx.nearest3d(150, 250, 0, 300, (k) => (k === 3 ? 240 : 0))).toHaveLength(4);
  });

  it('segmentsIntersect handles crossing, disjoint and touching', () => {
    expect(segmentsIntersect(0, 0, 2, 2, 0, 2, 2, 0)).toBe(true);
    expect(segmentsIntersect(0, 0, 1, 0, 0, 1, 1, 1)).toBe(false);
    expect(segmentsIntersect(0, 0, 1, 0, 1, 0, 1, 1)).toBe(true);
  });

  it('findParcelLabel picks the label in the same parcel, not the nearest across a boundary', () => {
    // Two parcels split by the boundary x = 10 (densified line). Labels at x = 12 (right) and x = 0 (left).
    const boundary = densifyLine([10, -50, 10, 50], 2);
    const seg = new SegmentIndex([boundary], 25);
    const labels = new PointIndex(Float64Array.from([12, 0]), Float64Array.from([0, 0]), 50);
    expect(findParcelLabel(8, 0, labels, seg, 60)).toBe(1); // nearest (x=12) is across the boundary
    expect(findParcelLabel(11, 0, labels, seg, 60)).toBe(0);
    expect(findParcelLabel(8, 0, labels, seg, 5)).toBe(-1); // left label 8 m away > 5 m
  });
});

describe('parcel labels', () => {
  it('parses points to the local frame and formats like the WFS label', () => {
    const fc = {
      features: [
        { geometry: { type: 'Point', coordinates: [382100, 5466200] }, properties: { text: '12/4', flstkennz: '0512340030001200040000', gemarkung: 'Kirrberg', flur: '3', lage: 'Am Karlsberg' } },
        { geometry: { type: 'Point', coordinates: [382100, 5466200] }, properties: { text: '' } },
        { geometry: { type: 'LineString', coordinates: [] }, properties: { text: '1' } },
      ],
    };
    const pts = parseParcelPoints(fc, origin);
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBe(100);
    expect(pts[0].z).toBe(-200);
    expect(formatParcel(pts[0].props)).toBe('Kirrberg, Flur 3, Flurstück 12/4 („Am Karlsberg“)');
    expect(formatParcel({ text: '7', flstkennz: '', gemarkung: '', flur: 'Flur 22' })).toBe('Flur 22, Flurstück 7');
    // RLP parcels have no Flur; the pipeline emits "Flur 0" — must not look like a real Flur.
    expect(formatParcel({ text: '1847/2', flstkennz: '', gemarkung: 'Bechhofen', flur: 'Flur 0' })).toBe('Bechhofen, Flurstück 1847/2');
    expect(formatParcel({ text: '5', flstkennz: '', gemarkung: 'X', flur: '000' })).toBe('X, Flurstück 5');
    expect(formatParcel({ text: '5', flstkennz: '', gemarkung: 'X', flur: '010' })).toBe('X, Flur 10, Flurstück 5');
  });

  it('parcel style is a valid style index', () => {
    expect(STYLES[PARCEL_STYLE].key).toBe('parcel');
    expect(STYLES.length).toBeLessThanOrEqual(8);
  });
});
