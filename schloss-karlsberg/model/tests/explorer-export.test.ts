import { describe, expect, it } from 'vitest';
import { E0, N0 } from '../src/frame.ts';
import {
  ATTRIBUTION_ENTRIES,
  attributionString,
  bboxENFromLocal,
  buildReconIndex,
  confCode,
  footprintsGeoJson,
  gridSampler,
  minSampler,
  minUnderRing,
  shortSources,
  skirtBottom,
  skirtWalls,
} from '../src/explorer/export.ts';
import type { EN } from '../src/spec.ts';

describe('confCode', () => {
  it('maps low/med/high to 0/1/2', () => {
    expect([confCode('low'), confCode('med'), confCode('high')]).toEqual([0, 1, 2]);
  });
});

describe('gridSampler (PixelIsArea, row 0 = north)', () => {
  // 3 × 3 grid, west 381000, north 5465003, 1 m cells: value = 10·row + col
  const g = { west: 381000, north: 5465003, cell: 1, cols: 3, rows: 3 };
  const h = Float32Array.from([0, 1, 2, 10, 11, 12, 20, 21, 22]);
  const s = gridSampler(g, h);
  it('hits cell centres exactly', () => {
    // cell (row 1, col 2): E = 381002.5, N = 5465001.5 -> local x 2.5, z −1.5
    expect(s(2.5, -1.5)).toBeCloseTo(12, 6);
    expect(s(0.5, -2.5)).toBeCloseTo(0, 6);
  });
  it('interpolates and returns NaN outside', () => {
    expect(s(1.0, -2.0)).toBeCloseTo(5.5, 6);
    expect(s(0.2, -1.5)).toBeNaN();
    expect(s(100, 0)).toBeNaN();
  });
  it('minSampler ignores NaN', () => {
    const a = () => NaN;
    const b = () => 3;
    expect(minSampler(a, b)(0, 0)).toBe(3);
    expect(minSampler(() => 5, b)(0, 0)).toBe(3);
    expect(minSampler(a, a)(0, 0)).toBeNaN();
  });
});

describe('minUnderRing / skirtBottom', () => {
  const ring: EN[] = [
    [E0 + 10, N0 + 10],
    [E0 + 30, N0 + 10],
    [E0 + 30, N0 + 20],
    [E0 + 10, N0 + 20],
    [E0 + 10, N0 + 10],
  ];
  it('finds a pit inside the footprint', () => {
    // a 1 m pit at E0+20, N0+15 (local x 20, z −15)
    const s = (x: number, z: number) => (Math.hypot(x - 20, z + 15) < 0.6 ? 340 : 345);
    expect(minUnderRing(ring, s)).toBe(340);
    expect(skirtBottom(340)).toBe(339.5);
  });
  it('samples a band just outside the walls', () => {
    // terrain drops only 1 m outside the south wall (N < N0 + 10)
    const s = (_x: number, z: number) => (-z < 9.5 ? 342 : 345);
    expect(minUnderRing(ring, s)).toBe(342);
    expect(minUnderRing(ring, s, 1, 0)).toBe(345);
  });
  it('is orientation independent and NaN when nothing is sampled', () => {
    const s = (_x: number, z: number) => (-z < 9.5 ? 342 : 345);
    expect(minUnderRing(ring.slice().reverse(), s)).toBe(342);
    expect(minUnderRing(ring, () => NaN)).toBeNaN();
    expect(skirtBottom(NaN)).toBeNaN();
  });
});

describe('skirtWalls', () => {
  // unit square in local x/z (CCW in E/N: x = E, z = −N)
  const sq: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, -10],
    [0, -10],
  ];
  for (const [name, r] of [
    ['CCW', sq],
    ['CW', sq.slice().reverse()],
  ] as const) {
    it(`${name}: 8 triangles, outward normals, outward-facing winding`, () => {
      const { position, normal } = skirtWalls(r, 330, 345);
      expect(position.length).toBe(4 * 6 * 3);
      const cx = 5;
      const cz = -5;
      for (let t = 0; t < position.length / 9; t++) {
        const p = position.slice(t * 9, t * 9 + 9);
        const n = normal.slice(t * 9, t * 9 + 3);
        const mx = (p[0] + p[3] + p[6]) / 3;
        const mz = (p[2] + p[5] + p[8]) / 3;
        // normal points away from the centre
        expect(n[0] * (mx - cx) + n[2] * (mz - cz)).toBeGreaterThan(0);
        // geometric normal (B−A)×(C−A) agrees with the stored normal
        const ux = p[3] - p[0];
        const uy = p[4] - p[1];
        const uz = p[5] - p[2];
        const vx = p[6] - p[0];
        const vy = p[7] - p[1];
        const vz = p[8] - p[2];
        const gx = uy * vz - uz * vy;
        const gz = ux * vy - uy * vx;
        expect(gx * n[0] + gz * n[2]).toBeGreaterThan(0);
        for (let k = 1; k < 9; k += 3) expect([330, 345]).toContain(p[k]);
      }
    });
  }
  it('is empty for an inverted height range', () => {
    expect(skirtWalls(sq, 345, 330).position.length).toBe(0);
  });
});

describe('index helpers', () => {
  it('shortSources: ≤ 3 short labels without ";"', () => {
    const s = shortSources([
      'research/03-lidar-site-analysis.md + lidar_features.geojson (DGM1 SL 2025)',
      'http://www.nhp-2000.de/homburg-im-bild/x.html',
      'research/03-lidar-site-analysis.md; again',
      'HMS/Matzerath 2022 video kfnE6HdXmVo (secondary, (c), massing reference only) — research/04',
      'research/07-period-sources.md: LP06 = 2006 Lageplan',
    ]);
    expect(s).toEqual(['Recherche research/03', 'Web: nhp-2000.de', 'HMS/Matzerath 2022 (nur Maße, ©)']);
    expect(shortSources(undefined)).toEqual([]);
    expect(shortSources(['x'.repeat(200)])[0].length).toBeLessThanOrEqual(70);
  });
  it('attributionString joins with "; " and keeps entries free of ";"', () => {
    expect(attributionString(['a; b', ' c '])).toBe('a, b; c');
    for (const e of ATTRIBUTION_ENTRIES) expect(e).not.toContain(';');
  });
  it('bboxENFromLocal flips z to N', () => {
    expect(bboxENFromLocal([[[100, 300, -50], [200, 360, 20]]])).toEqual([
      [E0 + 100, N0 - 20],
      [E0 + 200, N0 + 50],
    ]);
  });
  it('buildReconIndex fills the sle-recon-v1 header', () => {
    const idx = buildReconIndex({ anchorEN: [382263.04, 5466125.96], buildings: [], boxes: [[[0, 0, 0], [1, 1, 1]]], generated: '2026-11-01T00:00:00Z', catalogueVersion: 2 });
    expect(idx.format).toBe('sle-recon-v1');
    expect(idx.origin).toEqual({ E0: 381000, N0: 5465000 });
    expect(idx.anchor).toEqual({ E: 382263, N: 5466126, enterRadius_m: 300 });
    expect(idx.files).toEqual({ model: 'buildings.glb', footprints: 'footprints.geojson' });
    expect(idx.viewer.url).toBe('http://localhost:5260/');
    expect(idx.disclaimer_de).toContain('Schauen, nicht graben');
    expect(idx.attribution.split('; ').length).toBe(ATTRIBUTION_ENTRIES.length);
  });
  it('footprintsGeoJson closes rings and names the CRS', () => {
    const fc = footprintsGeoJson([{ id: 'KB-B01', name_de: 'X', confidence: 'med', ring: [[1, 2], [3, 2], [3, 4]] }]);
    expect(fc.crs.properties.name).toContain('25832');
    expect(fc.features[0].geometry.coordinates[0]).toEqual([[1, 2], [3, 2], [3, 4], [1, 2]]);
    expect(fc.features[0].properties).toEqual({ id: 'KB-B01', name_de: 'X', confidence: 'med' });
  });
});
