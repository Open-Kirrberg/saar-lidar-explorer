import { describe, expect, it } from 'vitest';
import {
  barFraction,
  buildMatrix,
  climbAction,
  climbFor,
  duelText,
  fmtArea,
  fmtGap,
  headToHead,
  isSuppressed,
  matchingGoal,
  medalDisciplines,
  medalTable,
  parseCompareParam,
  rivalFor,
  roundNice,
  sortRows,
  withCompareParam,
} from '../src/places/compare';
import { parsePlacesFile } from '../src/places/placesData';
import type { PlacesData } from '../src/places/placesData';

// Synthetic places (no coordinates): Aheim/Bedorf/Cestadt/Dedorf/Efeld, two Gemeinden.
const D = [
  { id: 'gruen', name_de: 'Grün', emoji: '🌳', scope: 'place', measure: 'ortslage.green_pct', unit: '%', higher_is_better: true, ready: true },
  { id: 'beton', name_de: 'Beton', emoji: '🧱', scope: 'place', measure: 'ortslage.sealed_pct', unit: '%', higher_is_better: false, ready: true },
  { id: 'bpe', name_de: 'Bäume pro Einwohner', scope: 'place', measure: 'trees_per_inhabitant', unit: 'Bäume/Einw.', higher_is_better: true, ready: true },
  { id: 'wald', name_de: 'Wald', scope: 'place', measure: 'crown_pct', unit: '%', higher_is_better: true, ready: true },
  { id: 'riese', name_de: 'Riesenbaum', scope: 'place', measure: 'tallest.h', unit: 'm', higher_is_better: true, ready: true },
  { id: 'pv', name_de: 'Sonne', scope: 'municipality', measure: 'pv.kwp_per_inhabitant', unit: 'kWp/Einw.', higher_is_better: true, ready: true },
  { id: 'arten', name_de: 'Artenvielfalt', scope: 'place', measure: 'biodiversity.rarefied_500', unit: '', higher_is_better: true, ready: true },
  { id: 'bald', name_de: 'Fortschritt', scope: 'place', measure: '', unit: '', higher_is_better: true, ready: false },
];

const place = (id: string, name: string, over: Record<string, unknown>) => ({
  id,
  name_de: name,
  category: 'dorf',
  complete: true,
  flags: [],
  suppressed: [],
  area_ha: 1000,
  inhabitants: 2000,
  goals: [],
  ...over,
});

const FILE = {
  format: 'sle-stats-v1',
  method: { crown: { id: 'crown-disc-v1', label_de: 'Kronen', params: { rlp_border_effect: { trees_per_ha_canopy_rlp_over_sl: 1.2 } } } },
  disciplines: D,
  municipalities: [
    { id: 'g1', name_de: 'Eins', places: ['a', 'b', 'c'], inhabitants: 10000, pv: { kwp_per_inhabitant: 1.1 } },
    { id: 'g2', name_de: 'Zwei', places: ['d', 'e'], inhabitants: 5000, pv: { kwp_per_inhabitant: 0.9 } },
  ],
  places: [
    place('a', 'Aheim', {
      municipality: 'g1',
      ortslage: { area_ha: 100, green_pct: 60, sealed_pct: 30 },
      trees_per_inhabitant: 20,
      crown_pct: 40,
      tallest: { h: 50, E: 1, N: 1 },
      biodiversity: { rarefied_500: 250 },
      goals: [{ id: 'entsiegeln', title_de: '1.000 m² entsiegeln', unit: 'm²' }, { id: 'riesen-bestimmt', title_de: 'Riesen bestimmen' }],
    }),
    place('b', 'Bedorf', {
      municipality: 'g1',
      ortslage: { area_ha: 50, green_pct: 55, sealed_pct: 31.4 },
      trees_per_inhabitant: 25,
      crown_pct: 40,
      tallest: { h: 45, E: 1, N: 1 },
      biodiversity: { rarefied_500: null, few_records: true },
    }),
    place('c', 'Cestadt', {
      municipality: 'g1',
      category: 'stadt',
      ortslage: { area_ha: 500, green_pct: 45, sealed_pct: 49.8 },
      trees_per_inhabitant: 4,
      crown_pct: 30,
      tallest: { h: 56.3, E: 1, N: 1 },
      biodiversity: { rarefied_500: 240 },
      inhabitants: 14000,
    }),
    place('d', 'Dedorf', {
      municipality: 'g2',
      flags: ['other-flight'],
      lidar_epochs: [
        [2025, 40],
        [2022, 60],
      ],
      ortslage: { area_ha: 90, green_pct: 59, sealed_pct: 32 },
      trees_per_inhabitant: 30,
      crown_pct: 35,
      tallest: { h: 51, E: 1, N: 1 },
      biodiversity: { rarefied_500: 260 },
    }),
    place('e', 'Efeld', {
      municipality: 'g2',
      complete: false,
      ortslage: { area_ha: 80, green_pct: 70, sealed_pct: 20 },
      trees_per_inhabitant: 50,
      crown_pct: 60,
      tallest: { h: 60, E: 1, N: 1 },
      suppressed: ['ortslage'],
    }),
  ],
};

const data = (): PlacesData => parsePlacesFile(structuredClone(FILE))!;

describe('buildMatrix', () => {
  it('ranks ready disciplines with the panel rule and gives reasons for unranked cells', () => {
    const m = buildMatrix(data());
    expect(m.disciplines.map((d) => d.id)).toEqual(['gruen', 'beton', 'bpe', 'wald', 'riese', 'pv', 'arten']);
    expect(m.rows.map((r) => r.place.name_de)).toEqual(['Aheim', 'Bedorf', 'Cestadt', 'Dedorf', 'Efeld']);
    const cell = (id: string, d: string) => m.rows.find((r) => r.place.id === id)!.cells[d];
    expect(cell('a', 'gruen')).toMatchObject({ rank: 1, of: 4, value: 60 });
    expect(cell('a', 'beton').rank).toBe(1); // lower is better
    expect(cell('c', 'beton').rank).toBe(4);
    // ties share a rank
    expect(cell('a', 'wald').rank).toBe(1);
    expect(cell('b', 'wald').rank).toBe(1);
    expect(cell('d', 'wald').rank).toBe(3);
    // incomplete: value kept, unranked
    expect(cell('e', 'riese')).toMatchObject({ rank: null, value: 60, reason: expect.stringContaining('unvollständig') });
    // few records
    expect(cell('b', 'arten')).toMatchObject({ rank: null, value: null, reason: 'zu wenige Meldungen (unter 500)' });
    // no data at all
    expect(cell('e', 'arten')).toMatchObject({ rank: null, reason: 'keine Daten' });
  });

  it('shows the municipality value and rank on each of its places', () => {
    const m = buildMatrix(data());
    const pv = (id: string) => m.rows.find((r) => r.place.id === id)!.cells.pv;
    expect(pv('a')).toMatchObject({ value: 1.1, rank: 1, of: 2 });
    expect(pv('a').municipality?.id).toBe('g1');
    expect(pv('c')).toMatchObject({ value: 1.1, rank: 1 });
    expect(pv('d')).toMatchObject({ value: 0.9, rank: 2 });
  });

  it('re-ranks within a category filter', () => {
    const m = buildMatrix(data(), 'dorf');
    expect(m.rows.map((r) => r.place.id)).toEqual(['a', 'b', 'd', 'e']);
    expect(m.rows.find((r) => r.place.id === 'd')!.cells.riese).toMatchObject({ rank: 1, of: 3 });
    const s = buildMatrix(data(), 'stadt');
    expect(s.rows.map((r) => r.place.id)).toEqual(['c']);
    expect(s.rows[0].cells.gruen).toMatchObject({ rank: 1, of: 1 });
    expect(s.rows[0].cells.pv).toMatchObject({ rank: 1, of: 2 }); // municipality ranking is global
  });

  it('keeps the min..max of ranked values for bars', () => {
    const m = buildMatrix(data());
    expect(m.extent.riese).toEqual({ min: 45, max: 56.3 }); // Efeld (incomplete, 60 m) not in the scale
    expect(m.extent.arten).toEqual({ min: 240, max: 260 });
  });
});

describe('sortRows', () => {
  it('sorts by rank, unranked last, names break ties', () => {
    const m = buildMatrix(data());
    expect(sortRows(m, 'wald').map((r) => r.place.id)).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(sortRows(m, 'beton').map((r) => r.place.id)).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(sortRows(m, null).map((r) => r.place.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(sortRows(m, 'nope').map((r) => r.place.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('barFraction', () => {
  it('is direction-aware: better is longer', () => {
    const ext = { min: 20, max: 40 };
    expect(barFraction({ higher_is_better: true }, 40, ext)).toBe(1);
    expect(barFraction({ higher_is_better: true }, 20, ext)).toBe(0);
    expect(barFraction({ higher_is_better: false }, 20, ext)).toBe(1);
    expect(barFraction({ higher_is_better: false }, 35, ext)).toBeCloseTo(0.25);
    expect(barFraction({ higher_is_better: true }, 5, { min: 5, max: 5 })).toBe(1);
    expect(barFraction({ higher_is_better: true }, null, ext)).toBeNull();
    expect(barFraction({ higher_is_better: true }, 99, ext)).toBe(1); // clamped
  });
});

describe('medalTable', () => {
  it('counts medals olympic-style over place disciplines only', () => {
    const m = buildMatrix(data());
    expect(medalDisciplines(m).map((d) => d.id)).not.toContain('pv');
    const t = medalTable(m);
    const row = (id: string) => t.find((r) => r.place.id === id)!;
    // Aheim: gruen 1, beton 1, bpe 3, wald 1 (tie), riese 3, arten 2
    expect(row('a')).toMatchObject({ gold: 3, silver: 1, bronze: 2 });
    // Dedorf: gruen 2, beton 3, bpe 1, wald 3, riese 2, arten 1
    expect(row('d')).toMatchObject({ gold: 2, silver: 2, bronze: 2 });
    // Bedorf: gruen 3, beton 2, bpe 2, wald 1 (tie), riese 4, arten –
    expect(row('b')).toMatchObject({ gold: 1, silver: 2, bronze: 1 });
    expect(row('e')).toMatchObject({ gold: 0, silver: 0, bronze: 0 }); // incomplete: never a medal
    expect(t.map((r) => r.place.id)).toEqual(['a', 'd', 'b', 'c', 'e']); // Bedorf 1/2/1 before Cestadt 1/0/1
    expect(t.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect(row('a').won.map((w) => w.discipline.id)).toEqual(['gruen', 'beton', 'bpe', 'wald', 'riese', 'arten']);
  });

  it('shares a position for equal medal counts', () => {
    const d = data();
    d.places = d.places.filter((p) => p.id === 'a' || p.id === 'b');
    // two places, every discipline: Aheim vs Bedorf; make them split evenly
    const t = medalTable(buildMatrix(d));
    expect(t.length).toBe(2);
    const same = data();
    same.places = [same.places[0], { ...same.places[0], id: 'a2', name_de: 'Aheim Zwei' }];
    const t2 = medalTable(buildMatrix(same));
    expect(t2.map((r) => r.position)).toEqual([1, 1]);
    expect(t2[0].gold).toBe(t2[1].gold);
  });
});

describe('wording', () => {
  it('formats gaps with units and Prozentpunkte', () => {
    expect(fmtGap(49.8 - 28.5, '%')).toBe('21,3 Prozentpunkte');
    expect(fmtGap(1, '%')).toBe('1 Prozentpunkt');
    expect(fmtGap(-4.3, 'm')).toBe('4,3 m');
    expect(fmtGap(1.1 - 0.89, 'kWp/Einw.')).toBe('0,21 kWp/Einw.');
    expect(fmtGap(10, '')).toBe('10');
  });

  it('rounds to two significant digits and formats areas', () => {
    expect(roundNice(4272)).toBe(4300);
    expect(roundNice(26692)).toBe(27000);
    expect(roundNice(57.4)).toBe(57);
    expect(fmtArea(4272)).toBe('4.300 m²');
    expect(fmtArea(0.2)).toBe('1 m²');
    expect(fmtArea(23_400)).toBe('2,3 ha');
    expect(fmtArea(1_573_000)).toBe('160 ha');
  });

  it('isSuppressed matches the path and its parents', () => {
    expect(isSuppressed({ suppressed: ['ortslage'] }, 'ortslage.green_pct')).toBe(true);
    expect(isSuppressed({ suppressed: ['ortslage.green_pct'] }, 'ortslage.green_pct')).toBe(true);
    expect(isSuppressed({ suppressed: ['ortslage'] }, 'ortslagex.a')).toBe(false);
  });
});

describe('headToHead', () => {
  it('marks the better place, bars on the whole board, plain German difference', () => {
    const m = buildMatrix(data());
    const duels = headToHead(m, ['a', 'c'], 1.2);
    const beton = duels.find((x) => x.discipline.id === 'beton')!;
    expect(beton.entries.map((e) => e.best)).toEqual([true, false]);
    expect(beton.entries[0].bar).toBe(1);
    expect(beton.entries[1].bar).toBe(0);
    expect(beton.text).toBe('Aheim vorn: 19,8 Prozentpunkte weniger als Cestadt.');
    const riese = duels.find((x) => x.discipline.id === 'riese')!;
    expect(riese.text).toBe('Cestadt vorn: 6,3 m mehr als Aheim.');
    // same municipality → one shared value
    const pv = duels.find((x) => x.discipline.id === 'pv')!;
    expect(pv.text).toBe('Gleicher Gemeindewert (Gemeinde Eins).');
    expect(pv.entries.every((e) => !e.best)).toBe(true);
  });

  it('handles three places, ties, unranked entries and the flight note', () => {
    const m = buildMatrix(data());
    const duels = headToHead(m, ['a', 'b', 'd'], 1.2);
    const wald = duels.find((x) => x.discipline.id === 'wald')!;
    expect(wald.entries.map((e) => e.best)).toEqual([true, true, false]);
    expect(wald.text).toBe('Aheim und Bedorf vorn (gleichauf): 5 Prozentpunkte mehr als Dedorf.');
    expect(wald.flightNote).toContain('Dedorf');
    expect(wald.flightNote).toContain('RLP-Befliegung 2022');
    expect(wald.flightNote).not.toContain('20 %'); // the tree-count offset only where trees are counted
    expect(duels.find((x) => x.discipline.id === 'bpe')!.flightNote).toContain('≈ 20 % höher gezählt');
    const arten = duels.find((x) => x.discipline.id === 'arten')!;
    expect(arten.entries[1]).toMatchObject({ bar: null, best: false });
    expect(arten.flightNote).toBeNull(); // GBIF counts do not depend on the flight
    const pv = duels.find((x) => x.discipline.id === 'pv')!;
    expect(pv.text).toBe('Gemeinde Eins vorn: 0,2 kWp/Einw. mehr als Gemeinde Zwei.');
    expect(pv.flightNote).toBeNull();
  });

  it('says why there is no comparison', () => {
    const m = buildMatrix(data());
    const arten = headToHead(m, ['b', 'e']).find((x) => x.discipline.id === 'arten')!;
    expect(arten.text).toBe('Kein Vergleich möglich – Bedorf: zu wenige Meldungen (unter 500); Efeld: keine Daten.');
    const r = m.rows.find((x) => x.place.id === 'a')!;
    expect(duelText(m.disciplines[0], [{ place: r.place, cell: r.cells.gruen }, { place: r.place, cell: r.cells.gruen }])).toBe('Gleichauf.');
  });
});

describe('climbFor', () => {
  it('gives the gap to the next-better rank and a concrete action', () => {
    const d = data();
    const m = buildMatrix(d);
    const c = climbFor(d, m, 'c')!;
    const beton = c.climbs.find((x) => x.discipline.id === 'beton')!;
    expect(beton).toMatchObject({ rank: 4, of: 4, target: { names: ['Dedorf'], rank: 3, value: 32 } });
    expect(beton.gapText).toBe('17,8 Prozentpunkte hinter Dedorf (Platz 3)');
    expect(beton.action).toBe('≈ 89 ha entsiegeln'); // 17.8 % of 500 ha
    expect(beton.flightNote).toContain('Dedorf'); // target from the other flight
    const bpe = c.climbs.find((x) => x.discipline.id === 'bpe')!;
    expect(bpe.action).toBe('≈ 220.000 Bäume pflanzen'); // (20 − 4) × 14.000
    const gruen = c.climbs.find((x) => x.discipline.id === 'gruen')!;
    expect(gruen.action).toBe('≈ 50 ha mehr Grün in der Ortslage');
    expect(c.leads.map((x) => x.id)).toEqual(['riese', 'pv']);
    expect(c.unranked).toEqual([]);
  });

  it('links matching goals, gives hints without numbers where none fit', () => {
    const d = data();
    const m = buildMatrix(d);
    const a = climbFor(d, m, 'a')!;
    expect(a.leads.map((x) => x.id)).toEqual(['gruen', 'beton', 'wald', 'pv']);
    const riese = a.climbs.find((x) => x.discipline.id === 'riese')!;
    expect(riese.action).toBeNull();
    expect(riese.hint).toContain('Riesen');
    expect(riese.goal?.id).toBe('riesen-bestimmt');
    expect(riese.target.names).toEqual(['Dedorf']);
    const arten = a.climbs.find((x) => x.discipline.id === 'arten')!;
    expect(arten.action).toBeNull();
    expect(arten.hint).toContain('melden');
    const b = climbFor(d, m, 'b')!;
    expect(b.unranked).toEqual([{ discipline: expect.objectContaining({ id: 'arten' }), reason: 'zu wenige Meldungen (unter 500)' }]);
    const beton = b.climbs.find((x) => x.discipline.id === 'beton')!;
    expect(beton.action).toBe('≈ 7.000 m² entsiegeln'); // 1.4 % of 50 ha
    expect(beton.flightNote).toBeNull(); // both from the same flight
  });

  it('PV: municipality gap in kWp for the Gemeinde, never a flight note', () => {
    const d = data();
    const dd = climbFor(d, buildMatrix(d), 'd')!;
    const pv = dd.climbs.find((x) => x.discipline.id === 'pv')!;
    expect(pv.target.names).toEqual(['Gemeinde Eins']);
    expect(pv.action).toBe('≈ 1.000 kWp mehr Photovoltaik in der Gemeinde Zwei'); // 0.2 × 5.000
    expect(pv.flightNote).toBeNull();
    // the other-flight place itself gets the note
    const riese = dd.climbs.find((x) => x.discipline.id === 'riese')!;
    expect(riese.flightNote).toContain('Dedorf');
  });

  it('skips actions when the fields are missing; unknown place → null', () => {
    const d = data();
    const p = { ...d.places[0], ortslage: null, inhabitants: null, area_ha: null };
    for (const disc of d.disciplines.filter((x) => x.ready)) expect(climbAction(disc, 1, p, null).action).toBeNull();
    expect(climbFor(d, buildMatrix(d), 'zz')).toBeNull();
    const e = climbFor(d, buildMatrix(d), 'e')!;
    expect(e.climbs.map((x) => x.discipline.id)).toEqual(['pv']); // the Gemeinde value still ranks
    expect(e.unranked.find((x) => x.discipline.id === 'gruen')?.reason).toContain('unvollständig');
  });

  it('matchingGoal prefers a goal with the same metric', () => {
    const g = (id: string, metric: string | null) => ({ id, title_de: id, metric, unit: '', baseline: null, baseline_year: null, target: null, target_delta: null, target_year: null, measured_by: null, progress: null, note_de: null });
    expect(matchingGoal({ goals: [g('hecke', null), g('x', 'ortslage.green_pct')] }, { measure: 'ortslage.green_pct' })?.id).toBe('x');
    expect(matchingGoal({ goals: [g('hecke', null)] }, { measure: 'ortslage.green_pct' })?.id).toBe('hecke');
    expect(matchingGoal({ goals: [] }, { measure: 'crown_pct' })).toBeNull();
  });
});

describe('rivalFor', () => {
  it('picks the place right above, or right below when 1st', () => {
    const m = buildMatrix(data());
    expect(rivalFor(m, 'c', 'beton')).toBe('d');
    expect(rivalFor(m, 'a', 'beton')).toBe('b');
    expect(rivalFor(m, 'b', 'wald')).toBe('a'); // tie at 1
    expect(rivalFor(m, 'e', 'beton')).toBe('a'); // unranked → first other place
    expect(rivalFor(m, 'c', 'pv')).toBeTruthy(); // municipality discipline → a place discipline
  });
});

describe('deep link', () => {
  it('parses 2–3 known distinct ids', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(parseCompareParam('?vergleich=a,b', ids)).toEqual(['a', 'b']);
    expect(parseCompareParam('?x=1&vergleich=a,b,c,d', ids)).toEqual(['a', 'b', 'c']);
    expect(parseCompareParam('?vergleich=a,a', ids)).toBeNull();
    expect(parseCompareParam('?vergleich=a,zz', ids)).toBeNull();
    expect(parseCompareParam('?vergleich=a,zz,b', ids)).toEqual(['a', 'b']);
    expect(parseCompareParam('', ids)).toBeNull();
  });

  it('sets and removes the param, keeping others', () => {
    expect(withCompareParam('', ['a', 'b'])).toBe('?vergleich=a,b');
    expect(withCompareParam('?aoi=overall', ['a', 'b'])).toBe('?aoi=overall&vergleich=a,b');
    expect(withCompareParam('?aoi=overall&vergleich=a,b', [])).toBe('?aoi=overall');
    expect(withCompareParam('?vergleich=a,b', [])).toBe('');
  });
});
