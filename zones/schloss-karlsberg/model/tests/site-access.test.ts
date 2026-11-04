import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '../src/context.ts';
import { E0, N0 } from '../src/frame.ts';
import { pointInPolygon } from '../src/layout/geom.ts';
import { loadSite } from '../src/index.ts';
import { type Entrance, WALK_STEP_MAX, entranceWalkable, segSegDist, siteEntrances, siteWalls } from '../src/site/access.ts';
import { sitePois } from '../src/site/index.ts';
import type { EN, SiteSpec } from '../src/spec.ts';
import { readCatalogue } from './helpers.ts';

// synthetic terrace: local x 0…20, z −20…0 (south edge at z = 0), level 10; the ground around it is 1 m lower
const ring: EN[] = [
  [E0, N0],
  [E0 + 20, N0],
  [E0 + 20, N0 + 20],
  [E0, N0 + 20],
  [E0, N0],
];
const spec = { terrain_features: [{ id: 'T', kind: 'terrace', name: 't', geometry: { type: 'Polygon', coordinates: [ring] }, level: 10, wall_height: 1, confidence: 'low' }] } as unknown as SiteSpec;
const terr = (x: number, z: number) => (x >= 0 && x <= 20 && z <= 0 && z >= -20 ? 10 : 9);
/** Garden-side Durchfahrt in the S edge at x = 10, threshold on the terrace level, facing south (+z). */
const gate: Entrance = { id: 'B/durchfahrt-garden-1', buildingId: 'B', kind: 'durchfahrt', side: 'garden', axis: 1, door: [10, -0.5], out: [0, 1], width: 3.4, threshold_h: 10, foot_d: 0, foot_h: 10 };

describe('siteWalls', () => {
  it('builds retaining walls where the outside drops > 0.6 m (top = level + 0.35)', () => {
    const w = siteWalls(spec, terr, []);
    expect(w.stairs).toEqual([]);
    expect(w.pieces.length).toBeGreaterThan(0);
    expect(w.pieces.every((p) => p.top === 10.35 && p.thick === 0.8)).toBe(true);
    // the S edge is closed: some piece covers x = 10, z = 0
    expect(w.pieces.some((p) => segSegDist([10, -1], [10, 1], [p.x0, p.z0], [p.x1, p.z1]) === 0)).toBe(true);
  });

  it('cuts a gap of width + 0.6 m and adds steps down to the ground in front of a Durchfahrt', () => {
    const w = siteWalls(spec, terr, [gate]);
    expect(w.stairs).toHaveLength(1);
    const s = w.stairs[0];
    expect(s.entranceId).toBe(gate.id);
    expect(s.x).toBeCloseTo(10, 6);
    expect(s.z).toBeCloseTo(0, 6);
    expect(s.width).toBeCloseTo(4.0, 6);
    expect(s.top).toBe(10);
    expect(s.ground).toBe(9);
    expect(s.riser).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(s.steps * s.riser).toBeCloseTo(1, 6);
    // no piece of the S edge reaches into the gap x ∈ [8, 12]
    for (const p of w.pieces.filter((q) => Math.abs(q.z0) < 1e-6 && Math.abs(q.z1) < 1e-6)) {
      expect(Math.max(p.x0, p.x1) <= 8 + 1e-6 || Math.min(p.x0, p.x1) >= 12 - 1e-6).toBe(true);
    }
  });

  it('adds no steps for a portal or a Durchfahrt off the terrace level', () => {
    expect(siteWalls(spec, terr, [{ ...gate, kind: 'portal' }]).stairs).toEqual([]);
    expect(siteWalls(spec, terr, [{ ...gate, threshold_h: 11 }]).stairs).toEqual([]);
  });

  it('builds nothing without terrain (NaN)', () => {
    expect(siteWalls(spec, () => NaN, [gate])).toEqual({ pieces: [], stairs: [] });
  });
});

describe('entranceWalkable', () => {
  it('a wall between the POI and the threshold blocks; the gap stair opens it', () => {
    expect(entranceWalkable(gate, [10, 8], siteWalls(spec, terr, []), terr)).toBe(false);
    expect(entranceWalkable(gate, [10, 8], siteWalls(spec, terr, [gate]), terr)).toBe(true);
  });

  it('a first step above the walk step height blocks (plinth / Freitreppe foot above the ground)', () => {
    const none = { pieces: [], stairs: [] };
    const door: Entrance = { ...gate, kind: 'portal', door: [40, 0], foot_h: 9 + WALK_STEP_MAX + 0.05 };
    expect(entranceWalkable(door, [40, 8], none, terr)).toBe(false);
    expect(entranceWalkable({ ...door, foot_h: 9 + WALK_STEP_MAX - 0.05 }, [40, 8], none, terr)).toBe(true);
    // Freitreppe: the foot lies foot_d in front of the facade; the ground there counts
    const stairs = { ...door, foot_d: 4.7, foot_h: 10 };
    expect(entranceWalkable(stairs, [40, 8], none, (_x, z) => (z < 4 ? 10 : 9))).toBe(false);
    expect(entranceWalkable(stairs, [40, 8], none, () => 10)).toBe(true);
    expect(entranceWalkable(stairs, [40, 8], none, () => NaN)).toBe(true);
  });
});

describe('segSegDist', () => {
  it('is 0 for crossing segments and the gap otherwise', () => {
    expect(segSegDist([0, -1], [0, 1], [-1, 0], [1, 0])).toBe(0);
    expect(segSegDist([0, 0], [1, 0], [0, 2], [1, 2])).toBeCloseTo(2, 9);
    expect(segSegDist([0, 0], [1, 0], [3, 0], [4, 0])).toBeCloseTo(2, 9);
  });
});

describe('catalogue: garden-side Durchfahrten of the arms (TF-03 terrace wall)', () => {
  const { spec: site } = loadSite(readCatalogue() as unknown);
  const level = (id: string) => site.terrain_features.find((f) => f.id === id)!;
  const tf03 = level('TF-03');
  const tf08 = level('TF-08');
  const r03 = (tf03.geometry.coordinates as EN[][])[0];
  const r08 = (tf08.geometry.coordinates as EN[][])[0];
  // fake 1789 terrain: TF-03 at 344.8, TF-08 at 344.06, everything else 340
  const terrain = (x: number, z: number) => {
    const p: EN = [x + E0, N0 - z];
    return pointInPolygon(p, r03) ? tf03.level! : pointInPolygon(p, r08) ? tf08.level! : 340;
  };
  const ctx = { spec: site, lod: 1 as const, terrain, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(site), materials: undefined as never };

  it('KB-B02 garden Durchfahrt gets steps down to TF-08 and is walkable; the end_a Freitreppe off the terrace is not', () => {
    const walls = siteWalls(site, terrain, siteEntrances(site, ctx));
    const st = walls.stairs.find((s) => s.entranceId === 'KB-B02/durchfahrt-garden-11');
    expect(st?.featureId).toBe('TF-03');
    expect(st!.ground).toBeCloseTo(344.06, 2);
    const pois = new Map(sitePois(site, ctx).map((p) => [p.id, p]));
    expect(pois.get('KB-B02/durchfahrt-garden-11')?.walkable).toBe(true);
    expect(pois.get('KB-B02/durchfahrt-court-7')?.walkable).toBe(true);
    expect(pois.get('KB-B02/portal-end_a-1')?.walkable).toBe(false);
  });
});
