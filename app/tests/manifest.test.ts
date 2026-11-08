import { describe, expect, it, vi } from 'vitest';
import { levelGrid, parseLevels, parseVectors, validateManifest } from '../src/data/manifest';

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

const osm = {
  path: 'vectors/osm.geojson',
  crs: 'EPSG:25832',
  featureCount: 12,
  label_de: 'Wege (OSM)',
  source: 'OpenStreetMap',
};

describe('manifest vectors', () => {
  it('old manifests without vectors stay valid (vectors undefined)', () => {
    const m = validateManifest(base);
    expect(m.vectors).toBeUndefined();
  });

  it('parses osm + flurstuecke', () => {
    const m = validateManifest({
      ...base,
      vectors: {
        osm,
        flurstuecke: { ...osm, path: 'vectors/flurstuecke.geojson', labels: 'vectors/flurstuecke_labels.geojson' },
      },
    });
    expect(m.vectors?.osm).toEqual(osm);
    expect(m.vectors?.flurstuecke?.labels).toBe('vectors/flurstuecke_labels.geojson');
  });

  it('drops malformed entries and fills defaults', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseVectors(null)).toBeUndefined();
    expect(parseVectors([])).toBeUndefined();
    expect(parseVectors({ osm: { crs: 'EPSG:25832' } })).toBeUndefined();
    expect(parseVectors({ osm: { ...osm, crs: 'EPSG:4326' } })).toBeUndefined();
    expect(parseVectors({ flurstuecke: osm })).toBeUndefined(); // no labels
    const v = parseVectors({ osm: { path: 'x.geojson', crs: 'EPSG:25832' }, other: { path: 'y' } });
    expect(v).toEqual({
      osm: { path: 'x.geojson', crs: 'EPSG:25832', featureCount: 0, label_de: '', source: '' },
    });
    warn.mockRestore();
  });

  it('parses optional flurstuecke.polygons; bad value dropped, layer kept', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fl = { ...osm, path: 'vectors/flurstuecke.geojson', labels: 'vectors/flurstuecke_labels.geojson' };
    expect(parseVectors({ flurstuecke: fl })?.flurstuecke).not.toHaveProperty('polygons');
    expect(parseVectors({ flurstuecke: { ...fl, polygons: 'vectors/flurstuecke_polygons.geojson' } })?.flurstuecke?.polygons).toBe(
      'vectors/flurstuecke_polygons.geojson',
    );
    for (const bad of ['', 42, null, {}]) {
      const v = parseVectors({ flurstuecke: { ...fl, polygons: bad } });
      expect(v?.flurstuecke?.labels).toBe('vectors/flurstuecke_labels.geojson');
      expect(v?.flurstuecke).not.toHaveProperty('polygons');
    }
    warn.mockRestore();
  });
});

const level = (k: number, nx: number, ny: number, extra: Record<string, unknown> = {}) => ({
  level: k,
  cellSize: 2 ** k,
  chunks: { nx, ny },
  height: { dtm: { path: 'levels/{level}/dtm/{i}_{j}.png', encoding: 'terrarium', apron: 1 } },
  layers: {
    vat: { path: 'levels/{level}/vat/{i}_{j}.png', encoding: 'u8', min: 0, max: 1, label_de: 'VAT' },
    hillshade: { path: 'levels/{level}/hillshade/{i}_{j}.png', encoding: 'u8', min: 0, max: 1 },
  },
  ...extra,
});

// overall AOI: 6000 × 8000 cells → nx,ny per level 12×16, 6×8, 3×4, 2×2, 1×1
const v2 = {
  ...base,
  version: 2,
  size: { width: 6000, height: 8000 },
  chunks: { nx: 12, ny: 16 },
  levels: [
    { level: 0, cellSize: 1, chunks: { nx: 12, ny: 16 }, height: base.height, layers: {} },
    level(1, 6, 8, { size: { width: 3000, height: 4000 } }),
    level(2, 3, 4),
    level(3, 2, 2),
    level(4, 1, 1, { size: { width: 375, height: 500 } }),
  ],
};

describe('manifest levels (contract v2)', () => {
  it('v1 manifest loads as a single level 0 built from the top-level keys', () => {
    const m = validateManifest(base);
    expect(m.levels).toHaveLength(1);
    expect(m.levels[0]).toEqual({
      level: 0,
      cellSize: 1,
      chunkSize: 500,
      size: { width: 1000, height: 1000 },
      chunks: { nx: 2, ny: 2 },
      height: base.height,
      layers: {},
      imageLayers: {},
    });
  });

  it('v1 manifest ignores a stray levels key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateManifest({ ...base, levels: v2.levels }).levels).toHaveLength(1);
    warn.mockRestore();
  });

  it('parses v2 levels, substitutes {level}, derives size', () => {
    const m = validateManifest(v2);
    expect(m.version).toBe(2);
    expect(m.levels.map((l) => [l.level, l.cellSize, l.chunks.nx, l.chunks.ny])).toEqual([
      [0, 1, 12, 16],
      [1, 2, 6, 8],
      [2, 4, 3, 4],
      [3, 8, 2, 2],
      [4, 16, 1, 1],
    ]);
    expect(m.levels[3].size).toEqual({ width: 750, height: 1000 });
    expect(m.levels[2].height.dtm.path).toBe('levels/2/dtm/{i}_{j}.png');
    expect(m.levels[4].layers.vat.path).toBe('levels/4/vat/{i}_{j}.png');
    expect(m.levels[1].chunkSize).toBe(500);
  });

  it('levelGrid rounds partial blocks/chunks up (3000 m AOI at 16 m)', () => {
    expect(levelGrid(validateManifest({ ...base, size: { width: 3000, height: 3000 }, chunks: { nx: 6, ny: 6 } }), 4)).toEqual({
      cellSize: 16,
      size: { width: 188, height: 188 },
      chunks: { nx: 1, ny: 1 },
    });
  });

  it('keeps the valid contiguous prefix, drops malformed layers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = (l: unknown) => validateManifest({ ...v2, levels: [v2.levels[0], v2.levels[1], l, v2.levels[3]] }).levels;
    expect(bad(level(2, 3, 5))).toHaveLength(2); // wrong chunks
    expect(bad({ ...level(2, 3, 4), cellSize: 3 })).toHaveLength(2);
    expect(bad({ ...level(2, 3, 4), level: 7 })).toHaveLength(2);
    expect(bad({ ...level(2, 3, 4), height: { dtm: { path: 'x', encoding: 'png' } } })).toHaveLength(2);
    expect(bad({ ...level(2, 3, 4), size: { width: 1, height: 1 } })).toHaveLength(2);
    const l = bad({ ...level(2, 3, 4), layers: { vat: { path: 'v', encoding: 'u8' }, hillshade: level(2, 3, 4).layers.hillshade } });
    expect(l).toHaveLength(4);
    expect(Object.keys(l[2].layers)).toEqual(['hillshade']);
    expect(validateManifest({ ...v2, levels: 'nope' }).levels).toHaveLength(1);
    expect(validateManifest({ ...v2, levels: undefined }).levels).toHaveLength(1);
    expect(parseLevels(validateManifest(v2), [])).toHaveLength(1);
    warn.mockRestore();
  });

  it('rejects unknown versions', () => {
    expect(() => validateManifest({ ...base, version: 4 })).toThrow(/version/);
  });

  it('vector heights: baked is kept, anything else dropped', () => {
    expect(parseVectors({ osm: { ...osm, heights: 'baked' } })?.osm?.heights).toBe('baked');
    expect(parseVectors({ osm: { ...osm, heights: 'yes' } })?.osm).toEqual(osm);
  });
});
