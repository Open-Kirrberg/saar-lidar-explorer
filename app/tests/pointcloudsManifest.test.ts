import { describe, expect, it, vi } from 'vitest';
import {
  POINT_CLASS_LABELS_DE,
  SLEP_HEADER_BYTES,
  SLEP_OFFSET,
  SLEP_RECORD_BYTES,
  parsePointClouds,
  parseSlepHeader,
  pointClassLabel,
  pointTileOrigin,
  pointTileUrl,
  validateManifest,
} from '../src/data/manifest';

const base = {
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

const area = {
  id: 'karlsberg-schloss',
  name_de: 'Schloss Karlsberg',
  bbox: [382000, 5466000, 382300, 5466200],
  tiles: [[0, 0, 40000], [2, 1, 38000], [3, 0, 5], [0, 2, 5], [0, 0, 1], [1, 1, 0], [1.5, 0, 3], [1, 1]],
  path: 'pointclouds/karlsberg-schloss/{tx}_{ty}.bin',
  pointCount: 78000,
  density_per_m2: 1.3,
  classCounts: { '2': 30000, '20': 48000, bad: 'x' },
  heightRange: { min: 289.39, max: 397.35 },
  intensityMax: 1933,
  source: ['3dm_32_382_5466_1_SL_2025_050.laz', 7],
};

const full = {
  format: 'sle-pts-v1',
  tileSize: 100,
  crs: 'EPSG:25832',
  areas: [area],
  classes: { '20': 'Vegetation u. a.', '99': 'Neu', x: 'nope', '300': 'zu groß', '2': '' },
  attribution: '© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet',
};

function tile(count: number, hBase: number, opts: { magic?: string; version?: number; extra?: number } = {}): ArrayBuffer {
  const buf = new ArrayBuffer(SLEP_HEADER_BYTES + SLEP_RECORD_BYTES * count + (opts.extra ?? 0));
  const dv = new DataView(buf);
  const magic = opts.magic ?? 'SLEP';
  for (let i = 0; i < 4; i++) dv.setUint8(i, magic.charCodeAt(i));
  dv.setUint16(4, opts.version ?? 1, true);
  dv.setUint32(8, count, true);
  dv.setFloat32(12, hBase, true);
  return buf;
}

describe('parsePointClouds', () => {
  it('parses a full entry, skips bad tiles/class labels, merges default labels', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pc = parsePointClouds(full)!;
    expect(pc.format).toBe('sle-pts-v1');
    expect(pc.tileSize).toBe(100);
    expect(pc.crs).toBe('EPSG:25832');
    expect(pc.attribution).toContain('LVGL-SL');
    const a = pc.areas[0];
    expect(a.grid).toEqual({ nx: 3, ny: 2 });
    // [3,0] out of nx, [0,2] out of ny, duplicate [0,0], count 0, non-integer, wrong length → skipped
    expect(a.tiles).toEqual([[0, 0, 40000], [2, 1, 38000]]);
    expect(a.pointCount).toBe(78000);
    expect(a.density_per_m2).toBe(1.3);
    expect(a.classCounts).toEqual({ '2': 30000, '20': 48000 });
    expect(a.heightRange).toEqual({ min: 289.39, max: 397.35 });
    expect(a.intensityMax).toBe(1933);
    expect(a.source).toEqual(['3dm_32_382_5466_1_SL_2025_050.laz']);
    expect(pc.classes['2']).toBe('Boden');
    expect(pc.classes['6']).toBe('Gebäude');
    expect(pc.classes['20']).toBe('Vegetation u. a.');
    expect(pc.classes['99']).toBe('Neu');
    expect(pc.classes['300']).toBeUndefined();
    expect(pc.classes.x).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('defaults name_de, pointCount, density and tileSize', () => {
    const pc = parsePointClouds({
      format: 'sle-pts-v1',
      areas: [{ id: 'a', bbox: [0, 0, 200, 100], tiles: [[0, 0, 300], [1, 0, 100]], path: 'pointclouds/a/{tx}_{ty}.bin' }],
    })!;
    expect(pc.tileSize).toBe(100);
    expect(pc.areas[0].name_de).toBe('a');
    expect(pc.areas[0].pointCount).toBe(400);
    expect(pc.areas[0].density_per_m2).toBeCloseTo(400 / 20000, 12);
    expect(pc.classes).toEqual(POINT_CLASS_LABELS_DE);
    expect(pc.attribution).toBeUndefined();
  });

  it('rejects absent / wrong format / bad crs / bad tileSize / no valid area', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parsePointClouds(undefined)).toBeUndefined();
    expect(parsePointClouds([])).toBeUndefined();
    expect(parsePointClouds({ ...full, format: 'potree2' })).toBeUndefined();
    expect(parsePointClouds({ ...full, crs: 'EPSG:4326' })).toBeUndefined();
    expect(parsePointClouds({ ...full, tileSize: 0 })).toBeUndefined();
    expect(parsePointClouds({ ...full, areas: [] })).toBeUndefined();
    expect(parsePointClouds({ ...full, areas: 'x' })).toBeUndefined();
    warn.mockRestore();
  });

  it('drops malformed areas and keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pc = parsePointClouds({
      ...full,
      areas: [
        { ...area, id: 'bad id' },
        { ...area, id: 'b1', bbox: [0, 0, 150, 100] }, // not a multiple of tileSize
        { ...area, id: 'b2', bbox: [100, 0, 0, 100] }, // Emin > Emax
        { ...area, id: 'b3', bbox: [0, 0, 100] },
        { ...area, id: 'b4', path: 'pointclouds/b4/{i}_{j}.bin' },
        area,
        { ...area, name_de: 'Duplikat' },
      ],
    })!;
    expect(pc.areas.map((a) => a.id)).toEqual(['karlsberg-schloss']);
    expect(pc.areas[0].name_de).toBe('Schloss Karlsberg');
    warn.mockRestore();
  });
});

describe('validateManifest + pointclouds', () => {
  it('keeps a valid key and omits an absent or invalid one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateManifest({ ...base, pointclouds: full }).pointclouds?.areas).toHaveLength(1);
    expect('pointclouds' in validateManifest(base)).toBe(false);
    expect('pointclouds' in validateManifest({ ...base, pointclouds: { format: 'x' } })).toBe(false);
    warn.mockRestore();
  });
});

describe('tile helpers', () => {
  const pc = parsePointClouds(full)!;
  const a = pc.areas[0];

  it('tile origin counts ty northwards from Nmin', () => {
    expect(pointTileOrigin(a, pc.tileSize, 0, 0)).toEqual({ E: 382000, N: 5466000 });
    expect(pointTileOrigin(a, pc.tileSize, 2, 1)).toEqual({ E: 382200, N: 5466100 });
  });

  it('tile url substitutes tx/ty', () => {
    expect(pointTileUrl('data/karlsberg/', a, 2, 1)).toBe('data/karlsberg/pointclouds/karlsberg-schloss/2_1.bin');
  });

  it('class label falls back to "Klasse n"', () => {
    expect(pointClassLabel(pc.classes, 2)).toBe('Boden');
    expect(pointClassLabel(pc.classes, 30)).toBe('Füllpunkte (synthetisch)');
    expect(pointClassLabel(pc.classes, 64)).toBe('Klasse 64');
  });
});

describe('parseSlepHeader', () => {
  it('reads count and hBase; record fields at the documented offsets', () => {
    const buf = tile(2, 289.39);
    const dv = new DataView(buf);
    const r = SLEP_HEADER_BYTES + SLEP_RECORD_BYTES; // second record
    dv.setUint16(r + SLEP_OFFSET.x, 10000, true);
    dv.setUint16(r + SLEP_OFFSET.y, 1234, true);
    dv.setUint16(r + SLEP_OFFSET.h, 65535, true);
    dv.setInt16(r + SLEP_OFFSET.agl, -150, true);
    dv.setUint8(r + SLEP_OFFSET.cls, 20);
    dv.setUint8(r + SLEP_OFFSET.intensity, 255);
    const { count, hBase } = parseSlepHeader(buf);
    expect(count).toBe(2);
    expect(hBase).toBeCloseTo(289.39, 4);
    // u16 fields are 2-aligned, so a stride-5 Uint16Array view works (as a WebGL interleaved buffer would)
    const u16 = new Uint16Array(buf, SLEP_HEADER_BYTES);
    expect(u16[5 + 0]).toBe(10000);
    expect(u16[5 + 1]).toBe(1234);
    expect(hBase + u16[5 + 2] / 100).toBeCloseTo(289.39 + 655.35, 3);
    expect(new Int16Array(buf, SLEP_HEADER_BYTES)[5 + 3]).toBe(-150);
    expect(new Uint8Array(buf)[r + 8]).toBe(20);
  });

  it('accepts an empty tile and rejects bad magic / version / size', () => {
    expect(parseSlepHeader(tile(0, 300)).count).toBe(0);
    expect(() => parseSlepHeader(new ArrayBuffer(8))).toThrow(/shorter/);
    expect(() => parseSlepHeader(tile(1, 300, { magic: 'PK\u0003\u0004' }))).toThrow(/magic/);
    expect(() => parseSlepHeader(tile(1, 300, { version: 2 }))).toThrow(/version/);
    expect(() => parseSlepHeader(tile(3, 300, { extra: 1 }))).toThrow(/size/);
    expect(() => parseSlepHeader(tile(1, Number.NaN))).toThrow(/hBase/);
  });
});
