import { describe, expect, it } from 'vitest';
import { filterPois, foldText, groupPois, obliqueView, parsePois } from '../src/pois/pois';
import { gridBearing } from '../src/pois/PoiPanel';

const fc = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [7.3784, 49.3362] }, properties: { id: 'a', name: 'Schloss Karlsberg', type: 'palace', confidence: 'high' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [7.3789, 49.3352] }, properties: { id: 'b', name: 'Orangerie', type: 'palace', confidence: 'high' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [7.3881, 49.3242] }, properties: { id: 'c', name: 'Schwanenweiher', type: 'garden', confidence: 'med', note: 'drei Weiher' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [7.3351, 49.2838] }, properties: { id: 'd', name: 'Bunker (gesprengt)', type: 'bunker' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [7.37, 49.3] }, properties: { id: 'e', name: 'Komisch', type: 'ufo' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[7, 49], [7.1, 49.1]] }, properties: { id: 'f' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: ['x', 49] }, properties: { id: 'g' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [7.3, 49.2] }, properties: { id: 'a', name: 'Duplikat', type: 'cave' } },
  ],
};

describe('parsePois', () => {
  const pois = parsePois(fc);
  it('keeps valid points, normalises unknown types/confidence, de-duplicates ids', () => {
    expect(pois.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'a_']);
    expect(pois.find((p) => p.id === 'e')!.type).toBe('other');
    expect(pois.find((p) => p.id === 'd')!.confidence).toBe('med');
    expect(pois[0]).toMatchObject({ lat: 49.3362, lon: 7.3784 });
  });
  it('returns [] for garbage', () => {
    expect(parsePois(null)).toEqual([]);
    expect(parsePois({ type: 'Feature' })).toEqual([]);
  });
});

describe('groupPois', () => {
  it('groups in the fixed type order, sorted by German name, omitting empty groups', () => {
    const groups = groupPois(parsePois(fc));
    expect(groups.map((g) => g.type)).toEqual(['palace', 'garden', 'bunker', 'cave', 'other']);
    expect(groups[0].label).toBe('Schlösser & Ruinen');
    expect(groups[0].items.map((p) => p.name)).toEqual(['Orangerie', 'Schloss Karlsberg']);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(6);
  });
});

describe('filterPois', () => {
  const pois = parsePois(fc);
  it('searches name, note and type label, case/diacritics-insensitive, all words', () => {
    expect(filterPois(pois, { query: 'weiher' }).map((p) => p.id)).toEqual(['c']);
    expect(filterPois(pois, { query: 'DREI weiher' }).map((p) => p.id)).toEqual(['c']);
    expect(filterPois(pois, { query: 'schlösser' }).map((p) => p.id)).toEqual(['a', 'b']);
    expect(filterPois(pois, { query: '  ' })).toHaveLength(6);
  });
  it('filters by type set and predicate', () => {
    expect(filterPois(pois, { types: new Set(['bunker'] as const) }).map((p) => p.id)).toEqual(['d']);
    expect(filterPois(pois, { where: (p) => p.lat > 49.33 }).map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('folds German text', () => {
    expect(foldText('Großer Schloß-Weiher Ä')).toBe('grosser schloss-weiher a');
  });
});

describe('view helpers', () => {
  it('oblique view: 120 m away at 60 m AGL → pitch ≈ −26.6°', () => {
    const v = obliqueView(120, 60, 90);
    expect(v.pitch).toBeCloseTo(-26.565, 2);
    expect(v.heading).toBe(90);
    // DroneController.flyTo backs off agl / tan(−pitch) = dist
    expect(v.agl / Math.tan((-v.pitch * Math.PI) / 180)).toBeCloseTo(120, 6);
  });
  it('grid bearing', () => {
    expect(gridBearing(0, 0, 0, 10)).toBeCloseTo(0);
    expect(gridBearing(0, 0, 10, 0)).toBeCloseTo(90);
    expect(gridBearing(0, 0, 0, -10)).toBeCloseTo(180);
    expect(gridBearing(0, 0, -10, 0)).toBeCloseTo(270);
  });
});
