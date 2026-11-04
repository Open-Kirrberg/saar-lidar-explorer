import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { E0, N0, gridFrame } from '../src/frame.ts';
import { buildingFrame, enToST, sideFacing, sidePoint, stToEN, stToLocal, stToObject } from '../src/layout/footprint.ts';
import { centroid, convexHull, minAreaRect, signedArea } from '../src/layout/geom.ts';
import { resolveCourtToward } from '../src/layout/site.ts';
import { PLINTH_EMBED, entranceStorey, inferStoreyKind, levelAt, storeyStack } from '../src/layout/storeys.ts';
import type { EN, RingEN } from '../src/spec.ts';
import { readCatalogueV1 } from './helpers.ts';

const { spec } = loadSite(readCatalogueV1());
const grid = gridFrame(spec.palace_grid);

/** Rectangle in the palace grid -> EN ring (CCW, closed). */
function gridRect(u0: number, u1: number, v0: number, v1: number): RingEN {
  const r: EN[] = [grid.toEN(u0, v0), grid.toEN(u1, v0), grid.toEN(u1, v1), grid.toEN(u0, v1)];
  return [...r, r[0]];
}

function rotY(theta: number, v: { x: number; y: number; z: number }) {
  return { x: v.x * Math.cos(theta) + v.z * Math.sin(theta), y: v.y, z: -v.x * Math.sin(theta) + v.z * Math.cos(theta) };
}

describe('geometry', () => {
  it('hull and min-area rectangle of a rotated rectangle', () => {
    const ring = gridRect(-10, 30, -5, 5);
    expect(convexHull(ring)).toHaveLength(4);
    const r = minAreaRect(ring);
    expect(r.length).toBeCloseTo(40, 6);
    expect(r.width).toBeCloseTo(10, 6);
    const [cu, cv] = grid.toUV(...(r.centre as EN));
    expect(cu).toBeCloseTo(10, 6);
    expect(cv).toBeCloseTo(0, 6);
  });
});

describe('buildingFrame', () => {
  it('orients s along the long axis and t towards the court', () => {
    // a wing N of the Ehrenhof: long axis along u, court (origin) to the south (−v)
    const f = buildingFrame(gridRect(-30, 30, 25, 40), { courtToward: grid.origin });
    expect(f.shape).toBe('rect');
    expect(f.length).toBeCloseTo(60, 6);
    expect(f.width).toBeCloseTo(15, 6);
    // court normal = −v (az 170.5)
    expect(f.sides.court.normalAzimuth).toBeCloseTo(170.5, 6);
    expect(f.sides.garden.normalAzimuth).toBeCloseTo(350.5, 6);
    // (s, t) right-handed: s = t rotated clockwise
    expect(f.sDir[0]).toBeCloseTo(f.tDir[1], 12);
    expect(f.sDir[1]).toBeCloseTo(-f.tDir[0], 12);
  });

  it('sides run CCW, p0 = left end seen from outside, normals outward', () => {
    const f = buildingFrame(gridRect(0, 40, 0, 12), { courtToward: grid.toEN(20, -50) });
    const order = ['garden', 'end_b', 'court', 'end_a'] as const;
    for (let i = 0; i < 4; i++) {
      const a = f.sides[order[i]];
      const b = f.sides[order[(i + 1) % 4]];
      expect(a.p1[0]).toBeCloseTo(b.p0[0], 9);
      expect(a.p1[1]).toBeCloseTo(b.p0[1], 9);
      // outward normal = tangent rotated clockwise
      expect(a.normal[0]).toBeCloseTo(a.tangent[1], 12);
      expect(a.normal[1]).toBeCloseTo(-a.tangent[0], 12);
      // the side midpoint pushed outwards leaves the footprint
      const m = sidePoint(f, a.name, a.length / 2, -1);
      expect(Math.abs(m[0]) > f.length / 2 || Math.abs(m[1]) > f.width / 2).toBe(true);
    }
    expect(signedArea([f.sides.garden.p0, f.sides.end_b.p0, f.sides.court.p0, f.sides.end_a.p0])).toBeGreaterThan(0);
    expect(sideFacing(f, f.sides.court.normalAzimuth + 10)).toBe('court');
  });

  it('round-trips EN <-> ST and agrees with the three.js group transform (< 1 mm)', () => {
    const cdl = spec.buildings.find((b) => b.id === 'KB-B01')!;
    const f = buildingFrame(cdl.footprint!, { courtToward: resolveCourtToward(spec, cdl.court_toward) });
    for (const p of cdl.footprint!) {
      const st = enToST(f, p);
      const back = stToEN(f, st);
      expect(Math.abs(back[0] - p[0])).toBeLessThan(1e-3);
      expect(Math.abs(back[1] - p[1])).toBeLessThan(1e-3);
      // group: position originLocal, rotation.y = rotationY, child at stToObject(s, t, h)
      const o = stToObject(st[0], st[1], 350);
      const r = rotY(f.rotationY, o);
      const world = { x: r.x + f.originLocal.x, y: r.y, z: r.z + f.originLocal.z };
      const direct = stToLocal(f, st[0], st[1], 350);
      expect(world.x).toBeCloseTo(direct.x, 6);
      expect(world.z).toBeCloseTo(direct.z, 6);
      expect(world.x).toBeCloseTo(p[0] - E0, 3);
      expect(world.z).toBeCloseTo(-(p[1] - N0), 3);
    }
  });

  it('frames the Corps de logis as 78 x 18 m with the court side facing W (az ≈ 260.5)', () => {
    const cdl = spec.buildings.find((b) => b.id === 'KB-B01')!;
    const f = buildingFrame(cdl.footprint!, { courtToward: resolveCourtToward(spec, cdl.court_toward) });
    expect(f.length).toBeCloseTo(77.9, 1);
    expect(f.width).toBeCloseTo(18.0, 1);
    expect(f.sides.court.normalAzimuth).toBeCloseTo(260.5, 0);
    const [u, v] = grid.toUV(...f.centreEN);
    expect(u).toBeCloseTo(37.2, 1);
    expect(v).toBeCloseTo(1.65, 1);
  });

  it('detects round footprints (Rotunde) and keeps polygons (Herzogsterrassen)', () => {
    const rot = spec.buildings.find((b) => b.id === 'KB-B13')!;
    const f = buildingFrame(rot.footprint!);
    expect(f.shape).toBe('round');
    expect(f.radius!).toBeCloseTo(14, 0);
    const ter = spec.buildings.find((b) => b.id === 'KL-B43')!;
    expect(buildingFrame(ter.footprint!).shape).toBe('polygon');
  });

  it('canonical orientation without a court point: +s azimuth in [0, 180)', () => {
    const f = buildingFrame(gridRect(0, 40, 0, 12));
    expect(f.azimuthS).toBeGreaterThanOrEqual(0);
    expect(f.azimuthS).toBeLessThan(180);
    expect(f.azimuthS).toBeCloseTo(80.5, 6);
  });

  it('resolveCourtToward uses the nearest point of a line feature', () => {
    const b = spec.buildings.find((x) => x.id === 'KB-B25')!;
    const c = centroid(b.footprint!) as EN;
    const p = resolveCourtToward(spec, 'TF-10', c);
    expect(Math.hypot(p[0] - c[0], p[1] - c[1])).toBeLessThan(40);
  });
});

describe('storeyStack', () => {
  const cdl = spec.buildings.find((b) => b.id === 'KB-B01')!;

  it('gives the CdL floor levels of research/05 §e', () => {
    const s = storeyStack(cdl);
    expect(s.levels.map((l) => +l.floor_h.toFixed(2))).toEqual([344.8, 346.0, 350.8]);
    expect(s.eaves_h).toBeCloseTo(356.4, 9);
    expect(s.eaves_h).toBeCloseTo(cdl.roof.eaves_h!, 9);
    expect(s.floors.map((l) => l.index)).toEqual([1, 2]);
    expect(s.levels.map((l) => l.row)).toEqual([null, 'ground', 'upper']);
    // EG ceiling = Beletage floor − CDL build-up 0.5
    expect(s.levels[1].ceiling_h).toBeCloseTo(350.3, 9);
    expect(s.levels[2].ceiling_h).toBeCloseTo(356.4, 9);
    expect(entranceStorey(s)).toBe(1);
    expect(levelAt(s, 352)?.index).toBe(2);
  });

  it('extends the plinth to below the lowest terrain', () => {
    const s = storeyStack(cdl);
    expect(s.plinth.bottom_h).toBeCloseTo(cdl.ground_dtm!.min - PLINTH_EMBED, 9);
    expect(s.plinth.extension).toBeCloseTo(344.8 - 343.95 + PLINTH_EMBED, 9);
    const s2 = storeyStack(cdl, { groundMin: 346 });
    expect(s2.plinth.bottom_h).toBeCloseTo(344.8 - PLINTH_EMBED, 9);
  });

  it('eaves = base_h + Σ storeys for every placed building with a roof eaves_h', () => {
    for (const b of spec.buildings) {
      if (b.base_h === null || b.roof.eaves_h === undefined || !b.storeys.length) continue;
      expect(storeyStack(b).eaves_h).toBeCloseTo(b.roof.eaves_h, 2);
    }
  });

  it('infers storey kinds', () => {
    expect(inferStoreyKind({ name: 'Sockel / Souterrain (cellar windows)', height: 1.2 })).toBe('plinth');
    expect(inferStoreyKind({ name: 'hohes Kellergeschoss', height: 5.5 })).toBe('basement');
    expect(inferStoreyKind({ name: 'Heuboden / Kniestock', height: 1.2 })).toBe('kneewall');
    expect(inferStoreyKind({ name: 'Gartenmauer', height: 2.5 })).toBe('wall');
    expect(inferStoreyKind({ name: 'Mezzanin', height: 3 })).toBe('mezzanine');
    expect(inferStoreyKind({ name: 'Beletage', height: 5.6 })).toBe('floor');
    expect(inferStoreyKind({ name: 'x', height: 1, kind: 'wall' })).toBe('wall');
  });

  it('throws for unplaced buildings', () => {
    expect(() => storeyStack(spec.buildings.find((b) => b.id === 'UP-01')!)).toThrow();
  });
});
