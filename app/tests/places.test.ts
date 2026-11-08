import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../src/data/manifest';
import {
  ARRIVAL_MOVE_M,
  COLLECT_KEY,
  clearCollect,
  armCollectGate,
  collectGate,
  collectProgress,
  emptyCollect,
  isDiscovered,
  loadCollect,
  markPlace,
  markRiese,
  newCollectGate,
  riesenNear,
  saveCollect,
} from '../src/places/collect';
import type { KV } from '../src/places/collect';
import {
  aoiRect,
  boardFor,
  clipPolyline,
  clipRingToRect,
  fmtGoalValue,
  fmtRange,
  fmtShare,
  fmtValue,
  frameBox,
  framedPose,
  giantPinText,
  goalBar,
  inAoiRect,
  insideFocus,
  otherFlight,
  otherFlightNote,
  outsideNote,
  parseManifestStats,
  parseOutlines,
  parsePlacesFile,
  placeBadges,
  placeTitle,
  rankBoard,
  resolveMeasure,
  riesenInAoi,
  rieseSpeciesText,
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
  it('parses the Phase 1 blocks of every place', () => {
    const data = parsePlacesFile(JSON.parse(readFileSync(REAL, 'utf8')))!;
    for (const p of data.places) {
      expect(p.riesen.length).toBeGreaterThan(0);
      expect(p.riesen[0].h).toBe(p.tallest!.h);
      for (const g of p.goals) expect(g.progress).toBeNull();
    }
    const art = data.disciplines.find((d) => d.id === 'artenvielfalt');
    if (art) {
      expect(art.ready).toBe(true);
      const b = boardFor(data, art)!;
      expect(b.ranked.length).toBeGreaterThan(0);
      expect(art.note_de).toBeTruthy();
    }
    expect(data.labels.species.beech).toBe('Buche');
  });

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

// ---- Phase 1 ---------------------------------------------------------------------------------------------------

const PHASE1 = {
  ...FILE,
  labels_de: {
    species: { beech: 'Buche', douglas_fir: 'Douglasie', larch: 'Lärche' },
    age_classes: { young: 'jung', middle: 'mittelalt', old: 'alt', very_old: 'sehr alt' },
    nutzung: { forest: 'Wald und Gehölz' },
  },
  inputs: { gbif: { name_de: 'GBIF', note_de: 'enthält iNaturalist (CC BY-NC 4.0)' }, species_dlr: { name_de: 'DLR' } },
  disciplines: [
    ...FILE.disciplines.filter((d) => d.id !== 'artenvielfalt'),
    { id: 'artenvielfalt', name_de: 'Artenvielfalt', emoji: '🦋', description_de: 'misst Beobachtungen', scope: 'place', measure: 'biodiversity.rarefied_500', unit: 'Arten', higher_is_better: true, method: 'gbif-rarefied-v1', ready: true, note_de: 'Grober Hinweis, keine Messung.' },
  ],
  places: [
    place('kirrberg', {
      riesen: [
        { rank: 1, h: 47.9, E: 380946.5, N: 5461352.5, id: 3490862440, in_trees: false },
        { rank: 2, h: 46.7, E: 380924.5, N: 5461393.5, id: 3489420689, in_trees: false, species: { key: 'larch', p: 10 } },
        { rank: 3, h: 46.7, E: 390000.5, N: 5461393.5, id: 7, in_trees: true, species: { key: 'douglas_fir', p: 80 } },
        { h: 'tall', E: 1, N: 2 },
        { h: 44, E: 380000.5, N: 5462000.5, id: 8, in_trees: true, species: { key: 9 } },
      ],
      species: { mix: [{ key: 'beech', share_pct: 35.1 }, { key: 'oak', share_pct: 0 }, { key: 3, share_pct: 2 }, { key: 'alder', share_pct: 6.4, weak: true }], dominant: 'beech', coverage_pct: 78.1, conifer_pct: 24.8, trees: 37003, method: 'species-dlr-crown-mix-v1' },
      biodiversity: { species: 429, occurrences: 1316, inat_share_pct: 21.8, rarefied_500: 227, rarefied_500_range: [212, 227, 242], rarefied_150_range: [86, 96, 106], few_records: false, years: [1990, 2026] },
      forest_continuity_pct: 44.8,
      forest_continuity: { covered_pct: 100, epochs: [1935], snapshot: true },
      forest_age: { trees: 45491, trees_beyond: 9000, median_y: 95, classes_pct: { beyond: 26.0, very_old: 18.6, young: 6.1, middle: 22.1, old: 27.2 } },
      nutzung: null,
      roof_potential: { buildings: 2293, kwp: [13000, 16000, 18000], suitable_m2: 128000, usable_m2: 80200 },
      goals: [
        { id: 'kronen-ortslage', title_de: '+2 Prozentpunkte', metric: 'ortslage.canopy_pct', unit: '%', baseline: 32.9, baseline_year: 2025, target: 34.9, target_delta: 2, target_year: 2030, measured_by: 'lidar', progress: null },
        { id: 'hecke', title_de: '500 m neue Hecke', metric: null, unit: 'm', baseline: null, baseline_year: 2026, target: null, target_delta: 500, target_year: 2030, measured_by: 'community', progress: null },
        { id: 'no-title', unit: 'm' },
      ],
    }),
    place('moersbach', {
      biodiversity: { species: 120, occurrences: 326, rarefied_500: null, rarefied_500_range: null, rarefied_150_range: [70, 80, 90], few_records: true, years: null },
      nutzung: { source: 'alkis', shares_pct: { forest: 29, agriculture: 46.5, bad: 'x' } },
      roof_potential: 'broken',
      species: { mix: 'broken' },
      forest_age: { classes_pct: {} },
      riesen: 'nope',
    }),
  ],
  municipalities: [
    { id: 'bechhofen', name_de: 'Bechhofen', places: ['bechhofen'], pv: { systems: 214, kwp: 1825, used_pct: [11.2, 12.4, 14.9], used_pct_reason_de: null }, roof_potential: { complete: true, kwp: [12000, 14000, 16000], places: ['bechhofen'], suitable_m2: 113200 } },
    { id: 'homburg', name_de: 'Homburg', places: ['kirrberg'], pv: { systems: 2959, kwp: 45364, used_pct: null, used_pct_reason_de: 'Nicht alle Gemarkungen erfasst.' }, roof_potential: { complete: false, kwp: [3, 2, 1] } },
  ],
};

describe('Phase 1 blocks of places.json (contract „Place statistics“, tolerant)', () => {
  const data = parsePlacesFile(PHASE1)!;
  const k = data.places.find((p) => p.id === 'kirrberg')!;
  const m = data.places.find((p) => p.id === 'moersbach')!;

  it('riesen: entries without finite h/E/N skipped, species only with a string key and a number', () => {
    expect(k.riesen.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(k.riesen[0].species).toBeNull();
    expect(k.riesen[1].species).toEqual({ key: 'larch', p: 10 });
    expect(k.riesen[3]).toMatchObject({ h: 44, id: 8, species: null }); // rank derived from the order
    expect(m.riesen).toEqual([]);
  });

  it('species mix drops 0 / malformed entries; broken blocks read as null', () => {
    expect(k.species).toEqual({ mix: [{ key: 'beech', share_pct: 35.1, weak: false }, { key: 'alder', share_pct: 6.4, weak: true }], dominant: 'beech', coverage_pct: 78.1, conifer_pct: 24.8, trees: 37003 });
    expect(m.species).toBeNull();
    expect(m.roof_potential).toBeNull();
    expect(m.forest_age).toBeNull();
  });

  it('age classes in class order, continuity as a snapshot, roof potential, goals without title skipped', () => {
    expect(k.forest_age!.classes_pct.map(([c]) => c)).toEqual(['young', 'middle', 'old', 'very_old', 'beyond']);
    expect(k.forest_age!.trees_beyond).toBe(9000);
    expect(k.forest_continuity).toEqual({ covered_pct: 100, epochs: [1935], snapshot: true });
    expect(k.forest_continuity_pct).toBe(44.8);
    expect(k.roof_potential).toEqual({ buildings: 2293, suitable_m2: 128000, usable_m2: 80200, kwp: [13000, 16000, 18000] });
    expect(k.goals.map((g) => g.id)).toEqual(['kronen-ortslage', 'hecke']);
    expect(k.goals[0]).toMatchObject({ measured_by: 'lidar', progress: null, baseline: 32.9, target: 34.9 });
  });

  it('biodiversity, few records, land use', () => {
    expect(k.biodiversity).toMatchObject({ rarefied_500: 227, rarefied_500_range: [212, 227, 242], few_records: false, years: [1990, 2026] });
    expect(m.biodiversity).toMatchObject({ rarefied_500: null, few_records: true, rarefied_150_range: [70, 80, 90], years: null });
    expect(m.nutzung).toEqual([
      ['forest', 29],
      ['agriculture', 46.5],
    ]);
    expect(k.nutzung).toBeNull();
  });

  it('municipality used share and roof potential (invalid ranges → null)', () => {
    const b = data.municipalities.find((x) => x.id === 'bechhofen')!;
    const h = data.municipalities.find((x) => x.id === 'homburg')!;
    expect(b.pv!.used_pct).toEqual([11.2, 12.4, 14.9]);
    expect(b.roof_potential).toMatchObject({ complete: true, kwp: [12000, 14000, 16000] });
    expect(h.pv!.used_pct).toBeNull();
    expect(h.pv!.used_pct_reason_de).toBe('Nicht alle Gemarkungen erfasst.');
    expect(h.roof_potential).toBeNull();
  });

  it('labels, input notes, the Artenvielfalt board with its caveat', () => {
    expect(data.labels.species.beech).toBe('Buche');
    expect(data.inputNotes).toEqual(['enthält iNaturalist (CC BY-NC 4.0)']);
    const art = data.disciplines.find((d) => d.id === 'artenvielfalt')!;
    expect(art.note_de).toBe('Grober Hinweis, keine Messung.');
    const board = boardFor(data, art)!;
    expect(board.ranked.map((e) => e.item.id)).toEqual(['kirrberg']);
    expect(board.noData.map((e) => e.item.id)).toEqual(['moersbach']); // few records → „keine Daten“
  });

  it('Riese species wording (contract: wahrscheinlich ≥ 50 %, else unsicher; unknown keys by key)', () => {
    expect(rieseSpeciesText(data.labels, { key: 'douglas_fir', p: 80 })).toBe('wahrscheinlich Douglasie (80 %)');
    expect(rieseSpeciesText(data.labels, { key: 'larch', p: 40 })).toBe('Lärche? unsicher (40 %)');
    expect(rieseSpeciesText(data.labels, { key: 'fir', p: 50 })).toBe('wahrscheinlich fir (50 %)');
  });

  it('Riesen in the 3D area only (denominator of „Riesen entdeckt“)', () => {
    const r = { E0: 378000, N0: 5460000, E1: 384000, N1: 5468000 };
    expect(riesenInAoi(data.places, r).map((x) => x.riese.id)).toEqual([3490862440, 3489420689, 8]);
  });
});

describe('phone toast fix: one rounding for the 3D share', () => {
  it('fmtShare keeps 0.1 pp like the card', () => {
    expect(fmtShare(1.3)).toBe('1,3 %');
    expect(fmtShare(1.2999)).toBe('1,3 %');
    expect(fmtShare(6.8)).toBe('6,8 %');
    expect(fmtShare(48.25)).toBe('48,3 %');
    expect(outsideNote('Gemarkung Zweibrücken', 1.3)).toBe('Nur 1,3 % der Gemarkung Zweibrücken liegen im 3D-Gebiet: Flug zu diesem Teil, der ganze Umriss steht auf der Karte.');
  });
});

describe('goal bars (baseline / target, no progress)', () => {
  it('percent goals on 0–100, others on 0–max; null without a baseline', () => {
    const pct = goalBar({ baseline: 32.9, target: 34.9, unit: '%' })!;
    expect(pct.base).toBeCloseTo(0.329, 12);
    expect(pct.target).toBeCloseTo(0.349, 12);
    expect(goalBar({ baseline: 0, target: 10, unit: 'Bäume' })).toEqual({ base: 0, target: 1 });
    expect(goalBar({ baseline: 475100, target: 474100, unit: 'm²' })!.target).toBeCloseTo(474100 / 475100, 9);
    expect(goalBar({ baseline: null, target: null, unit: 'm' })).toBeNull();
    expect(goalBar({ baseline: 0, target: 0, unit: 'm' })).toBeNull();
    expect(fmtGoalValue(475100, 'm²')).toBe('475.100 m²');
    expect(fmtGoalValue(32.9, '%')).toBe('32,9 %');
    expect(fmtGoalValue(null, 'm')).toBe('noch nicht messbar');
  });
});

describe('local collecting (collect.ts, localStorage only)', () => {
  const memKV = (): KV & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  it('round-trips through storage and ignores junk', () => {
    const kv = memKV();
    const s = emptyCollect();
    expect(markRiese(s, 3490862440, new Date('2026-11-08T10:00:00Z'))).toBe(true);
    expect(markRiese(s, 3490862440)).toBe(false);
    expect(markPlace(s, 'kirrberg', new Date('2026-11-08T10:00:00Z'))).toBe(true);
    expect(saveCollect(kv, s)).toBe(true);
    const back = loadCollect(kv);
    expect(back).toEqual({ version: 1, riesen: { '3490862440': '2026-11-08' }, places: { kirrberg: '2026-11-08' } });
    expect(isDiscovered(back, 3490862440)).toBe(true);
    expect(isDiscovered(back, null)).toBe(false);
    kv.setItem(COLLECT_KEY, JSON.stringify({ version: 1, riesen: { abc: '2026-01-01', '12': 'yesterday', '13': '2026-01-02' }, places: { 'Bad Id': '2026-01-01', ok: '2026-01-01' } }));
    expect(loadCollect(kv)).toEqual({ version: 1, riesen: { '13': '2026-01-02' }, places: { ok: '2026-01-01' } });
    kv.setItem(COLLECT_KEY, '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadCollect(kv)).toEqual(emptyCollect());
    kv.setItem(COLLECT_KEY, JSON.stringify({ version: 2 }));
    expect(loadCollect(kv)).toEqual(emptyCollect());
    expect(clearCollect(kv)).toEqual(emptyCollect());
    expect(kv.data.has(COLLECT_KEY)).toBe(false);
    warn.mockRestore();
  });

  it('survives a throwing or missing storage (private mode)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: KV = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadCollect(bad)).toEqual(emptyCollect());
    expect(saveCollect(bad, emptyCollect())).toBe(false);
    expect(saveCollect(null, emptyCollect())).toBe(false);
    expect(clearCollect(bad)).toEqual(emptyCollect());
    expect(loadCollect(undefined)).toEqual(emptyCollect());
    warn.mockRestore();
  });

  it('discovers Riesen within 150 m (3D: horizontal + height above ground vs tree height)', () => {
    const rs = [
      { id: 1, E: 1000, N: 1000, h: 45 },
      { id: 2, E: 1200, N: 1000, h: 30 },
      { id: null, E: 1000, N: 1000, h: 45 },
    ];
    expect(riesenNear(rs, { E: 1000, N: 1000, agl: 100 }).map((r) => r.id)).toEqual([1]); // 55 m above the top
    expect(riesenNear(rs, { E: 1100, N: 1000, agl: 60 }).map((r) => r.id)).toEqual([1, 2]);
    expect(riesenNear(rs, { E: 1000, N: 1000, agl: 300 })).toEqual([]); // flying high over it does not count
    expect(riesenNear(rs, { E: Number.NaN, N: 1000, agl: 50 })).toEqual([]);
  });

  it('progress counts only ids of the current lists', () => {
    const s = emptyCollect();
    markRiese(s, 1);
    markRiese(s, 99); // no longer published
    markPlace(s, 'kirrberg');
    expect(collectProgress(s, [1, 2, 3], ['kirrberg', 'homburg'])).toEqual({ riesen: [1, 3], places: [1, 2] });
  });

  it('automatic fly-tos do not collect; places only after moving away from the arrival point', () => {
    // review 2026-11-08: tapping Zweibrücken flew over / ended above Kirrberg and counted it as visited
    const g = newCollectGate();
    expect(collectGate(g, false, { E: 0, N: 0 })).toEqual({ riesen: true, places: false }); // start pose = arrival
    expect(collectGate(g, false, { E: 0, N: ARRIVAL_MOVE_M })).toEqual({ riesen: true, places: true }); // flew away
    expect(collectGate(g, true, { E: 500, N: 0 })).toEqual({ riesen: false, places: false }); // fly-to running
    expect(collectGate(g, false, { E: 1000, N: 0 })).toEqual({ riesen: true, places: false }); // arrived
    expect(g.arrival).toEqual({ E: 1000, N: 0 });
    expect(collectGate(g, false, { E: 1000 + ARRIVAL_MOVE_M / 2, N: 0 }).places).toBe(false);
    expect(collectGate(g, false, { E: 1000, N: ARRIVAL_MOVE_M })).toEqual({ riesen: true, places: true }); // moved
    expect(g.arrival).toBeNull();
    // a flight that started and ended between two ticks is still seen (the frame loop sets `flew`)
    g.flew = true;
    expect(collectGate(g, false, { E: 5000, N: 0 }).places).toBe(false);
    expect(collectGate(g, false, { E: Number.NaN, N: 0 }).places).toBe(false);
  });

  it('the start pose and a reset are not a visit (review 2026-11-08: every reload collected Homburg)', () => {
    const g = newCollectGate();
    // pose not known yet: nothing counts and the gate stays armed
    expect(collectGate(g, false, { E: Number.NaN, N: Number.NaN })).toEqual({ riesen: false, places: false });
    expect(collectGate(g, false, { E: 381000, N: 5464000 }).places).toBe(false); // default start (Homburg)
    expect(g.arrival).toEqual({ E: 381000, N: 5464000 });
    for (let i = 0; i < 5; i++) expect(collectGate(g, false, { E: 381000 + i * 10, N: 5464000 }).places).toBe(false);
    expect(collectGate(g, false, { E: 381000 + ARRIVAL_MOVE_M, N: 5464000 }).places).toBe(true); // user flew 100 m
    armCollectGate(g); // reset in the panel
    expect(collectGate(g, false, { E: 381100, N: 5464000 }).places).toBe(false);
    expect(collectGate(g, false, { E: 381100, N: 5464000 + ARRIVAL_MOVE_M }).places).toBe(true);
  });
});
