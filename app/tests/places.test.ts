import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../src/data/manifest';
import {
  aoiRect,
  boardFor,
  clipPolyline,
  clipRingToRect,
  fmtRange,
  fmtValue,
  frameBox,
  framedPose,
  giantPinText,
  inAoiRect,
  insideFocus,
  otherFlight,
  otherFlightNote,
  parseManifestStats,
  parseOutlines,
  parsePlacesFile,
  placeBadges,
  placeTitle,
  rankBoard,
  resolveMeasure,
  unionBox,
} from '../src/places/placesData';
import type { Discipline, Place } from '../src/places/placesData';

const disc = (over: Partial<Discipline>): Discipline => ({
  id: 'd',
  name_de: 'D',
  description_de: '',
  scope: 'place',
  measure: 'v',
  unit: '%',
  higher_is_better: true,
  method: 'm',
  ready: true,
  ...over,
});

const place = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name_de: id[0].toUpperCase() + id.slice(1),
  kind: 'gemarkung',
  state: 'SL',
  municipality: 'homburg',
  category: 'dorf',
  complete: true,
  flags: ['pv-municipality-only'],
  suppressed: [],
  lidar_epoch: 2025,
  lidar_epochs: [[2025, 100]],
  label: [380000, 5462000],
  bbox: [379000, 5461000, 381000, 5463500],
  aoi_share_pct: 90,
  area_ha: 500,
  parcels: 1000,
  trees: 20000,
  crown_ha: 150,
  crown_pct: 30,
  agb_t: [41000, 82000, 160000],
  co2_t: [74000, 150000, 290000],
  ortslage: { area_ha: 100, buildings: 900, canopy_pct: 15, green_pct: 50, sealed_pct: 40 },
  inhabitants: 3000,
  trees_per_inhabitant: 6.7,
  tallest: { h: 47.9, E: 380946.5, N: 5461352.5, id: 1, in_trees: false },
  pv: null,
  ...extra,
});

const FILE = {
  format: 'sle-stats-v1',
  version: 1,
  generated: '2026-11-07T22:25:06Z',
  aoi: 'overall',
  disclaimer_de: 'Schätzungen aus Luftdaten.',
  attribution: '© A; © B',
  method: {
    crown: { id: 'crown-disc-v1', label_de: 'Kronen', params: { rlp_border_effect: { trees_per_ha_canopy_rlp_over_sl: 1.1994 } } },
    future_topic: { id: 'x-v9' },
  },
  disciplines: [
    { id: 'gruenste-ortslage', name_de: 'Grünste Ortslage', emoji: '🌳', description_de: '…', scope: 'place', measure: 'ortslage.green_pct', unit: '%', higher_is_better: true, method: 'ndvi-cir-v1', ready: true },
    { id: 'wenigsten-beton', name_de: 'Wenigsten Beton', scope: 'place', measure: 'ortslage.sealed_pct', unit: '%', higher_is_better: false, method: 'sealed-v1', ready: true, description_de: '' },
    { id: 'sonnenstaerkster-ort', name_de: 'Sonnenstärkster Ort', scope: 'municipality', measure: 'pv.kwp_per_inhabitant', unit: 'kWp/Einw.', higher_is_better: true, method: 'mastr', ready: true, description_de: '' },
    { id: 'artenvielfalt', name_de: 'Artenvielfalt', scope: 'place', measure: '', unit: '', higher_is_better: true, method: '', ready: false, description_de: '' },
    { id: 'weird', name_de: 'Weird', scope: 'team', measure: 'x', unit: '', higher_is_better: true, method: '', ready: true, description_de: '' },
  ],
  places: [
    place('kirrberg', { ortslage: { area_ha: 100, buildings: 900, canopy_pct: 20, green_pct: 65.4, sealed_pct: 28 }, unknown_field: { a: 1 } }),
    place('homburg', { category: 'stadt', ortslage: { area_ha: 900, buildings: 9000, canopy_pct: 10, green_pct: 45.1, sealed_pct: 50 } }),
    place('einoed', { ortslage: { area_ha: 80, buildings: 700, canopy_pct: 18, green_pct: 65.4, sealed_pct: 28 } }),
    place('moersbach', {
      state: 'RLP',
      flags: ['other-flight', 'pv-municipality-only', 'some-future-flag'],
      lidar_epoch: 2022,
      lidar_epochs: [[2022, 55.9], [2025, 44.1]],
      ortslage: { area_ha: 60, buildings: 500, canopy_pct: 22, green_pct: 59.6, sealed_pct: 30 },
    }),
    place('cutville', { complete: false, flags: ['cut-by-aoi'] }),
    place('tiny', { ortslage: null, suppressed: ['ortslage'] }),
    { id: 42, name_de: 'bad id' },
    { id: 'noname' },
  ],
  municipalities: [
    { id: 'homburg', name_de: 'Homburg', state: 'SL', ags: '10045114', places: ['kirrberg', 'homburg'], inhabitants: 42890, pv: { source: 'mastr', as_of: '2026-11-07', systems: 2959, kwp: 45364, kwp_per_inhabitant: 1.1, small_systems: 2833 } },
    { id: 'zweibruecken', name_de: 'Zweibrücken', state: 'RLP', ags: '07320000', places: ['moersbach'], inhabitants: 33140, pv: { source: 'mastr', systems: 2855, kwp: 33454, kwp_per_inhabitant: 1, small_systems: 2721 } },
    { id: 'bechhofen', name_de: 'Bechhofen', state: 'RLP', ags: '07340203', places: [], inhabitants: null, pv: null },
  ],
};

describe('manifest stats key (contract „App tolerance“)', () => {
  it('accepts a valid key and defaults label_de', () => {
    expect(parseManifestStats({ format: 'sle-stats-v1', url: 'stats/places.json', geometry: 'stats/places.geojson', places: 9 })).toEqual({
      format: 'sle-stats-v1',
      url: 'stats/places.json',
      geometry: 'stats/places.geojson',
      places: 9,
      label_de: 'Orte im Vergleich',
    });
  });

  it('ignores non-objects, other formats and a non-string url', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseManifestStats(undefined)).toBeUndefined();
    expect(parseManifestStats('x')).toBeUndefined();
    expect(parseManifestStats({ format: 'sle-stats-v2', url: 'a' })).toBeUndefined();
    expect(parseManifestStats({ format: 'sle-stats-v1', url: 3 })).toBeUndefined();
    warn.mockRestore();
  });

  it('validateManifest keeps a valid stats key and drops an invalid one', () => {
    const base = {
      version: 2,
      aoi: 't',
      name: 'T',
      crs: 'EPSG:25832',
      origin: { E0: 0, N0: 0 },
      size: { width: 500, height: 500 },
      cellSize: 1,
      chunkSize: 500,
      chunks: { nx: 1, ny: 1 },
      heightRange: { min: 0, max: 1 },
      height: { dtm: { path: 'h/{i}_{j}.png', encoding: 'terrarium' } },
      layers: {},
    };
    expect(validateManifest({ ...base, stats: { format: 'sle-stats-v1', url: 'stats/places.json' } }).stats?.url).toBe('stats/places.json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect('stats' in validateManifest({ ...base, stats: { format: 'nope', url: 'x' } })).toBe(false);
    expect('stats' in validateManifest(base)).toBe(false);
    warn.mockRestore();
  });
});

describe('places.json parser', () => {
  const data = parsePlacesFile(FILE)!;

  it('rejects other formats', () => {
    expect(parsePlacesFile({ ...FILE, format: 'sle-stats-v2' })).toBeNull();
    expect(parsePlacesFile(null)).toBeNull();
    expect(parsePlacesFile([])).toBeNull();
  });

  it('skips places without string id / name_de and keeps unknown fields out of the way', () => {
    expect(data.places.map((p) => p.id)).toEqual(['kirrberg', 'homburg', 'einoed', 'moersbach', 'cutville', 'tiny']);
    expect(data.places[0].raw.unknown_field).toEqual({ a: 1 });
  });

  it('drops disciplines with an unknown scope, keeps not-ready ones', () => {
    expect(data.disciplines.map((d) => d.id)).toEqual(['gruenste-ortslage', 'wenigsten-beton', 'sonnenstaerkster-ort', 'artenvielfalt']);
    expect(data.disciplines[3].ready).toBe(false);
  });

  it('reads the RLP tree ratio and method labels; cut-by-aoi means incomplete', () => {
    expect(data.rlpTreeRatio).toBeCloseTo(1.1994);
    expect(data.methodLabels['crown-disc-v1']).toBe('Kronen');
    expect(data.places.find((p) => p.id === 'cutville')!.complete).toBe(false);
  });

  it('parses ranges only when lo ≤ mid ≤ hi', () => {
    const p = parsePlacesFile({ ...FILE, places: [place('a', { agb_t: [3, 2, 1], co2_t: [1, 2] })] })!.places[0];
    expect(p.agb_t).toBeNull();
    expect(p.co2_t).toBeNull();
  });
});

describe('ranking rule', () => {
  const data = parsePlacesFile(FILE)!;
  const green = data.disciplines[0];

  it('ranks finite values, best first, ties share a rank', () => {
    const b = rankBoard(green, data.places);
    expect(b.ranked.map((e) => [e.item.id, e.rank, e.value])).toEqual([
      ['einoed', 1, 65.4], // tie, name order (de collation: Einöd < Kirrberg)
      ['kirrberg', 1, 65.4],
      ['moersbach', 3, 59.6],
      ['homburg', 4, 45.1],
    ]);
  });

  it('lists complete:false unranked and null as „keine Daten“', () => {
    const b = rankBoard(green, data.places);
    expect(b.incomplete.map((e) => e.item.id)).toEqual(['cutville']);
    expect(b.noData.map((e) => e.item.id)).toEqual(['tiny']);
  });

  it('lower is better when higher_is_better is false', () => {
    const b = rankBoard(data.disciplines[1], data.places);
    expect(b.ranked[0].value).toBe(28);
    expect(b.ranked[0].rank).toBe(1);
    expect(b.ranked[1].rank).toBe(1);
    expect(b.ranked.at(-1)!.item.id).toBe('homburg');
  });

  it('municipality scope ranks municipalities; null pv → keine Daten', () => {
    const b = boardFor(data, data.disciplines[2])!;
    expect(b.ranked.map((e) => [e.item.id, e.rank])).toEqual([
      ['homburg', 1],
      ['zweibruecken', 2],
    ]);
    expect(b.noData.map((e) => e.item.id)).toEqual(['bechhofen']);
  });

  it('not-ready disciplines have no board; an unresolvable measure gives „keine Daten“ for all', () => {
    expect(boardFor(data, data.disciplines[3])).toBeNull();
    const b = rankBoard(disc({ measure: 'no.such.path' }), data.places);
    expect(b.ranked).toEqual([]);
    expect(b.noData.length + b.incomplete.length).toBe(data.places.length);
  });

  it('ignores non-finite values', () => {
    const items = [
      { name_de: 'A', raw: { v: Number.NaN } },
      { name_de: 'B', raw: { v: '12' } },
      { name_de: 'C', raw: { v: 3 } },
    ];
    const b = rankBoard(disc({}), items);
    expect(b.ranked.map((e) => e.item.name_de)).toEqual(['C']);
    expect(b.noData.map((e) => e.item.name_de)).toEqual(['A', 'B']);
  });

  it('resolveMeasure walks dotted paths', () => {
    expect(resolveMeasure({ a: { b: 2 } }, 'a.b')).toBe(2);
    expect(resolveMeasure({ a: null }, 'a.b')).toBeNull();
    expect(resolveMeasure({ a: 1 }, '')).toBeNull();
  });
});

describe('badges and formatting', () => {
  const data = parsePlacesFile(FILE)!;
  const moersbach = data.places.find((p) => p.id === 'moersbach') as Place;

  it('other-flight badge with the year mix and the RLP explanation', () => {
    expect(otherFlight(moersbach)).toEqual({ year: 2022, pct: 55.9 });
    const b = placeBadges(moersbach, data.rlpTreeRatio);
    expect(b.map((x) => x.text)).toEqual(['Dorf', 'andere Befliegung: 56 % 2022']);
    expect(b[1].title).toBe('RLP-Befliegung 2022, Bäume dort ≈ 20 % höher gezählt');
    expect(otherFlightNote(moersbach, null)).toBe('RLP-Befliegung 2022');
  });

  it('Stadt / unvollständig badges and the Gemarkung title', () => {
    const homburg = data.places.find((p) => p.id === 'homburg')!;
    expect(placeBadges(homburg, null).map((b) => b.text)).toEqual(['Stadt']);
    expect(placeBadges(data.places.find((p) => p.id === 'cutville')!, null).map((b) => b.text)).toContain('unvollständig');
    expect(placeTitle(homburg)).toBe('Gemarkung Homburg');
  });

  it('German numbers, units and estimate ranges', () => {
    expect(fmtValue(58.7, 'm')).toBe('58,7 m');
    expect(fmtValue(45.1, '%')).toBe('45,1 %');
    expect(fmtValue(1.1, 'kWp/Einw.')).toBe('1,1 kWp/Einw.');
    expect(fmtValue(null, '%')).toBe('keine Daten');
    expect(fmtRange([41000, 82000, 160000], 't')).toBe('41.000–160.000 t');
  });
});

describe('geometry helpers', () => {
  it('parses Polygon and MultiPolygon outlines by id, skipping junk', () => {
    const o = parseOutlines({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'a', name_de: 'A' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] } },
        {
          type: 'Feature',
          properties: { id: 'b' },
          geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] },
        },
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
        { type: 'Feature', properties: { id: 'c' }, geometry: { type: 'Point', coordinates: [1, 2] } },
      ],
    });
    expect([...o.keys()]).toEqual(['a', 'b']);
    expect(o.get('b')!.length).toBe(2);
    expect(parseOutlines(null).size).toBe(0);
  });

  it('clips a polyline to the AOI rectangle (inside pieces only)', () => {
    // Square ring crossing the right edge x = 10.
    const ring = [5, 5, 15, 5, 15, -5, 5, -5, 5, 5];
    const parts = clipPolyline(ring, 0, 10, -10, 10);
    expect(parts).toEqual([
      [5, 5, 10, 5],
      [10, -5, 5, -5, 5, 5],
    ]);
    expect(clipPolyline([20, 0, 30, 0], 0, 10, -10, 10)).toEqual([]);
    expect(clipPolyline([1, 1, 2, 2, 3, 3], 0, 10, -10, 10)).toEqual([[1, 1, 2, 2, 3, 3]]);
  });

  it('frames the target above a bottom sheet without backing the camera off', () => {
    const none = framedPose(1000, 2000, 0, 1000, 750, 0, 60);
    expect(none.E).toBeCloseTo(1000, 9);
    expect(none.N).toBeCloseTo(1000, 9); // 1000 m behind (heading north)
    expect(none.height).toBe(750);
    expect(none.pitchDeg).toBeCloseTo((-Math.atan2(750, 1000) * 180) / Math.PI, 9);
    // phone sheet over 58 %: same camera position, steeper by `up` so the target sits `up` above the centre
    const f = framedPose(1000, 2000, 0, 1000, 750, 0.58, 60);
    expect([f.E, f.N, f.height]).toEqual([none.E, none.N, none.height]);
    const up = Math.atan(0.58 * Math.tan(Math.PI / 6));
    expect((-f.pitchDeg * Math.PI) / 180).toBeCloseTo(Math.atan2(750, 1000) + up, 9);
    expect(framedPose(0, 0, 0, 100, 2000, 0.8, 90).pitchDeg).toBeGreaterThanOrEqual(-80); // clamped
    // heading east, crown top 60 m up: camera 300 m west, 135 m above the crown top
    const t = framedPose(500, 500, 90, 300, 135, 0, 60, 60);
    expect(t.E).toBeCloseTo(200, 9);
    expect(t.N).toBeCloseTo(500, 9);
    expect(t.height).toBe(195);
    expect(t.pitchDeg).toBeCloseTo((-Math.atan2(135, 300) * 180) / Math.PI, 9);
  });

  it('measures the AOI in metres: size is in cells × cellSize', () => {
    const m = { origin: { E0: 378000, N0: 5460000 }, size: { width: 3000, height: 4000 }, cellSize: 2 };
    const r = aoiRect(m);
    expect(r).toEqual({ E0: 378000, N0: 5460000, E1: 384000, N1: 5468000 });
    // Riesenbaum test: Bechhofen's giant (E 384297) is outside, a tree at E 383500 (beyond 3000 cells as metres) inside
    expect(inAoiRect(r, 383500, 5467000)).toBe(true);
    expect(inAoiRect(r, 384297.5, 5469230.5)).toBe(false);
    expect(inAoiRect(aoiRect({ ...m, cellSize: 1 }), 383500, 5467000)).toBe(false); // the old cells-as-metres bug
    // 3D outline clip (local frame x = E − E0, z = −(N − N0)): an edge at 5000 m stays (inside 6000 m)
    const w = r.E1 - r.E0;
    const hM = r.N1 - r.N0;
    expect(clipPolyline([4000, -1000, 5000, -1000], 0, w, -hM, 0)).toEqual([[4000, -1000, 5000, -1000]]);
    expect(clipPolyline([5000, -1000, 7000, -1000], 0, w, -hM, 0)).toEqual([[5000, -1000, 6000, -1000]]);
  });

  it('finds the part of a place inside the AOI (centroid, bbox, share)', () => {
    const r = { E0: 0, N0: 0, E1: 100, N1: 100 };
    // 200 × 100 m rectangle, the western half inside
    const ring: Array<[number, number]> = [[0, 0], [200, 0], [200, 100], [0, 100], [0, 0]];
    expect(clipRingToRect(ring, r)).toHaveLength(4);
    const f = insideFocus([ring], r)!;
    expect(f.share).toBeCloseTo(0.5, 9);
    expect(f.E).toBeCloseTo(50, 9);
    expect(f.N).toBeCloseTo(50, 9);
    expect(f.bbox).toEqual([0, 0, 100, 100]);
    // clockwise ring, partly inside a corner
    const cw: Array<[number, number]> = [[50, 50], [50, 150], [150, 150], [150, 50]];
    const g = insideFocus([cw], r)!;
    expect(g.share).toBeCloseTo(0.25, 9);
    expect(g.E).toBeCloseTo(75, 9);
    expect(g.N).toBeCloseTo(75, 9);
    expect(insideFocus([[[200, 200], [300, 200], [300, 300]]], r)).toBeNull();
  });

  it('shortens the Riesenbaum pin on narrow screens', () => {
    expect(giantPinText({ name_de: 'Bruchhof-Sanddorf' }, 60.94, false)).toBe('🌲 Riesenbaum Bruchhof-Sanddorf: 60,9 m');
    expect(giantPinText({ name_de: 'Bruchhof-Sanddorf' }, 60.94, true)).toBe('🌲 60,9 m');
  });

  it('frames a place by bbox, label first', () => {
    const f = frameBox([0, 0, 4000, 2000], [100, 200])!;
    expect(f.E).toBe(100);
    expect(f.N).toBe(200);
    expect(f.dist).toBe(3000);
    expect(frameBox(null, null)).toBeNull();
    expect(unionBox([[0, 0, 1, 1], null, [-1, 2, 3, 4]])).toEqual([-1, 0, 3, 4]);
  });
});

// Local real data (git-ignored): parse + rank everything when present.
const REAL = join(import.meta.dirname, '../public/data/overall/stats/places.json');
const REAL_GEO = join(import.meta.dirname, '../public/data/overall/stats/places.geojson');
describe.skipIf(!existsSync(REAL))('real overall stats (local data)', () => {
  it('parses all places, boards every ready discipline, outlines for every place', () => {
    const data = parsePlacesFile(JSON.parse(readFileSync(REAL, 'utf8')))!;
    expect(data).not.toBeNull();
    expect(data.places.length).toBeGreaterThanOrEqual(9);
    for (const d of data.disciplines.filter((x) => x.ready)) {
      const b = boardFor(data, d)!;
      expect(b.ranked.length + b.incomplete.length + b.noData.length).toBe(d.scope === 'municipality' ? data.municipalities.length : data.places.length);
    }
    if (existsSync(REAL_GEO)) {
      const o = parseOutlines(JSON.parse(readFileSync(REAL_GEO, 'utf8')));
      for (const p of data.places) expect(o.has(p.id)).toBe(true);
    }
  });
});
