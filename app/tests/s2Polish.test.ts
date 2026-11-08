import { describe, expect, it } from 'vitest';
import { applyCatalogStatus, levelBaseUrl, parseLeaderboard } from '../src/catalog/leaderboard';
import { placeHintAt } from '../src/catalog/placeHint';
import { parseCatalog } from '../src/data/catalog';
import type { PlacesData } from '../src/places/placesData';
import { COVERAGE_EDGE, COVERAGE_FADE_END, COVERAGE_SINK_LO, coverageAt, coverageGrid, coverageHaze } from '../src/terrain/coverage';
import { addCoverageUniforms, createChunkMaterial, createSharedUniforms } from '../src/terrain/TerrainMaterial';
import type { ChunkUniforms } from '../src/terrain/TerrainMaterial';
import { twoPlaceCatalog } from './fixtures/v3';

const CAT_URL = 'https://open-kirrberg.github.io/orte-katalog/catalog.json';
const quiet = () => {};
const rect = { E0: 380000, N0: 5460000, W: 6000, H: 4000 };

describe('coverage mask (catalog mode edge)', () => {
  it('one texel per owned tile, row 0 = south; tiles outside the rectangle and bad ids ignored', () => {
    const g = coverageGrid(['380_5460', '381_5460', '380_5463', '379_5460', '386_5460', 'nope', '380_5460'], rect);
    expect([g.w, g.h, g.count]).toEqual([6, 4, 3]);
    expect(g.data[0]).toBe(255); // 380_5460: col 0, row 0 (south)
    expect(g.data[1]).toBe(255);
    expect(g.data[3 * 6]).toBe(255); // 380_5463: north row
    expect(g.data[2]).toBe(0);
  });

  it('bilinear value: 1 inside a covered block, 0.5 on its edge towards an uncovered tile, 0 a tile away', () => {
    const g = coverageGrid(['380_5460', '381_5460', '380_5461', '381_5461'], rect);
    // world x = E − E0, z = −(N − N0)
    expect(coverageAt(g, 1000, -1000)).toBeCloseTo(1); // shared corner of the four covered tiles
    expect(coverageAt(g, 2000, -1000)).toBeCloseTo(0.5); // east edge of the block (tile edge)
    expect(coverageAt(g, 2500, -1000)).toBeCloseTo(0); // centre of the uncovered tile east of it
    expect(coverageAt(g, 1500, -500)).toBeCloseTo(1);
    expect(coverageAt(g, 1900, -1000)).toBeGreaterThan(0.5);
  });

  it('haze: none from FADE_END inwards, full at and beyond the tile edge; sink starts outside the edge', () => {
    expect(coverageHaze(1)).toBe(0);
    expect(coverageHaze(COVERAGE_FADE_END)).toBe(0);
    expect(coverageHaze(COVERAGE_EDGE)).toBe(1);
    expect(coverageHaze(0)).toBe(1);
    const mid = coverageHaze((COVERAGE_EDGE + COVERAGE_FADE_END) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(COVERAGE_SINK_LO).toBeLessThan(COVERAGE_EDGE);
  });

  it('single-AOI shaders stay unchanged: COVERAGE is defined only with the coverage uniforms', () => {
    const chunk = {} as ChunkUniforms;
    const plain = createSharedUniforms(200, 500);
    const m0 = createChunkMaterial(plain, chunk);
    expect(m0.fragmentShader).not.toMatch(/^#define COVERAGE/m); // the #ifdef COVERAGE blocks compile away
    expect(m0.vertexShader).not.toMatch(/^#define COVERAGE/m);
    const cov = createSharedUniforms(200, 500);
    addCoverageUniforms(cov, coverageGrid(['380_5460'], rect), { width: rect.W, height: rect.H });
    const m1 = createChunkMaterial(cov, chunk);
    expect(m1.fragmentShader).toMatch(/^#define COVERAGE/m);
    expect(m1.vertexShader).toMatch(/^#define COVERAGE/m);
    expect(m1.uniforms.uCoverageSize.value.toArray()).toEqual([6000, 4000]);
  });
});

describe('catalog leaderboard', () => {
  const lbUrl = 'https://open-kirrberg.github.io/orte-katalog/saarland/manifest.json';
  const raw = {
    version: 1,
    kind: 'stats-only',
    stats: { format: 'sle-stats-v1', url: 'stats/places.json', geometry: 'stats/places.geojson', places: 3, label_de: 'Gemeinden im Vergleich', level: 'gemeinde' },
    stats_levels: { format: 'sle-stats-levels-v1', levels: [{ level: 'gemeinde', aoi: 'saarland', label_de: 'Gemeinden' }, { level: 'ortsteil', aoi: 'overall', label_de: 'Ortsteile' }] },
  };

  it('parses stats + levels; level AOIs resolve next to the leaderboard directory', () => {
    const lb = parseLeaderboard(raw, lbUrl)!;
    expect(lb.baseUrl).toBe('https://open-kirrberg.github.io/orte-katalog/saarland/');
    expect(lb.meta.url).toBe('stats/places.json');
    expect(lb.levels?.levels.map((l) => l.aoi)).toEqual(['saarland', 'overall']);
    expect(levelBaseUrl(lb, 'overall')).toBe('https://open-kirrberg.github.io/orte-katalog/overall/');
    expect(parseLeaderboard({ version: 1 }, lbUrl)).toBeNull();
    expect(parseLeaderboard('x', lbUrl)).toBeNull();
  });

  it('catalog status wins (join on AGS); place_aoi / aoi_share_pct are dropped', () => {
    const cat = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
    const place = (id: string, ags: string | null, status: string | null) => ({ id, ags, status, place_aoi: 'overall', aoi_share_pct: 12.5 });
    const data = { places: [place('a', '10000001', 'stats'), place('b', '10000002', 'building'), place('c', '10000003', '3d'), place('x', '99999999', 'stats'), place('ot', null, null)] } as unknown as PlacesData;
    expect(applyCatalogStatus(data, cat)).toBe(2);
    expect(data.places.map((p) => p.status)).toEqual(['3d', 'building', 'stats', 'stats', null]);
    expect(data.places.every((p) => p.place_aoi === null && p.aoi_share_pct === null)).toBe(true);
  });
});

describe('place hint (Ortspate gesucht)', () => {
  it('stats and building places get a hint, 3D places and unowned tiles none', () => {
    const cat = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
    expect(placeHintAt(cat, 381500, 5461500)).toBeNull(); // ort-a: 3d
    expect(placeHintAt(cat, 382500, 5461500)).toEqual({ id: 'ort-b', name: 'Ort B', status: 'building' });
    expect(placeHintAt(cat, 384500, 5460500)).toEqual({ id: 'ort-c', name: 'Ort C', status: 'stats' });
    expect(placeHintAt(cat, 383500, 5461500)).toBeNull(); // not owned
    expect(placeHintAt(cat, NaN, 5461500)).toBeNull();
  });
});
