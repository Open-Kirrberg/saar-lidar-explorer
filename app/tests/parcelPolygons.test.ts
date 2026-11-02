import { describe, expect, it } from 'vitest';
import { formatParcel } from '../src/vectors/labels';
import { ParcelPolygonIndex, buildParcelPolygons, featureContains, sanitizeParcelPolygonProps } from '../src/vectors/parcelPolygons';
import { handleVectorRequest } from '../src/vectors/vectorData';

const E0 = 382000;
const N0 = 5466000;
const sq = (u0: number, v0: number, u1: number, v1: number) => [
  [E0 + u0, N0 + v0],
  [E0 + u1, N0 + v0],
  [E0 + u1, N0 + v1],
  [E0 + u0, N0 + v1],
  [E0 + u0, N0 + v0],
];
const props = (text: string, extra: Record<string, unknown> = {}) => ({ flstkennz: `K${text}`, gemarkung: 'Kirrberg', flur: 'Flur 3', zae: text, text, ...extra });

const fc = {
  type: 'FeatureCollection',
  features: [
    // A: 0..100 × 0..100 with a hole 40..60 (hole ring wound the same way as the outer ring)
    { type: 'Feature', properties: props('1', { flaeche_m2: 9600, lage: 'Am Hang' }), geometry: { type: 'Polygon', coordinates: [sq(0, 0, 100, 100), sq(40, 40, 60, 60)] } },
    // B: MultiPolygon with two parts, clockwise outer ring
    {
      type: 'Feature',
      properties: props('2', { nen: '4', text: '2/4' }),
      geometry: { type: 'MultiPolygon', coordinates: [[sq(200, 0, 300, 100).reverse()], [sq(400, 0, 450, 50)]] },
    },
    // C: the hole's island (after A in file order)
    { type: 'Feature', properties: props('3'), geometry: { type: 'Polygon', coordinates: [sq(40, 40, 60, 60)] } },
    // D: overlaps B's first part at 250..260 — B comes first in file order and must win there
    { type: 'Feature', properties: props('5'), geometry: { type: 'Polygon', coordinates: [sq(250, 50, 350, 150)] } },
    // Large parcel spanning many grid cells, unclosed ring (closing vertex omitted)
    { type: 'Feature', properties: props('6'), geometry: { type: 'Polygon', coordinates: [sq(0, 500, 2000, 2500).slice(0, 4)] } },
    // skipped: no text / bad geometry / 2-vertex ring / Point
    { type: 'Feature', properties: { flstkennz: 'X' }, geometry: { type: 'Polygon', coordinates: [sq(0, 0, 10, 10)] } },
    { type: 'Feature', properties: props('7'), geometry: { type: 'Polygon', coordinates: [[[E0, N0], ['x', N0], [E0 + 1, N0 + 1]]] } },
    { type: 'Feature', properties: props('8'), geometry: { type: 'Polygon', coordinates: [[[E0, N0], [E0 + 1, N0]]] } },
    { type: 'Feature', properties: props('9'), geometry: { type: 'Point', coordinates: [E0, N0] } },
  ],
};

describe('parcel polygons (contract flurstuecke.polygons)', () => {
  const data = buildParcelPolygons(fc);
  const idx = new ParcelPolygonIndex(data, 100);
  const at = (u: number, v: number) => idx.lookup(E0 + u, N0 + v)?.text ?? null;

  it('packs valid features and counts skipped ones', () => {
    expect(data.props.map((p) => p.text)).toEqual(['1', '2/4', '3', '5', '6']);
    expect(data.skipped).toBe(4);
    expect(data.featStart.length).toBe(6);
    expect(Array.from(data.bbox.slice(0, 4))).toEqual([E0, N0, E0 + 100, N0 + 100]);
  });

  it('finds the containing parcel, honouring holes, multipolygon parts and winding', () => {
    expect(at(10, 10)).toBe('1');
    expect(at(50, 50)).toBe('3'); // inside A's hole → the island
    expect(at(220, 10)).toBe('2/4'); // clockwise outer ring
    expect(at(420, 20)).toBe('2/4'); // second part
    expect(at(150, 50)).toBeNull(); // gap between parcels
    expect(at(-5, 10)).toBeNull(); // outside the index extent
    expect(at(1500, 2400)).toBe('6'); // far corner of the large unclosed parcel
  });

  it('takes the first feature in file order where polygons overlap', () => {
    expect(at(255, 60)).toBe('2/4');
    expect(at(320, 120)).toBe('5');
  });

  it('works without the grid (featureContains) and rejects NaN', () => {
    expect(featureContains(data, 0, E0 + 50, N0 + 50)).toBe(false);
    expect(featureContains(data, 2, E0 + 50, N0 + 50)).toBe(true);
    expect(idx.find(NaN, N0)).toBe(-1);
    expect(new ParcelPolygonIndex(buildParcelPolygons({ features: [] })).find(E0, N0)).toBe(-1);
    expect(buildParcelPolygons(null).props).toEqual([]);
  });

  it('sanitizes properties (text from zae/nen, optional area, Flur 0 hidden in the label)', () => {
    expect(sanitizeParcelPolygonProps({ zae: '12', nen: '4', gemarkung: 'Bechhofen', flur: 'Flur 0', flaeche_m2: 'x' })).toEqual({
      flstkennz: '',
      gemarkung: 'Bechhofen',
      flur: 'Flur 0',
      zae: '12',
      nen: '4',
      text: '12/4',
    });
    expect(sanitizeParcelPolygonProps({ text: '' })).toBeNull();
    const a = data.props[0];
    expect(a.flaeche_m2).toBe(9600);
    expect(formatParcel(a)).toBe('Kirrberg, Flur 3, Flurstück 1 („Am Hang“)');
    expect(formatParcel(sanitizeParcelPolygonProps({ zae: '7', gemarkung: 'Bechhofen', flur: 'Flur 0' })!)).toBe('Bechhofen, Flurstück 7');
  });

  it('is served through the vector worker protocol with transferable buffers', async () => {
    const { res, transfer } = await handleVectorRequest({ id: 1, kind: 'polygons', url: 'x' }, async () => JSON.stringify(fc));
    expect(res.ok && res.kind === 'polygons' && res.data.props.length).toBe(5);
    expect(transfer.length).toBe(5);
    const bad = await handleVectorRequest({ id: 2, kind: 'polygons', url: 'x' }, async () => '<!doctype html>');
    expect(bad.res.ok).toBe(false);
  });
});
