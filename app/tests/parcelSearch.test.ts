import { describe, expect, it } from 'vitest';
import {
  canSearchOnline,
  fmtArea,
  geometryRings,
  indexRecord,
  isUsableQuery,
  matchGemarkungen,
  norm,
  parseGemarkungList,
  parseLabelRecords,
  parseParcelQuery,
  parseWfsRecords,
  pointInside,
  searchParcels,
  wfsSearchUrl,
} from '../src/parcelsearch/query';
import type { ParcelRecord } from '../src/parcelsearch/query';
import { buildParcelPolygons, featureRings } from '../src/vectors/parcelPolygons';

const rec = (gemarkung: string, flur: string, text: string, lage?: string, flstkennz = ''): ParcelRecord => ({
  E: 380000,
  N: 5460000,
  source: 'homburg',
  props: { gemarkung, flur, text, flstkennz, ...(lage ? { lage } : {}) },
});

const INDEX = [
  rec('Kirrberg', 'Flur 1', '100', 'Auf dem Rossberg', '10210000100100______'),
  rec('Kirrberg', 'Flur 1', '100/2'),
  rec('Kirrberg', 'Flur 3', '100'),
  rec('Hassel', 'Flur 6', '1405/1', 'Am Tiergarten', '107080006014050001__'),
  rec('St. Ingbert', 'Flur 15', '3658/8', 'Hasseler Pfad'),
  rec('Ixheim', 'Flur 0', '100'), // RLP: no Flur
  rec('Rohrbach', 'Flur 2', '12'),
].map(indexRecord);

describe('norm', () => {
  it('folds umlauts, Sankt and punctuation', () => {
    expect(norm('Oberwürzbach')).toBe('oberwuerzbach');
    expect(norm('Sankt Ingbert')).toBe('st ingbert');
    expect(norm('St. Ingbert')).toBe('st ingbert');
    expect(norm('  Straße, 3 ')).toBe('strasse 3');
  });
});

describe('parseParcelQuery', () => {
  it('Gemarkung + number', () => {
    expect(parseParcelQuery('Kirrberg 100/2')).toEqual({ words: 'kirrberg', zae: '100', nen: '2' });
    expect(parseParcelQuery('Kirrberg 100 / 2')).toEqual({ words: 'kirrberg', zae: '100', nen: '2' });
  });
  it('explicit and implicit Flur', () => {
    expect(parseParcelQuery('Hassel Flur 6 1405/1')).toEqual({ words: 'hassel', flur: 6, zae: '1405', nen: '1' });
    expect(parseParcelQuery('Kirrberg 3 100')).toEqual({ words: 'kirrberg', flur: 3, zae: '100' });
    expect(parseParcelQuery('Gemarkung Kirrberg, Flur 1, Flurstück 100')).toEqual({ words: 'kirrberg', flur: 1, zae: '100' });
    expect(parseParcelQuery('Gmk. Rohrbach Flst. 012')).toEqual({ words: 'rohrbach', zae: '12' });
  });
  it('number only and words only', () => {
    expect(parseParcelQuery('1405/1')).toEqual({ zae: '1405', nen: '1' });
    expect(parseParcelQuery('Am Tiergarten')).toEqual({ words: 'am tiergarten' });
    expect(parseParcelQuery('   ')).toEqual({});
  });
  it('Flurstückskennzeichen', () => {
    expect(parseParcelQuery('10210000100100______')).toEqual({ kennz: '10210000100100' });
    expect(parseParcelQuery('1021 0000 1001 00')).toEqual({ kennz: '10210000100100' });
  });
  it('usable only with a number, a Kennzeichen or ≥ 3 letters', () => {
    expect(isUsableQuery(parseParcelQuery('ki'))).toBe(false);
    expect(isUsableQuery(parseParcelQuery('kir'))).toBe(true);
    expect(isUsableQuery(parseParcelQuery('7'))).toBe(true);
  });
});

describe('searchParcels', () => {
  const texts = (s: string) => searchParcels(INDEX, parseParcelQuery(s)).hits.map((h) => `${h.rec.props.gemarkung} ${h.rec.props.flur} ${h.rec.props.text}`);

  it('exact number in a Gemarkung first, sub-parcels after', () => {
    expect(texts('Kirrberg 100')).toEqual(['Kirrberg Flur 1 100', 'Kirrberg Flur 3 100', 'Kirrberg Flur 1 100/2']);
  });
  it('with NEN only that sub-parcel', () => {
    expect(texts('kirrberg 100/2')).toEqual(['Kirrberg Flur 1 100/2']);
  });
  it('Flur narrows; RLP parcels without Flur still match', () => {
    expect(texts('Kirrberg Flur 3 100')).toEqual(['Kirrberg Flur 3 100']);
    expect(texts('Flur 3 100')).toEqual(['Kirrberg Flur 3 100', 'Ixheim Flur 0 100']);
  });
  it('number without Gemarkung lists all', () => {
    expect(texts('100')).toHaveLength(4);
  });
  it('Gemarkung prefix, Sankt / umlaut folding', () => {
    expect(texts('Sankt Ingbert 3658/8')).toEqual(['St. Ingbert Flur 15 3658/8']);
    expect(texts('kirr 100/2')).toEqual(['Kirrberg Flur 1 100/2']);
  });
  it('words without a number also match the Lage', () => {
    expect(texts('Tiergarten')).toEqual(['Hassel Flur 6 1405/1']);
    expect(texts('hassel')).toEqual(['Hassel Flur 6 1405/1', 'St. Ingbert Flur 15 3658/8']); // Gemarkung before Lage „Hasseler Pfad“
  });
  it('Kennzeichen prefix', () => {
    expect(texts('107080006014050001')).toEqual(['Hassel Flur 6 1405/1']);
  });
  it('limit keeps the total', () => {
    const r = searchParcels(INDEX, parseParcelQuery('100'), 2);
    expect(r.hits).toHaveLength(2);
    expect(r.total).toBe(4);
  });
});

describe('parseLabelRecords', () => {
  it('keeps E/N in float64 and skips bad features', () => {
    const out = parseLabelRecords(
      {
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [366909.71, 5458831.02] }, properties: { text: '1405/1', flstkennz: 'x', gemarkung: 'Hassel', flur: 'Flur 6', lage: 'Am Tiergarten' } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { text: '' } },
          { type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2]] }, properties: { text: '1' } },
        ],
      },
      'st-ingbert',
    );
    expect(out).toHaveLength(1);
    expect(out[0].E).toBe(366909.71);
    expect(out[0].N).toBe(5458831.02);
    expect(out[0].props.lage).toBe('Am Tiergarten');
    expect(out[0].source).toBe('st-ingbert');
  });
});

describe('WFS', () => {
  const GEMS = [
    { name: 'Kirrberg', key: '102100', gemeinde: 'Homburg' },
    { name: 'Oberwürzbach', key: '107120', gemeinde: 'St. Ingbert' },
    { name: 'St. Ingbert', key: '107140', gemeinde: 'St. Ingbert' },
    { name: 'Ingbert-Test', key: '999999', gemeinde: 'X' },
  ];
  it('parses the Gemarkung list (service writes invalid JSON without geometry)', () => {
    const text = `{"type":"FeatureCollection","features":[
{"type":"Feature","geometry":{"type":"MultiPolygon",},"properties":{"ART":"Gemarkung","NAME":"Tholey","SCHLUESSEL":"108730","GEMEINDE":"Tholey"}},
{"type":"Feature","geometry":{"type":"MultiPolygon",},"properties":{"ART":"Gemarkung","NAME":"Überroth-Niederhofen","SCHLUESSEL":"108740","GEMEINDE":"Tholey"}},
{"type":"Feature","geometry":{"type":"MultiPolygon",},"properties":{"ART":"Gemarkungsteil/Flur","NAME":"0","SCHLUESSEL":"108740000"}},
{"type":"Feature","geometry":{"type":"MultiPolygon",},"properties":{"ART":"Gemarkung","NAME":"Tholey","SCHLUESSEL":"108730","GEMEINDE":"Tholey"}},
]}`;
    expect(parseGemarkungList(text)).toEqual([
      { name: 'Tholey', key: '108730', gemeinde: 'Tholey' },
      { name: 'Überroth-Niederhofen', key: '108740', gemeinde: 'Tholey' },
    ]);
  });
  it('maps typed words to Gemarkungen: exact, else prefix, else substring', () => {
    expect(matchGemarkungen(GEMS, 'kirrberg').map((g) => g.key)).toEqual(['102100']);
    expect(matchGemarkungen(GEMS, 'Oberwuerzbach').map((g) => g.key)).toEqual(['107120']);
    expect(matchGemarkungen(GEMS, 'sankt ingbert').map((g) => g.key)).toEqual(['107140']);
    expect(matchGemarkungen(GEMS, 'ingbert').map((g) => g.key)).toEqual(['999999']); // prefix beats substring
    expect(matchGemarkungen(GEMS, 'gbert').map((g) => g.key)).toEqual(['107140', '999999']);
    expect(matchGemarkungen(GEMS, 'xyz')).toEqual([]);
  });
  it('online needs a Gemarkung and a number, or a full Kennzeichen', () => {
    expect(canSearchOnline(parseParcelQuery('100'))).toBe(false);
    expect(canSearchOnline(parseParcelQuery('Kirrberg'))).toBe(false);
    expect(canSearchOnline(parseParcelQuery('Kirrberg 100'))).toBe(true);
    expect(canSearchOnline(parseParcelQuery('10210000100100'))).toBe(true);
    expect(wfsSearchUrl(parseParcelQuery('Kirrberg 100'), [])).toBeNull();
  });
  it('builds exact filters only (the service rejects PropertyIsLike)', () => {
    const u = wfsSearchUrl(parseParcelQuery('Kirrberg Flur 1 100/2'), GEMS.slice(0, 1))!;
    const f = new URL(u).searchParams.get('FILTER')!;
    expect(f).not.toContain('PropertyIsLike');
    expect(f).toContain('<fes:ValueReference>GEMASCHL</fes:ValueReference><fes:Literal>102100</fes:Literal>');
    expect(f).toContain('<fes:ValueReference>FLSTNRZAE</fes:ValueReference><fes:Literal>100</fes:Literal>');
    expect(f).toContain('<fes:ValueReference>FLSTNRNEN</fes:ValueReference><fes:Literal>2</fes:Literal>');
    expect(f).toContain('<fes:Literal>Flur 1</fes:Literal>');
    expect(new URL(u).searchParams.get('SRSNAME')).toBe('urn:ogc:def:crs:EPSG::25832');
    const two = new URL(wfsSearchUrl(parseParcelQuery('gbert 5'), GEMS.slice(2))!).searchParams.get('FILTER')!;
    expect(two).toContain('<fes:Or>');
    const k = new URL(wfsSearchUrl(parseParcelQuery('10210000100100'), [])!).searchParams.get('FILTER')!;
    expect(k).toContain('<fes:Literal>10210000100100______</fes:Literal>');
  });
  it('escapes XML', () => {
    const f = new URL(wfsSearchUrl(parseParcelQuery('Kirrberg 1'), [{ name: 'a', key: '<b>', gemeinde: '' }])!).searchParams.get('FILTER')!;
    expect(f).not.toContain('<b>');
  });
  it('parses features (NEN "null", rings, inside point, area)', () => {
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]].map(([x, y]) => [380000 + x, 5460000 + y]);
    const out = parseWfsRecords({
      features: [
        { geometry: { type: 'Polygon', coordinates: [sq] }, properties: { FLSTNRZAE: '100', FLSTNRNEN: 'null', GEMARKUNG: 'Kirrberg', FLUR: 'Flur 1', FLSTKENNZ: 'k', LAGEBEZTXT: 'Auf dem Rossberg', FLAECHE: 4390.0 } },
        { geometry: null, properties: { FLSTNRZAE: '1' } },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].props.text).toBe('100');
    expect(out[0].flaeche_m2).toBe(4390);
    expect(out[0].E).toBe(380005);
    expect(out[0].N).toBe(5460005);
    expect(out[0].rings).toHaveLength(1);
  });
  it('inside point of a U shape is inside', () => {
    const u: Array<[number, number]> = [[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]];
    const p = pointInside([u])!;
    // bbox centre (15, 15) lies in the notch → another point
    expect(p).not.toEqual([15, 15]);
    expect(geometryRings({ type: 'MultiPolygon', coordinates: [[u]] })).toHaveLength(1);
  });
});

describe('featureRings', () => {
  it('returns all rings of one feature from the packed data', () => {
    const d = buildParcelPolygons({
      features: [
        { geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { text: '1' } },
        {
          geometry: { type: 'MultiPolygon', coordinates: [[[[5, 5], [9, 5], [9, 9], [5, 5]], [[6, 6], [7, 6], [7, 7], [6, 6]]], [[[20, 20], [21, 20], [21, 21], [20, 20]]]] },
          properties: { text: '2' },
        },
      ],
    });
    expect(featureRings(d, 0)).toEqual([[[0, 0], [1, 0], [1, 1], [0, 0]]]);
    const r = featureRings(d, 1);
    expect(r).toHaveLength(3);
    expect(r[1][0]).toEqual([6, 6]);
    expect(r[2][0]).toEqual([20, 20]);
    expect(featureRings(d, 2)).toEqual([]);
  });
});

describe('fmtArea', () => {
  it('m² below a hectare, ha above', () => {
    expect(fmtArea(830.4)).toBe('830 m²');
    expect(fmtArea(12500)).toBe('1,25 ha');
  });
});
