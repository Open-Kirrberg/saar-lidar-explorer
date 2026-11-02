import { describe, expect, it } from 'vitest';
import {
  MARKER_STORAGE_KEY,
  loadMarkers,
  markersFromGeoJSON,
  markersToGeoJSON,
  mergeMarkers,
  sanitizeMarker,
  saveMarkers,
  toFiniteNumber,
} from '../src/markers/markerStore';
import type { KV, Marker } from '../src/markers/markerStore';
import { parcelLabel, pointInGeometry } from '../src/markers/parcel';

class MemKV implements KV {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

const sample: Marker[] = [
  {
    id: 'm-1',
    title: 'Graben am Hang',
    note: 'Lineare Senke, ~40 m',
    category: 'Graben',
    created: '2026-11-01T10:00:00.000Z',
    E: 382165.25,
    N: 5466074.5,
    h: 352.12,
    parcel: 'Homburg, Flur 22, Flurstück 5451/3',
  },
  { id: 'm-2', title: 'Trichter', note: '', category: 'Grube/Trichter', created: '2026-11-01T11:00:00.000Z', E: 381500, N: 5465500, h: null },
];

describe('marker storage', () => {
  it('round-trips through the KV store', () => {
    const kv = new MemKV();
    expect(saveMarkers(kv, sample)).toBe(true);
    expect(kv.data.has(MARKER_STORAGE_KEY)).toBe(true);
    expect(loadMarkers(kv)).toEqual(sample);
  });

  it('tolerates missing, corrupt or throwing storage', () => {
    expect(loadMarkers(null)).toEqual([]);
    const kv = new MemKV();
    kv.setItem(MARKER_STORAGE_KEY, '{not json');
    expect(loadMarkers(kv)).toEqual([]);
    const throwing: KV = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(loadMarkers(throwing)).toEqual([]);
    expect(saveMarkers(throwing, sample)).toBe(false);
  });

  it('accepts a bare array and drops invalid entries', () => {
    const kv = new MemKV();
    kv.setItem(MARKER_STORAGE_KEY, JSON.stringify([sample[0], { title: 'no position' }]));
    expect(loadMarkers(kv)).toEqual([sample[0]]);
  });

  it('sanitizes category, title and h', () => {
    const m = sanitizeMarker({ E: 1, N: 2, category: 'Schatz', title: '', h: 'x' })!;
    expect(m.category).toBe('Sonstiges');
    expect(m.title).toBe('Ohne Titel');
    expect(m.h).toBeNull();
    expect(m.id).toMatch(/^m-/);
  });
});

describe('marker GeoJSON', () => {
  it('exports WGS84 points with the contract properties', () => {
    const fc = markersToGeoJSON(sample);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    const f = fc.features[0];
    expect(f.geometry.type).toBe('Point');
    const [lon, lat, z] = f.geometry.coordinates;
    expect(lat).toBeGreaterThan(49.3);
    expect(lat).toBeLessThan(49.4);
    expect(lon).toBeGreaterThan(7.3);
    expect(lon).toBeLessThan(7.45);
    expect(z).toBe(352.12);
    for (const k of ['id', 'title', 'note', 'category', 'created', 'E', 'N', 'h']) expect(f.properties).toHaveProperty(k);
    expect(fc.features[1].geometry.coordinates).toHaveLength(2);
  });

  it('round-trips export → JSON → import', () => {
    const json = JSON.stringify(markersToGeoJSON(sample));
    const r = markersFromGeoJSON(json);
    expect(r.errors).toEqual([]);
    expect(r.markers).toEqual(sample);
  });

  it('derives E/N from coordinates when properties lack them (e.g. hand-made GeoJSON)', () => {
    const fc = markersToGeoJSON(sample);
    const stripped = {
      type: 'FeatureCollection',
      features: fc.features.map((f) => {
        const { E: _e, N: _n, ...rest } = f.properties;
        return { ...f, properties: rest };
      }),
    };
    const r = markersFromGeoJSON(stripped);
    expect(r.markers).toHaveLength(2);
    expect(r.markers[0].E).toBeCloseTo(sample[0].E, 0);
    expect(r.markers[0].N).toBeCloseTo(sample[0].N, 0);
    expect(r.markers[0].h).toBe(352.12);
  });

  it('falls back to the geometry when QGIS exports E/N/h as null or empty (R0.3)', () => {
    const fc = markersToGeoJSON(sample);
    const qgis = {
      type: 'FeatureCollection',
      features: [
        { ...fc.features[0], properties: { ...fc.features[0].properties, E: null, N: null, h: null } },
        { ...fc.features[0], properties: { ...fc.features[0].properties, id: 'm-x', E: '', N: '', h: '' } },
        { ...fc.features[0], properties: { ...fc.features[0].properties, id: 'm-y', E: '  ', N: sample[0].N } },
      ],
    };
    const r = markersFromGeoJSON(JSON.stringify(qgis));
    expect(r.errors).toEqual([]);
    expect(r.markers).toHaveLength(3);
    for (const m of r.markers) {
      expect(m.E).toBeCloseTo(sample[0].E, 0);
      expect(m.N).toBeCloseTo(sample[0].N, 0);
      expect(m.h).toBe(352.12); // from the geometry's z
    }
  });

  it('skips features with null properties and null/empty coordinates instead of placing them at (0, 0)', () => {
    const r = markersFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [null, null] }, properties: { E: null, N: null } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: ['', ''] }, properties: { E: '', N: '' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: null },
      ],
    });
    expect(r.markers).toEqual([]);
    expect(r.skipped).toBe(3);
  });

  it('accepts numeric strings for E/N (CSV-ish exports)', () => {
    const r = markersFromGeoJSON({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { E: '382165.25', N: '5466074.5', h: '' },
    });
    expect(r.markers).toHaveLength(1);
    expect(r.markers[0]).toMatchObject({ E: 382165.25, N: 5466074.5, h: null });
  });

  it('rejects non-GeoJSON and skips bad features', () => {
    expect(markersFromGeoJSON('nope').errors[0]).toMatch(/JSON/);
    expect(markersFromGeoJSON({ foo: 1 }).markers).toEqual([]);
    const r = markersFromGeoJSON({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [999, 999] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [7.38, 49.335] }, properties: { title: 'ok', category: 'Hügel' } },
      ],
    });
    expect(r.markers).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.markers[0].category).toBe('Hügel');
  });

  it('merges by id', () => {
    const changed = { ...sample[0], title: 'neu' };
    const merged = mergeMarkers(sample, [changed, { ...sample[1], id: 'm-3' }]);
    expect(merged.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(merged[0].title).toBe('neu');
  });
});

describe('toFiniteNumber', () => {
  it('only accepts real numbers and non-blank numeric strings', () => {
    expect(toFiniteNumber(3.5)).toBe(3.5);
    expect(toFiniteNumber('42')).toBe(42);
    expect(toFiniteNumber(0)).toBe(0);
    for (const v of [null, undefined, '', '  ', false, true, [], {}, 'abc', NaN, Infinity]) expect(toFiniteNumber(v)).toBeNaN();
  });
  it('sanitizeMarker rejects null/empty positions', () => {
    expect(sanitizeMarker({ E: null, N: null })).toBeNull();
    expect(sanitizeMarker({ E: '', N: 5466074 })).toBeNull();
    expect(sanitizeMarker({ E: false, N: [] })).toBeNull();
  });
});

describe('parcel helpers', () => {
  it('formats WFS 414 labels (Nenner "null" omitted)', () => {
    expect(parcelLabel({ GEMARKUNG: 'Homburg', FLUR: 'Flur 22', FLSTNRZAE: '5451', FLSTNRNEN: '3', LAGEBEZTXT: 'Carlsbergerhof' })).toBe(
      'Homburg, Flur 22, Flurstück 5451/3 („Carlsbergerhof“)',
    );
    expect(parcelLabel({ GEMARKUNG: 'Bruchhof-Sanddorf', FLUR: 'Flur 22', FLSTNRZAE: '5419', FLSTNRNEN: 'null' })).toBe(
      'Bruchhof-Sanddorf, Flur 22, Flurstück 5419',
    );
  });
  it('point-in-polygon honours holes and multipolygons', () => {
    const sq = (a: number, b: number) => [[a, a], [b, a], [b, b], [a, b], [a, a]];
    const poly = { type: 'Polygon', coordinates: [sq(0, 10), sq(4, 6)] };
    expect(pointInGeometry(1, 1, poly)).toBe(true);
    expect(pointInGeometry(5, 5, poly)).toBe(false);
    expect(pointInGeometry(11, 5, poly)).toBe(false);
    expect(pointInGeometry(21, 21, { type: 'MultiPolygon', coordinates: [[sq(0, 10)], [sq(20, 30)]] })).toBe(true);
  });
});
