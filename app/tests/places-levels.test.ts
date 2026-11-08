/**
 * S1 Saarland leaderboard (contract „Gemeinde level“, ADR 0051): `stats_levels`, the Gemeinde-level
 * places.json, discipline states, the lazy level loader, level separation and the deep link.
 */
import { describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../src/data/manifest';
import { buildMatrix, categoryOptions, climbAction, climbFor, columnHead, dativePlural, flightDependent, headToHead, medalTable, parseCompareParam, parseLevelParam, unrankedReason, withCompareParam } from '../src/places/compare';
import { levelChoices, loadLevelData, probeLevel } from '../src/places/levels';
import {
  disciplineAvailability,
  parseManifestStats,
  parsePlacesFile,
  parseStatsLevels,
  pendingDisciplines,
  pendingText,
  placeBadges,
  placeLevel,
  placeTitle,
  shownDisciplines,
  statsLevelOf,
} from '../src/places/placesData';
import type { PlacesData } from '../src/places/placesData';

const tileManifest = {
  version: 1,
  aoi: 't',
  name: 'T',
  crs: 'EPSG:25832',
  origin: { E0: 381000, N0: 5465000 },
  size: { width: 1000, height: 1000 },
  chunkSize: 500,
  chunks: { nx: 2, ny: 2 },
  heightRange: { min: 0, max: 1 },
  height: { dtm: { path: 'dtm/{i}_{j}.png', encoding: 'terrarium', apron: 1 } },
  layers: {},
  attribution: 'a',
};
const stats = { format: 'sle-stats-v1', url: 'stats/places.json', geometry: 'stats/places.geojson', label_de: 'Orte im Vergleich' };
const levels = {
  format: 'sle-stats-levels-v1',
  levels: [
    { level: 'gemeinde', aoi: 'saarland', label_de: 'Gemeinden' },
    { level: 'ortsteil', aoi: 'overall', label_de: 'Ortsteile' },
  ],
};

// ---- Gemeinde-level file (synthetic, no real figures) -----------------------------------------------------
const GD = [
  { id: 'waldanteil', name_de: 'Waldreichste Gemeinde (Karte)', scope: 'place', measure: 'forest_pct', unit: '%', higher_is_better: true, ready: true },
  { id: 'krone', name_de: 'Kronenreichste Gemeinde', scope: 'place', measure: 'crown_pct', unit: '%', higher_is_better: true, ready: false },
  { id: 'sonne', name_de: 'Sonnenstärkste Gemeinde', scope: 'municipality', measure: 'pv.kwp_per_inhabitant', unit: 'kWp/Einw.', higher_is_better: true, ready: true },
  { id: 'nirgends', name_de: 'Ohne Quelle', scope: 'place', measure: 'x', unit: '', higher_is_better: true, ready: false },
];
const gem = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name_de: name,
  kind: 'gemeinde',
  ags: `1004${id.length}000`,
  state: 'SL',
  municipality: id,
  category: 'gemeinde',
  status: 'stats',
  complete: true,
  flags: [],
  area_ha: 1000,
  forest_pct: 30,
  crown_pct: null,
  discipline_state: { waldanteil: 'ready', krone: 'pending', sonne: 'ready', nirgends: 'none' },
  ...over,
});
const gemeindeFile = (over: Record<string, unknown> = {}) => ({
  format: 'sle-stats-v1',
  version: 1,
  level: 'gemeinde',
  complete: false,
  progress: { lidar: { tiles_done: 286, tiles_total: 2857, pct: 10, places_done: 3 } },
  categories_de: { stadt: 'Städte', gemeinde: 'Gemeinden' },
  disciplines: GD,
  places: [
    gem('aheim', 'Aheim', { category: 'stadt', status: '3d', forest_pct: 40, ortsteile: { aoi: 'overall', places: ['a1', 'a2'] } }),
    gem('bedorf', 'Bedorf', { forest_pct: 20, status: 'building' }),
    gem('cestadt', 'Cestadt', { category: 'stadt', forest_pct: 35, status: 'weird', discipline_state: { waldanteil: 'ready', krone: 'later?', sonne: 'ready', nirgends: 'none' } }),
    gem('dedorf', 'Dedorf', { forest_pct: null, discipline_state: { waldanteil: 'pending', krone: 'pending', sonne: 'ready', nirgends: 'none' } }),
    // A Gemarkung that slipped into a Gemeinde file: must never be ranked with the Gemeinden.
    { id: 'eins', name_de: 'Eins', kind: 'gemarkung', category: 'dorf', complete: true, forest_pct: 99 },
  ],
  municipalities: [
    { id: 'aheim', name_de: 'Aheim', inhabitants: 10000, pv: { kwp_per_inhabitant: 1.2 } },
    { id: 'bedorf', name_de: 'Bedorf', inhabitants: 6000, pv: { kwp_per_inhabitant: 0.8 } },
    { id: 'cestadt', name_de: 'Cestadt', inhabitants: 20000, pv: { kwp_per_inhabitant: 1.0 } },
    { id: 'dedorf', name_de: 'Dedorf', inhabitants: 7000, pv: { kwp_per_inhabitant: 0.5 } },
  ],
  ...over,
});
const ortsteilFile = {
  format: 'sle-stats-v1',
  version: 1,
  disciplines: [{ id: 'wald', name_de: 'Wald', scope: 'place', measure: 'crown_pct', unit: '%', higher_is_better: true, ready: true }],
  places: [
    { id: 'a1', name_de: 'A-Eins', category: 'dorf', complete: true, crown_pct: 30, municipality: 'aheim' },
    { id: 'a2', name_de: 'A-Zwei', category: 'stadt', complete: true, crown_pct: 20, municipality: 'aheim' },
  ],
};

const G = (): PlacesData => parsePlacesFile(gemeindeFile())!;

describe('manifest: stats_levels and stats-only', () => {
  it('old manifests without stats_levels keep their stats and get no levels (R9)', () => {
    const m = validateManifest({ ...tileManifest, stats });
    expect(m.stats?.url).toBe('stats/places.json');
    expect(m.stats?.level).toBeUndefined();
    expect(statsLevelOf(m.stats!)).toBe('ortsteil');
    expect(m.stats_levels).toBeUndefined();
  });

  it('parses stats_levels next to a valid stats key, ignores it without one', () => {
    expect(validateManifest({ ...tileManifest, stats, stats_levels: levels }).stats_levels?.levels.map((l) => l.level)).toEqual(['gemeinde', 'ortsteil']);
    expect(validateManifest({ ...tileManifest, stats_levels: levels }).stats_levels).toBeUndefined();
  });

  it('never opens a stats-only manifest as a terrain AOI', () => {
    expect(() => validateManifest({ version: 1, kind: 'stats-only', aoi: 'saarland', stats: { ...stats, level: 'gemeinde' }, stats_levels: levels })).toThrow(/stats-only/);
  });

  it('parseStatsLevels: format, unknown levels, bad AOI names, repeats, default labels', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseStatsLevels({ ...levels, format: 'sle-stats-levels-v2' })).toBeUndefined();
    expect(parseStatsLevels('x')).toBeUndefined();
    const p = parseStatsLevels({
      format: 'sle-stats-levels-v1',
      levels: [
        { level: 'kreis', aoi: 'k', label_de: 'Kreise' },
        { level: 'gemeinde', aoi: '../evil', label_de: 'X' },
        { level: 'gemeinde', aoi: 'saarland' },
        { level: 'gemeinde', aoi: 'other', label_de: 'doppelt' },
        { level: 'ortsteil', aoi: 'overall', label_de: 'Ortsteile' },
      ],
    });
    expect(p?.levels).toEqual([
      { level: 'gemeinde', aoi: 'saarland', label_de: 'Gemeinden' },
      { level: 'ortsteil', aoi: 'overall', label_de: 'Ortsteile' },
    ]);
    expect(parseStatsLevels({ format: 'sle-stats-levels-v1', levels: [{ level: 'x', aoi: 'y' }] })).toBeUndefined();
    warn.mockRestore();
  });

  it('parseManifestStats keeps a known level only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseManifestStats({ ...stats, level: 'gemeinde' })?.level).toBe('gemeinde');
    expect(parseManifestStats({ ...stats, level: 'kreis' })?.level).toBeUndefined();
    warn.mockRestore();
  });
});

describe('places.json levels', () => {
  it('reads the Gemeinde level: level, progress, categories, status, discipline_state, ortsteile', () => {
    const d = G();
    expect(d.level).toBe('gemeinde');
    expect(d.complete).toBe(false);
    expect(d.progress?.lidar.pct).toBe(10);
    expect(d.categories).toEqual({ stadt: 'Städte', gemeinde: 'Gemeinden' });
    const by = (id: string) => d.places.find((p) => p.id === id)!;
    expect(by('aheim').status).toBe('3d');
    expect(by('aheim').ortsteile).toEqual({ aoi: 'overall', places: ['a1', 'a2'] });
    expect(by('bedorf').status).toBe('building');
    expect(by('cestadt').status).toBe('stats'); // unknown → stats
    expect(by('cestadt').discipline_state.krone).toBe('pending'); // unknown → pending
    expect(by('bedorf').category).toBe('gemeinde');
    expect(by('aheim').ags).toBe('10045000');
  });

  it('a file without level is the Ortsteile level with Städte/Dörfer; an unknown level is rejected', () => {
    const o = parsePlacesFile(ortsteilFile)!;
    expect(o.level).toBe('ortsteil');
    expect(o.categories).toEqual({ stadt: 'Städte', dorf: 'Dörfer' });
    expect(o.places[0].status).toBeNull();
    expect(o.places[0].discipline_state).toEqual({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parsePlacesFile({ ...ortsteilFile, level: 'kreis' })).toBeNull();
    warn.mockRestore();
  });

  it('titles and badges by level and status', () => {
    const d = G();
    const a = d.places[0];
    expect(placeTitle(a)).toBe('Stadt Aheim');
    expect(placeTitle(d.places[1])).toBe('Gemeinde Bedorf');
    expect(placeTitle({ name_de: 'Einöd', kind: 'gemarkung' })).toBe('Gemarkung Einöd');
    expect(placeBadges(d.places[1], null).map((b) => b.text)).toContain('3D im Aufbau');
    expect(placeBadges(d.places[2], null).map((b) => b.text)).toEqual(['Ortspate gesucht']);
    expect(placeBadges(a, null).map((b) => b.key)).not.toContain('category'); // the title says Stadt
    expect(placeLevel(a)).toBe('gemeinde');
  });
});

describe('discipline availability (ready / pending / none / soon)', () => {
  it('pending shows „wird berechnet“, none is hidden, files without states keep „bald“', () => {
    const d = G();
    const av = (id: string) => disciplineAvailability(d, d.disciplines.find((x) => x.id === id)!);
    expect(av('waldanteil')).toBe('ready');
    expect(av('krone')).toBe('pending');
    expect(av('nirgends')).toBe('none');
    expect(shownDisciplines(d).map((x) => x.id)).toEqual(['waldanteil', 'krone', 'sonne']);
    expect(pendingDisciplines(d).map((x) => x.id)).toEqual(['krone']);
    expect(pendingText(d)).toBe('wird noch berechnet (LiDAR-Auswertung 10 %)');
    expect(pendingText({ progress: null })).toBe('wird noch berechnet');
    const o = parsePlacesFile({ ...ortsteilFile, disciplines: [...ortsteilFile.disciplines, { id: 'bald', name_de: 'Bald', scope: 'place', measure: '', ready: false }] })!;
    expect(disciplineAvailability(o, o.disciplines[1])).toBe('soon');
  });

  it('a pending place is unranked with the reason, never ranked as „keine Daten“', () => {
    const d = G();
    const m = buildMatrix(d);
    expect(m.pending.map((x) => x.id)).toEqual(['krone']);
    expect(m.disciplines.map((x) => x.id)).toEqual(['waldanteil', 'sonne']); // no column for pending
    const ded = m.rows.find((r) => r.place.id === 'dedorf')!;
    expect(ded.cells.waldanteil).toMatchObject({ rank: null, reason: 'wird noch berechnet' });
    const krone = d.disciplines.find((x) => x.id === 'krone')!;
    expect(unrankedReason(d.places[0], krone, null)).toBe('wird noch berechnet');
    const nirg = d.disciplines.find((x) => x.id === 'nirgends')!;
    expect(unrankedReason(d.places[0], nirg, null)).toBe('keine Quelle für diesen Ort');
  });
});

describe('level separation (compare.ts)', () => {
  it('ranks only the file level: a Gemarkung in a Gemeinde file never enters the board', () => {
    const m = buildMatrix(G());
    expect(m.level).toBe('gemeinde');
    expect(m.rows.map((r) => r.place.id)).toEqual(['aheim', 'bedorf', 'cestadt', 'dedorf']);
    const w = m.rows.map((r) => [r.place.id, r.cells.waldanteil.rank]);
    expect(w).toEqual([
      ['aheim', 1],
      ['bedorf', 3],
      ['cestadt', 2],
      ['dedorf', null],
    ]);
    // the Ortsteile file likewise ranks only its own places
    expect(buildMatrix(parsePlacesFile(ortsteilFile)!).rows.map((r) => r.place.id)).toEqual(['a1', 'a2']);
  });

  it('size classes per level: Alle / Städte / Gemeinden by legal status', () => {
    const d = G();
    expect(categoryOptions(d)).toEqual([
      ['alle', 'Alle'],
      ['stadt', 'Städte'],
      ['gemeinde', 'Gemeinden'],
    ]);
    expect(buildMatrix(d, 'gemeinde').rows.map((r) => r.place.id)).toEqual(['bedorf', 'dedorf']);
    expect(buildMatrix(d, 'stadt').rows.map((r) => [r.place.id, r.cells.waldanteil.rank])).toEqual([
      ['aheim', 1],
      ['cestadt', 2],
    ]);
    expect(dativePlural('Städte')).toBe('Städten');
    expect(dativePlural('Dörfer')).toBe('Dörfern');
    expect(dativePlural('Gemeinden')).toBe('Gemeinden');
  });

  it('medals count place disciplines only; compare and climb stay on the level', () => {
    const d = G();
    const m = buildMatrix(d);
    const medals = medalTable(m);
    expect(medals[0]).toMatchObject({ gold: 1 });
    expect(medals[0].place.id).toBe('aheim');
    const duel = headToHead(m, ['aheim', 'bedorf', 'a1']); // an Ortsteil id is not on this board
    expect(duel[0].entries.map((e) => e.place.id)).toEqual(['aheim', 'bedorf']);
    expect(duel.find((x) => x.discipline.id === 'sonne')!.text).toBe('Aheim vorn: 0,4 kWp/Einw. mehr als Bedorf.');
    const c = climbFor(d, m, 'bedorf')!;
    const wald = c.climbs.find((x) => x.discipline.id === 'waldanteil')!;
    expect(wald.gapText).toBe('15 Prozentpunkte hinter Cestadt (Platz 2)');
    expect(wald.action).toBe('≈ 150 ha mehr Wald in der Gemeinde');
    expect(c.climbs.find((x) => x.discipline.id === 'sonne')!.gapText).toBe('0,2 kWp/Einw. hinter Cestadt (Platz 2)');
  });

  it('Gemeinde-level wording: no „Gemeindewert“ column note, the DLR map is not flight dependent', () => {
    const sonne = G().disciplines.find((x) => x.id === 'sonne')!;
    expect(columnHead(sonne).notes).toContain('Gemeindewert');
    expect(columnHead(sonne, 'gemeinde').notes).not.toContain('Gemeindewert');
    expect(flightDependent({ scope: 'place', measure: 'forest_pct' })).toBe(false);
    const p = G().places[0];
    expect(climbAction({ ...G().disciplines[0], measure: 'ortslage_canopy_pct' }, 2, { ...p, ortslage_area_ha: 100 }, null).action).toBe('≈ 2 ha mehr Baumkrone in der Ortslage');
  });
});

describe('levels.ts', () => {
  it('levelChoices: needs ≥ 2 levels including the own one', () => {
    const lv = parseStatsLevels(levels)!;
    const own = parseManifestStats(stats)!;
    expect(levelChoices(own, lv)?.map((c) => [c.level, c.own])).toEqual([
      ['gemeinde', false],
      ['ortsteil', true],
    ]);
    expect(levelChoices(own, undefined)).toBeNull();
    expect(levelChoices(undefined, lv)).toBeNull();
    expect(levelChoices(own, { ...lv, levels: lv.levels.slice(0, 1) })).toBeNull(); // own level missing
    expect(levelChoices(own, { ...lv, levels: lv.levels.slice(1) })).toBeNull(); // one level only
  });

  const files: Record<string, unknown> = {
    'R/saarland/manifest.json': { version: 1, kind: 'stats-only', stats: { ...stats, level: 'gemeinde' }, stats_levels: levels },
    'R/saarland/stats/places.json': gemeindeFile(),
    'R/saarland/stats/places.geojson': {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { id: 'aheim' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] } }],
    },
    'R/wrong/manifest.json': { version: 1, stats }, // an Ortsteile manifest where Gemeinden are expected
  };
  const fetchJson = async (u: string) => (u in files ? files[u] : null);
  const choice = { level: 'gemeinde' as const, aoi: 'saarland', label_de: 'Gemeinden' };

  it('probes the level manifest (stats-only is fine) and loads places + outlines', async () => {
    const meta = await probeLevel(choice, 'R/saarland/', fetchJson);
    expect(meta?.level).toBe('gemeinde');
    const ld = await loadLevelData(choice, 'R/saarland/', meta!, fetchJson);
    expect(ld?.data.level).toBe('gemeinde');
    expect(ld?.data.places).toHaveLength(5);
    expect(ld?.outlines.get('aheim')).toHaveLength(1);
  });

  it('rejects unreachable AOIs, a manifest of the wrong level and a file of the wrong level', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await probeLevel(choice, 'R/missing/', fetchJson)).toBeNull();
    expect(await probeLevel(choice, 'R/wrong/', fetchJson)).toBeNull();
    expect(await probeLevel(choice, 'R/x/', async () => Promise.reject(new Error('offline')))).toBeNull();
    const meta = parseManifestStats({ ...stats, level: 'gemeinde' })!;
    const wrongFile = async (u: string) => (u.endsWith('places.json') ? ortsteilFile : null);
    expect(await loadLevelData(choice, 'R/saarland/', meta, wrongFile)).toBeNull();
    // outlines missing → still loaded (fly-to falls back to label / bbox)
    const noGeo = async (u: string) => (u.endsWith('places.json') ? gemeindeFile() : null);
    expect((await loadLevelData(choice, 'R/saarland/', meta, noGeo))?.outlines.size).toBe(0);
    warn.mockRestore();
  });
});

describe('deep link with level (?vergleich=a,b&ebene=gemeinde)', () => {
  it('parses the level only when offered; old links have none', () => {
    expect(parseLevelParam('?vergleich=a,b&ebene=gemeinde', ['gemeinde', 'ortsteil'])).toBe('gemeinde');
    expect(parseLevelParam('?vergleich=a,b&ebene=gemeinde', ['ortsteil'])).toBeNull();
    expect(parseLevelParam('?vergleich=a,b&ebene=kreis', ['gemeinde', 'ortsteil'])).toBeNull();
    expect(parseLevelParam('?vergleich=a,b', ['gemeinde', 'ortsteil'])).toBeNull();
    expect(parseCompareParam('?vergleich=aheim,bedorf&ebene=gemeinde', ['aheim', 'bedorf'])).toEqual(['aheim', 'bedorf']);
  });

  it('writes the level with the ids and removes both together', () => {
    expect(withCompareParam('?aoi=overall', ['aheim', 'bedorf'], 'gemeinde')).toBe('?aoi=overall&vergleich=aheim,bedorf&ebene=gemeinde');
    expect(withCompareParam('?aoi=overall&vergleich=a,b&ebene=gemeinde', [])).toBe('?aoi=overall');
    expect(withCompareParam('?ebene=gemeinde', ['a', 'b'])).toBe('?vergleich=a,b'); // old-style link: own level
  });
});
