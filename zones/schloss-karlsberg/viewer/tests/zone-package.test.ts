// Zone package (scripts/export-zone.ts, scripts/zone/*, docs/zone-contract.md): the footprint, portal and spawn computed
// from the catalogue match the committed zone.json; terrain u16 round trip through the viewer's decoder; index merge;
// budget arithmetic. Needs no generated data.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSite } from '@model/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, makeLayoutFn } from '@model/context.ts';
import { EYE } from '../src/controls.ts';
import { STAR_ATTRIBUTION } from '../src/starCatalogue.ts';
import { decodeHeights, loadTerrain } from '../src/terrain.ts';
import { CASTLE_CROP, CASTLE_FOOTPRINT, ENTRY_COURT_ID, PORTAL_RADIUS_M, WALK_EYE_M, castleEntry, castleFootprint, round1 } from '../../scripts/zone/castle.ts';
import { type EN, type FootprintGeom, distToRing, inCrop, pointInRing, ringIsSimple, signedArea, zoneFootprint } from '../../scripts/zone/footprint.ts';
import {
  BUDGET_LIMITS,
  budgetProblems,
  computeBudget,
  decodeU16,
  encodeU16,
  mergeZoneIndex,
  packageTerrainMeta,
  textureGpuBytes,
  TRIANGLES_WAIVER,
  u16LE,
  zoneBbox,
} from '../../scripts/zone/package.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const { spec } = loadSite(JSON.parse(readFileSync(resolve(ROOT, 'model/catalogue.json'), 'utf8')));
const zone = JSON.parse(readFileSync(resolve(ROOT, 'zone.json'), 'utf8'));

describe('castle footprint, portal and spawn (from the catalogue)', () => {
  const fp = castleFootprint(spec, makeLayoutFn(spec, { roofVariant: DEFAULT_BUILD_OPTIONS.roofVariant }));
  const ring = fp.ring.map(([E, N]): EN => [round1(E), round1(N)]);
  const entry = castleEntry(spec, WALK_EYE_M, ring);

  it('is a simple ring of ≤ 64 vertices fully inside the terrain crop', () => {
    expect(ring.length).toBeGreaterThanOrEqual(3);
    expect(ring.length).toBeLessThanOrEqual(CASTLE_FOOTPRINT.maxVertices);
    expect(ringIsSimple(ring)).toBe(true);
    expect(signedArea(ring)).toBeGreaterThan(0);
    for (const p of ring) expect(inCrop(p, CASTLE_CROP, 0)).toBe(true);
    expect(fp.minClearance).toBeGreaterThanOrEqual(10);
  });

  it('matches the committed zone.json (run pnpm run export:zone -- --update-source after catalogue changes)', () => {
    expect(zone.footprint).toEqual(ring);
    expect(zone.portals[0]).toMatchObject({ E: entry.portal.E, N: entry.portal.N, facing_deg: entry.portal.facing_deg, radius_m: PORTAL_RADIUS_M, h: null });
    expect(zone.spawns[zone.portals[0].spawn]).toEqual({ ...entry.spawn, mode: 'gehen' });
  });

  it('puts the spawn inside, on the axis at Ehrenhof eye height, and the portal on the outer edge facing west', () => {
    const court = spec.terrain_features.find((f) => f.id === ENTRY_COURT_ID)!;
    expect(pointInRing([entry.spawn.E, entry.spawn.N], ring)).toBe(true);
    expect(pointInRing([entry.portal.E, entry.portal.N], ring)).toBe(false);
    expect(distToRing([entry.portal.E, entry.portal.N], ring)).toBeLessThan(1);
    expect(entry.portalOffset).toBeGreaterThanOrEqual(60);
    expect(entry.portal.facing_deg).toBeCloseTo((spec.palace_grid.u_azimuth_grid_deg + 180) % 360, 9);
    expect(entry.spawn.heading_deg).toBe(spec.palace_grid.u_azimuth_grid_deg);
    expect(entry.spawn.h).toBeCloseTo(court.level! + EYE, 6);
    expect(Math.hypot(entry.portal.E - entry.spawn.E, entry.portal.N - entry.spawn.N)).toBeLessThan(PORTAL_RADIUS_M);
  });

  it('uses the walk eye height of the viewer', () => {
    expect(WALK_EYE_M).toBe(EYE);
  });
});

describe('zoneFootprint (synthetic)', () => {
  const crop = { west: 0, south: 0, east: 1000, north: 1000 };
  const square = (e: number, n: number, s: number): FootprintGeom => ({ kind: 'ring', pts: [[e, n], [e + s, n], [e + s, n + s], [e, n + s]] });

  it('joins parts too far apart for the closing with a corridor into one ring that contains them', () => {
    const geoms = [square(100, 100, 60), square(700, 650, 60), { kind: 'point', pts: [[400, 800]] } as FootprintGeom];
    const r = zoneFootprint(geoms, { buffer: 20, close: 50, cell: 5, inset: 5, maxVertices: 24, crop });
    expect(r.bridges.length).toBeGreaterThanOrEqual(1);
    expect(r.ring.length).toBeLessThanOrEqual(24);
    expect(ringIsSimple(r.ring)).toBe(true);
    for (const g of geoms) for (const p of g.pts) expect(pointInRing(p, r.ring)).toBe(true);
  });

  it('clips at the crop minus inset', () => {
    const r = zoneFootprint([square(-50, 400, 200)], { buffer: 20, close: 0, cell: 5, inset: 5, maxVertices: 16, crop });
    for (const p of r.ring) expect(inCrop(p, crop, 5 - 1e-9)).toBe(true);
  });
});

describe('terrain u16', () => {
  const h = Float32Array.from([240.084, 255.555, NaN, 365.823, 300.001, 241.0049]);

  it('round-trips within 5 mm, NaN as nodata, offset = floor(min)', () => {
    const { data, enc } = encodeU16(h);
    expect(enc).toEqual({ dtype: 'uint16', offset: 240, scale: 0.01, nodata: 65535 });
    expect(data[2]).toBe(65535);
    for (const back of [decodeU16(data, enc), decodeHeights(u16LE(data).buffer as ArrayBuffer, h.length, enc)]) {
      expect(Number.isNaN(back[2])).toBe(true);
      for (let i = 0; i < h.length; i++) if (i !== 2) expect(Math.abs(back[i]! - h[i]!)).toBeLessThanOrEqual(0.005 + 1e-4);
    }
  });

  it('refuses ranges that do not fit and wrong file sizes', () => {
    expect(() => encodeU16(Float32Array.from([0, 700]))).toThrow(/does not fit/);
    expect(() => decodeHeights(new ArrayBuffer(10), 6, { dtype: 'uint16', offset: 0, scale: 0.01, nodata: 65535 })).toThrow(/expected 12/);
    expect(() => decodeHeights(new ArrayBuffer(10), 6)).toThrow(/expected 24/);
  });

  it('builds a 1789-only package meta', () => {
    const dev = {
      grid: { cols: 2, rows: 3 },
      ground: { cols: 1, rows: 1, counts: {}, counts2025: {}, tag: '1789 (ground.u8): x; 2025 (ground2025.u8): y' },
      files: { dtm2025: 'dtm2025.f32', dtm1789: 'dtm1789.f32', ground: 'ground.u8', ground2025: 'ground2025.u8' },
    };
    const m = packageTerrainMeta(dev, encodeU16(h).enc, [240.084, 365.823]) as typeof dev & { encoding: unknown; h_range: unknown };
    expect(m.files).toEqual({ dtm1789: 'dtm1789.u16', ground: 'ground.u8' });
    expect(m.ground).not.toHaveProperty('counts2025');
    expect(m.ground.tag).toBe('1789 (ground.u8): x');
    expect(m.encoding).toEqual({ dtm1789: { dtype: 'uint16', offset: 240, scale: 0.01, nodata: 65535 } });
    expect(dev.files).toHaveProperty('dtm2025'); // input untouched
  });
});

describe('loadTerrain', () => {
  afterEach(() => vi.unstubAllGlobals());
  const grid = { west: 0, north: 2, east: 3, south: 0, cell: 1, cols: 3, rows: 2 };
  const heights = Float32Array.from([250, 250.5, 251, 252.25, NaN, 260]);
  const ground = Uint8Array.from([1, 2, 3, 4, 5, 6]);
  const serve = (files: Record<string, BodyInit>) => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const name = url.slice(url.lastIndexOf('/') + 1);
      return name in files ? new Response(files[name]) : new Response('nope', { status: 404 });
    });
    return urls;
  };

  it('loads the quantised package without fetching 2025 grids', async () => {
    const { data, enc } = encodeU16(heights);
    const meta = { grid, ground: { cell: 1, cols: 3, rows: 2, classes: {} }, files: { dtm1789: 'dtm1789.u16', ground: 'ground.u8' }, encoding: { dtm1789: enc }, attribution: '', h_range: [250, 260] };
    const urls = serve({ 'meta.json': JSON.stringify(meta), 'dtm1789.u16': u16LE(data), 'ground.u8': ground });
    const t = await loadTerrain('/zones/schloss-karlsberg/terrain/');
    expect(urls.sort()).toEqual(['/zones/schloss-karlsberg/terrain/dtm1789.u16', '/zones/schloss-karlsberg/terrain/ground.u8', '/zones/schloss-karlsberg/terrain/meta.json']);
    expect(t.h1789[3]).toBeCloseTo(252.25, 4);
    expect(Number.isNaN(t.h1789[4])).toBe(true);
    expect(t.h2025).toBe(t.h1789);
    expect(t.ground2025).toBe(t.ground1789);
    await expect(loadTerrain('/z/', { with2025: true })).rejects.toThrow(/no dtm2025/);
  });

  it('still loads the viewer float32 terrain, with 2025 on request', async () => {
    const h25 = heights.map((v) => v - 1);
    const meta = { grid, ground: { cell: 1, cols: 3, rows: 2, classes: {} }, files: { dtm2025: 'dtm2025.f32', dtm1789: 'dtm1789.f32', ground: 'ground.u8' }, attribution: '', h_range: [250, 260] };
    const urls = serve({ 'meta.json': JSON.stringify(meta), 'dtm1789.f32': new Uint8Array(heights.buffer), 'dtm2025.f32': new Uint8Array(h25.buffer), 'ground.u8': ground });
    const t = await loadTerrain('./terrain/');
    expect(urls).not.toContain('./terrain/dtm2025.f32');
    expect(t.h1789[5]).toBe(260);
    const t25 = await loadTerrain('./terrain/', { with2025: true });
    expect(t25.h2025[5]).toBe(259);
  });

  it('throws a clear error on HTTP errors', async () => {
    serve({ 'meta.json': JSON.stringify({ grid, ground: {}, files: { dtm1789: 'missing.u16', ground: 'ground.u8' } }), 'ground.u8': ground });
    await expect(loadTerrain('/t/')).rejects.toThrow('terrain: /t/missing.u16 → HTTP 404');
  });
});

describe('zones/index.json merge', () => {
  const entry = { id: 'schloss-karlsberg', bboxEN: [[381240, 5464575], [383295, 5467070]] as [EN, EN] };

  it('creates, replaces and keeps other zones', () => {
    expect(mergeZoneIndex(null, entry)).toEqual({ format: 'sle-zones-v1', zones: [entry] });
    const bakery = { id: 'bakery', bboxEN: [[1, 2], [3, 4]], extra: 'kept' };
    const old = { format: 'sle-zones-v1', zones: [{ id: 'schloss-karlsberg', bboxEN: [[0, 0], [1, 1]] }, bakery, { id: 'zeta', bboxEN: [[5, 5], [6, 6]] }] };
    const m = mergeZoneIndex(old, entry);
    expect(m.zones.map((z) => z.id)).toEqual(['bakery', 'schloss-karlsberg', 'zeta']);
    expect(m.zones[0]).toEqual(bakery);
    expect(m.zones[1]).toEqual(entry);
  });

  it('never clobbers a file that is not a zone index', () => {
    expect(() => mergeZoneIndex({ format: 'something-else', zones: [] }, entry)).toThrow(/refusing/);
    expect(() => mergeZoneIndex([], entry)).toThrow(/refusing/);
  });

  it('bboxEN covers footprint and portals in whole metres', () => {
    expect(zoneBbox([[10.4, 20.6], [30.2, 25]], [{ E: 5.5, N: 40.1 }])).toEqual([[5, 20], [31, 41]]);
    const b = zoneBbox(zone.footprint, zone.portals);
    for (const p of [...zone.footprint, ...zone.portals.map((q: { E: number; N: number }) => [q.E, q.N])]) {
      expect(p[0]).toBeGreaterThanOrEqual(b[0][0]);
      expect(p[1]).toBeLessThanOrEqual(b[1][1]);
    }
  });
});

describe('budget', () => {
  it('adds first-view files + module, all files + module, and RGBA8 + mips per texture', () => {
    const files = [
      { path: 'terrain/dtm1789.u16', bytes: 1000, firstView: true },
      { path: 'textures/a/diff.jpg', bytes: 300, firstView: true, texture: { w: 1024, h: 1024 } },
      { path: 'textures/a/arm.jpg', bytes: 100, firstView: false, texture: { w: 512, h: 512 } },
    ];
    expect(textureGpuBytes(1024, 1024)).toBe(5_592_405);
    expect(computeBudget(files, 50, 7)).toEqual({ downloadBytes: 1350, totalBytes: 1450, triangles: 7, textureBytesGpu: 5_592_405 + 1_398_101 });
  });

  it('flags every limit of the contract and the module cap', () => {
    const over = { downloadBytes: 30_000_001, totalBytes: 120_000_001, triangles: 1_500_001, textureBytesGpu: 128_000_001 };
    expect(budgetProblems(over, 1_500_001)).toHaveLength(5);
    expect(budgetProblems(BUDGET_LIMITS, 1_500_000)).toEqual([]);
  });

  it('the committed zone.json declares a budget within the limits, triangles only under the ADR 0033 waiver', () => {
    expect(budgetProblems(zone.budget, 0, TRIANGLES_WAIVER)).toEqual([]);
    expect(budgetProblems(zone.budget, 0).every((p) => p.startsWith('budget.triangles '))).toBe(true);
  });

  it('the triangle waiver only lifts the triangle limit, up to its ceiling', () => {
    const at = { ...BUDGET_LIMITS, triangles: TRIANGLES_WAIVER };
    expect(budgetProblems(at, 0, TRIANGLES_WAIVER)).toEqual([]);
    expect(budgetProblems({ ...at, triangles: TRIANGLES_WAIVER + 1 }, 0, TRIANGLES_WAIVER)).toHaveLength(1);
    expect(budgetProblems({ ...at, totalBytes: 120_000_001 }, 0, TRIANGLES_WAIVER)).toEqual(['budget.totalBytes 120000001 > 120000000']);
  });
});

describe('zone.json attribution', () => {
  it('names every source once, without ";"', () => {
    const a: string[] = zone.attribution;
    expect(a).toContain(STAR_ATTRIBUTION);
    for (const s of ['Lageplan 2006', 'LVGL-SL', 'Poly Haven']) expect(a.some((x) => x.includes(s))).toBe(true);
    for (const x of a) expect(x).not.toContain(';');
    expect(zone.evidence.sources_de.length).toBeLessThanOrEqual(10);
    expect(zone.summary_de.length).toBeLessThanOrEqual(300);
  });
});
