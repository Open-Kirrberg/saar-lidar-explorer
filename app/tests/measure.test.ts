import { describe, expect, it } from 'vitest';
import { utmToWgs84, wgs84ToUtm } from '../src/geo';
import {
  groundFactor,
  gridScaleFactor,
  haversineDistance,
  polygonArea,
  polylineLength,
  radiiOfCurvature,
  ringPerimeter,
  ringSelfIntersects,
  signedArea,
} from '../src/measure/geometry';
import {
  computeMetrics,
  fmtArea,
  fmtLength,
  fmtNum,
  fmtSigned,
  measurementsToGeoJSON,
  minVertices,
  summary,
} from '../src/measure/model';
import type { Measurement, Vertex } from '../src/measure/model';
import { chunkKeysAlong, localSlopeDeg, nearestSample, niceTicks, profileStats, samplePolyline, sampleProfile } from '../src/measure/profile';

const deg = (r: number) => (r * 180) / Math.PI;

describe('measure geometry (UTM plane)', () => {
  it('polyline length and ring perimeter', () => {
    const pts = [
      { E: 0, N: 0 },
      { E: 3, N: 4 },
      { E: 3, N: 10 },
    ];
    expect(polylineLength(pts)).toBeCloseTo(11, 12);
    expect(polylineLength(pts.slice(0, 1))).toBe(0);
    expect(ringPerimeter(pts)).toBeCloseTo(11 + Math.hypot(3, 10), 12);
  });

  it('shoelace area at real UTM coordinates (no precision loss), sign by orientation', () => {
    const E = 382198.37;
    const N = 5466099.81;
    const ccw = [
      { E, N },
      { E: E + 10, N },
      { E: E + 10, N: N + 20 },
      { E, N: N + 20 },
    ];
    expect(signedArea(ccw)).toBeCloseTo(200, 9);
    expect(signedArea([...ccw].reverse())).toBeCloseTo(-200, 9);
    expect(polygonArea([...ccw].reverse())).toBeCloseTo(200, 9);
    expect(ringPerimeter(ccw)).toBeCloseTo(60, 9);
    // right triangle 30 × 40 → 600 m²
    expect(polygonArea([{ E, N }, { E: E + 30, N }, { E, N: N + 40 }])).toBeCloseTo(600, 9);
    expect(polygonArea(ccw.slice(0, 2))).toBe(0);
  });

  it('detects a self-intersecting (bow-tie) ring', () => {
    const bow = [
      { E: 0, N: 0 },
      { E: 10, N: 10 },
      { E: 10, N: 0 },
      { E: 0, N: 10 },
    ];
    expect(ringSelfIntersects(bow)).toBe(true);
    expect(ringSelfIntersects([bow[0], bow[2], bow[1], bow[3]])).toBe(false);
  });

  it('UTM scale factor is k0 on the central meridian and matches proj4 west of it', () => {
    expect(gridScaleFactor(500000, 49.3)).toBeCloseTo(0.9996, 12);
    // Numerical k from proj4: grid length of a 0.01° parallel arc / its ellipsoid length ν·cosφ·Δλ.
    const lat = 49.33623;
    const lon = 7.37844;
    const dLon = 0.01;
    const a = wgs84ToUtm(lat, lon);
    const b = wgs84ToUtm(lat, lon + dLon);
    const grid = Math.hypot(b.E - a.E, b.N - a.N);
    const { nu } = radiiOfCurvature(lat);
    const arc = nu * Math.cos((lat * Math.PI) / 180) * ((dLon * Math.PI) / 180);
    const kNum = grid / arc;
    const k = gridScaleFactor((a.E + b.E) / 2, lat);
    expect(Math.abs(k - kNum)).toBeLessThan(3e-6);
    expect(k).toBeGreaterThan(0.99976);
    expect(k).toBeLessThan(0.99979);
  });

  it('ground factor ≈ +0.028 % at Karlsberg (scale + 300 m terrain)', () => {
    const f = groundFactor(382198, 49.336, 300);
    expect(f).toBeGreaterThan(1.00025);
    expect(f).toBeLessThan(1.00031);
  });

  it('UTM length matches Leaflet-style haversine distance within 1 % (acceptance)', () => {
    const A = { E: 381500, N: 5465200 };
    const B = { E: 383700, N: 5467900 };
    const utm = polylineLength([A, B]);
    const a = utmToWgs84(A.E, A.N);
    const b = utmToWgs84(B.E, B.N);
    const hav = haversineDistance(a.lat, a.lon, b.lat, b.lon);
    expect(Math.abs(utm / hav - 1)).toBeLessThan(0.01);
    expect(Math.abs(utm / hav - 1)).toBeLessThan(0.004); // actually ≈ 0.2–0.3 %
  });
});

describe('profile sampling', () => {
  it('samples every ≤ 0.5 m with exact vertices and cumulative distance', () => {
    const s = samplePolyline([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: -0.3 },
    ]);
    expect(s.d.length).toBe(21 + 1);
    expect(s.vertexIndex).toEqual([0, 20, 21]);
    expect(s.x[20]).toBe(10);
    expect(s.d[20]).toBeCloseTo(10, 12);
    expect(s.d[21]).toBeCloseTo(10.3, 12);
    for (let i = 1; i < s.d.length; i++) expect(s.d[i] - s.d[i - 1]).toBeLessThanOrEqual(0.5 + 1e-12);
    // 1.2 m → 3 parts of 0.4 m
    const t = samplePolyline([{ x: 0, z: 0 }, { x: 0, z: 1.2 }]);
    expect(Array.from(t.z)).toEqual([0, 0.4, 0.8, 1.2].map((v, i) => (i === 3 ? 1.2 : expect.closeTo(v, 12))));
    expect(samplePolyline([]).d.length).toBe(0);
    expect(() => samplePolyline([{ x: 0, z: 0 }], 0)).toThrow();
  });

  it('uniform slope: 3D length, Δh, ascent and slope in degrees', () => {
    const p = sampleProfile([{ x: 0, z: 0 }, { x: 10, z: 0 }], (x) => ({ h: 200 + 0.1 * x, level: 0 }));
    const st = profileStats(p.d, p.dtm);
    expect(st.length2d).toBeCloseTo(10, 12);
    expect(st.length3d).toBeCloseTo(10 * Math.sqrt(1.01), 9);
    expect(st.dh).toBeCloseTo(1, 9);
    expect(st.ascent).toBeCloseTo(1, 9);
    expect(st.descent).toBeCloseTo(0, 12);
    expect(st.slopeAvgDeg).toBeCloseTo(deg(Math.atan(0.1)), 6);
    expect(st.slopeMaxDeg).toBeCloseTo(deg(Math.atan(0.1)), 6);
    expect(st.hMin).toBeCloseTo(200, 9);
    expect(st.hMax).toBeCloseTo(201, 9);
    expect(st.hAvg).toBeCloseTo(200.5, 9);
    expect(p.coarse).toBe(0);
    expect(p.dsmCount).toBe(0);
  });

  it('a V-shaped ditch 1 m deep, 4 m wide: depth, position and flank slope', () => {
    // 20 m line across a ditch centred at 10 m: flanks 1:2 (26.57°)
    const ground = (x: number) => 250 - Math.max(0, 1 - Math.abs(x - 10) / 2);
    const p = sampleProfile([{ x: 0, z: 0 }, { x: 20, z: 0 }], (x) => ({ h: ground(x), level: 0 }), (x) => ground(x) + 15);
    const st = profileStats(p.d, p.dtm);
    expect(st.hMax - st.hMin).toBeCloseTo(1, 9);
    expect(st.hMinAt).toBeCloseTo(10, 9);
    expect(st.slopeMaxDeg).toBeCloseTo(deg(Math.atan(0.5)), 6);
    expect(st.dh).toBeCloseTo(0, 12);
    expect(st.ascent).toBeCloseTo(1, 9);
    expect(st.descent).toBeCloseTo(1, 9);
    expect(st.length3d).toBeCloseTo(16 + 2 * Math.hypot(2, 1), 9);
    expect(localSlopeDeg(p.d, p.dtm, 18)).toBeCloseTo(deg(Math.atan(0.5)), 6); // x = 9 m, on the flank
    expect(localSlopeDeg(p.d, p.dtm, 4)).toBeCloseTo(0, 9);
    expect(localSlopeDeg(p.d, p.dtm, 999)).toBeNaN();
    expect(p.dsmCount).toBe(p.d.length);
  });

  it('counts coarse / missing samples and skips NaN in the stats', () => {
    const p = sampleProfile([{ x: 0, z: 0 }, { x: 4, z: 0 }], (x) => (x < 2 ? { h: 100, level: 0 } : x < 3 ? { h: 100, level: 1 } : { h: NaN, level: -1 }));
    expect(p.d.length).toBe(9);
    expect(p.missing).toBe(3); // x = 3, 3.5, 4
    expect(p.coarse).toBe(5); // x = 2, 2.5 (level 1) + 3 missing
    const st = profileStats(p.d, p.dtm);
    expect(st.valid).toBe(6);
    expect(st.length3d).toBeCloseTo(2.5, 12);
    expect(st.dh).toBe(0);
  });

  it('nearestSample, niceTicks, chunkKeysAlong', () => {
    const d = [0, 0.5, 1, 1.5, 2];
    expect(nearestSample(d, 0.7)).toBe(1);
    expect(nearestSample(d, 0.8)).toBe(2);
    expect(nearestSample(d, -5)).toBe(0);
    expect(nearestSample(d, 9)).toBe(4);
    expect(nearestSample([], 1)).toBe(-1);
    expect(niceTicks(0, 97, 4)).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(312.3, 318.9, 4)).toEqual([314, 316, 318]);
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(chunkKeysAlong([1, 499, 501, 1001], [0, 0, 0, 0], (x) => `${Math.floor(x / 500)}_0`)).toEqual(['0_0', '1_0', '2_0']);
  });
});

describe('measurement model', () => {
  const origin = { E0: 381000, N0: 5467000 };
  const flat = { dtmAt: () => ({ h: 300, level: 0 }) };

  it('distance: UTM length, surface length, Δh from the DTM', () => {
    const v: Vertex[] = [
      { E: 382000, N: 5466000, h: 300 },
      { E: 382030, N: 5466040, h: 304 },
    ];
    // Height rises 0.1 m per m to the east (x = E − E0).
    const ramp = { dtmAt: (x: number) => ({ h: 200 + 0.1 * (x - 1000), level: 0 }) };
    const { metrics, profile } = computeMetrics('distance', v, origin, ramp);
    expect(metrics.length_m).toBeCloseTo(50, 9);
    expect(metrics.dh_m).toBeCloseTo(3, 6);
    expect(metrics.length_3d_m).toBeCloseTo(Math.hypot(50, 3), 6);
    expect(metrics.ground_length_m! / metrics.length_m!).toBeCloseTo(metrics.ground_factor, 12);
    expect(metrics.coarse_fraction).toBe(0);
    expect(profile).toBeUndefined();
  });

  it('profile keeps the samples and DSM coverage', () => {
    const v: Vertex[] = [
      { E: 382000, N: 5466000, h: 300 },
      { E: 382000, N: 5466010, h: 300 },
    ];
    const half = { dtmAt: () => ({ h: 300, level: 0 }), dsmAt: (_x: number, z: number) => (5467000 - z < 5466004.9 ? 320 : NaN) };
    const { metrics, profile } = computeMetrics('profile', v, origin, half);
    expect(profile!.d.length).toBe(21);
    expect(metrics.dsm_fraction).toBeCloseTo(10 / 21, 9);
    expect(metrics.slope_max_deg).toBeCloseTo(0, 9);
  });

  it('area: shoelace + perimeter; point: DSM above ground', () => {
    const sq: Vertex[] = [
      { E: 382000, N: 5466000, h: 300 },
      { E: 382050, N: 5466000, h: 301 },
      { E: 382050, N: 5466020, h: 302 },
      { E: 382000, N: 5466020, h: 303 },
    ];
    const a = computeMetrics('area', sq, origin, flat).metrics;
    expect(a.area_m2).toBeCloseTo(1000, 9);
    expect(a.perimeter_m).toBeCloseTo(140, 9);
    expect(a.h_min_m).toBe(300);
    expect(a.self_intersecting).toBeUndefined();
    expect(a.coarse_fraction).toBe(0);
    // Audit overlays-2: corners not from the 1 m DTM are reported as coarse.
    const half = computeMetrics('area', sq, origin, { dtmAt: (x) => ({ h: 300, level: x > 1000 + 25 ? 2 : 0 }) }).metrics;
    expect(half.coarse_fraction).toBe(0.5);
    const p = computeMetrics('point', sq.slice(0, 1), origin, { dtmAt: () => ({ h: 300.25, level: 0 }), dsmAt: () => 322.75 }).metrics;
    expect(p.h_avg_m).toBe(300.25);
    expect(p.dsm_h_m).toBe(322.75);
    expect(p.above_ground_m).toBeCloseTo(22.5, 12);
    expect(minVertices('area')).toBe(3);
    expect(minVertices('point')).toBe(1);
  });

  it('formats German numbers', () => {
    expect(fmtNum(1234.5, 1)).toBe('1.234,5');
    expect(fmtLength(12.345)).toBe('12,35 m');
    expect(fmtLength(1234.6)).toBe('1,235 km');
    expect(fmtLength(NaN)).toBe('–');
    expect(fmtArea(56.78)).toBe('56,8 m²');
    expect(fmtArea(4321)).toBe('4.321 m²');
    expect(fmtArea(12346)).toBe('1,235 ha');
    expect(fmtSigned(-0.4)).toBe('−0,40 m');
    expect(fmtSigned(1.234, 1)).toBe('+1,2 m');
  });

  it('exports WGS84 GeoJSON with E/N/h and metrics; skips unfinished', () => {
    const sq: Vertex[] = [
      { E: 382198, N: 5466099, h: 300 },
      { E: 382248, N: 5466099, h: null },
      { E: 382248, N: 5466119, h: 302 },
    ];
    const mk = (kind: Measurement['kind'], vertices: Vertex[]): Measurement => ({
      id: `id-${kind}`,
      kind,
      created: '2026-11-01T10:00:00.000Z',
      vertices,
      metrics: computeMetrics(kind, vertices, origin, flat).metrics,
    });
    const prof = mk('profile', sq.slice(0, 2));
    prof.profile = computeMetrics('profile', sq.slice(0, 2), origin, flat).profile;
    const pt = { ...mk('point', sq.slice(0, 1)), parcel: 'Homburg, Flur 1, Flurstück 5/2' };
    const fc = measurementsToGeoJSON([mk('area', sq), prof, pt, mk('distance', sq.slice(0, 1))], new Date('2026-11-01T12:00:00Z'));
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBe(3);
    const [area, line, point] = fc.features;
    expect(area.geometry.type).toBe('Polygon');
    const ring = (area.geometry as { coordinates: number[][][] }).coordinates[0];
    expect(ring.length).toBe(4);
    expect(ring[0]).toEqual(ring[3]);
    expect(ring[0][0]).toBeCloseTo(7.37844, 4); // lon of Schloss Karlsberg
    expect(ring[0][1]).toBeCloseTo(49.33623, 4);
    expect(ring[0][2]).toBe(300);
    expect(ring[1].length).toBe(2); // no height → 2D position
    expect(area.properties.vertices_utm).toEqual([
      [382198, 5466099, 300],
      [382248, 5466099, null],
      [382248, 5466119, 302],
    ]);
    expect((area.properties.metrics as Record<string, number>).area_m2).toBe(1000 / 2);
    expect(line.geometry.type).toBe('LineString');
    const prof2 = line.properties.profile as { d_m: number[]; dtm_m: number[] };
    expect(prof2.d_m.length).toBe(101);
    expect(prof2.dtm_m[0]).toBe(300);
    expect(point.geometry).toEqual({ type: 'Point', coordinates: expect.any(Array) });
    expect(point.properties.parcel).toBe('Homburg, Flur 1, Flurstück 5/2');
    expect(point.properties.E).toBe(382198);
    expect(summary(pt)).toBe('300,00 m ü. NN');
    expect(JSON.parse(JSON.stringify(fc))).toEqual(fc);
  });
});

describe('runLimited', () => {
  it('keeps at most `limit` tasks in flight, runs all, survives failures', async () => {
    const { runLimited } = await import('../src/measure/limit');
    let live = 0;
    let peak = 0;
    const done: number[] = [];
    const tasks = Array.from({ length: 10 }, (_, k) => async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1 + (k % 3)));
      live--;
      if (k === 4) throw new Error('boom');
      done.push(k);
    });
    await runLimited(tasks, 3);
    expect(peak).toBe(3);
    expect(done.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9]);
    let started = 0;
    await runLimited([async () => void started++], 3);
    await runLimited([], 3);
    expect(started).toBe(1);
  });
});
