import { describe, expect, it, vi } from 'vitest';
import { parseImageLayer, parseModels, validateManifest } from '../src/data/manifest';

// Contract "Image layers" / "Building mask" / "Models" (F11/F13/F14), all additive and optional.

const level = (k: number, nx: number, ny: number, layers: Record<string, unknown> = {}) => ({
  level: k,
  cellSize: 2 ** k,
  chunks: { nx, ny },
  size: { width: Math.ceil(1000 / 2 ** k), height: Math.ceil(1000 / 2 ** k) },
  height: { dtm: { path: `levels/${k}/dtm/{i}_{j}.png`, encoding: 'terrarium', apron: 1 } },
  layers,
});

const vat = { path: 'relief/vat/{i}_{j}.png', encoding: 'u8', min: 0, max: 1, label_de: 'VAT' };
const bldg = { path: 'relief/bldg/{i}_{j}.png', encoding: 'u8', min: 0, max: 1, label_de: 'Gebäudemaske' };
const ortho = {
  path: 'ortho/{i}_{j}.webp', encoding: 'rgb', format: 'webp', pixelsPerChunk: 1000, kind: 'image',
  label_de: 'Luftbild (DOP20)', attribution: '© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (DOP20)',
};
const hist = { path: 'hist_1840/{i}_{j}.jpg', encoding: 'rgb', pixelsPerChunk: 500, label_de: 'Karte 1836–41 (Bayer. Positionsblätter)' };

const base = {
  version: 2,
  aoi: 't',
  name: 'T',
  crs: 'EPSG:25832',
  origin: { E0: 381000, N0: 5465000 },
  size: { width: 1000, height: 1000 },
  chunkSize: 500,
  chunks: { nx: 2, ny: 2 },
  heightRange: { min: 0, max: 1 },
  height: { dtm: { path: 'dtm/{i}_{j}.png', encoding: 'terrarium', apron: 1 } },
  layers: { vat, bldg, ortho, hist_1840: hist },
  levels: [level(0, 2, 2), level(1, 1, 1, { vat: { ...vat, path: 'levels/1/vat/{i}_{j}.png' },
    ortho: { ...ortho, path: 'levels/{level}/ortho/{i}_{j}.webp', pixelsPerChunk: 500 } })],
  attribution: 'a',
};

describe('manifest image layers (rgb)', () => {
  it('old manifests without image layers / models stay valid', () => {
    const m = validateManifest({ ...base, version: 1, layers: { vat }, levels: undefined });
    expect(m.imageLayers).toEqual({});
    expect(m.levels[0].imageLayers).toEqual({});
    expect(m.models).toBeUndefined();
    expect(Object.keys(m.layers)).toEqual(['vat']);
  });

  it('splits rgb entries out of layers (level 0 and coarse levels); bldg stays a u8 layer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = validateManifest(base);
    expect(Object.keys(m.layers)).toEqual(['vat', 'bldg']);
    expect(Object.keys(m.imageLayers)).toEqual(['ortho', 'hist_1840']);
    expect(m.imageLayers.ortho).toEqual({ ...ortho, format: 'webp' });
    expect(m.imageLayers.hist_1840.format).toBe('jpg'); // inferred from extension
    expect(m.imageLayers.hist_1840.kind).toBe('image');
    expect(m.levels[0].imageLayers).toBe(m.imageLayers);
    expect(m.levels[0].layers).toBe(m.layers);
    expect(Object.keys(m.levels[1].layers)).toEqual(['vat']); // rgb not reported as malformed u8
    expect(m.levels[1].imageLayers?.ortho.path).toBe('levels/1/ortho/{i}_{j}.webp');
    expect(m.levels[1].imageLayers?.ortho.pixelsPerChunk).toBe(500);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops malformed rgb entries and defaults label_de to the key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseImageLayer('ortho', { ...ortho, pixelsPerChunk: 0 })).toBeUndefined();
    expect(parseImageLayer('ortho', { ...ortho, pixelsPerChunk: 999.5 })).toBeUndefined();
    expect(parseImageLayer('ortho', { ...ortho, path: '' })).toBeUndefined();
    expect(parseImageLayer('x', { path: 'x/{i}_{j}.jpeg', encoding: 'rgb', pixelsPerChunk: 500 })).toMatchObject({
      label_de: 'x', format: 'jpg',
    });
    const m = validateManifest({ ...base, layers: { vat, ortho: { ...ortho, pixelsPerChunk: -1 } } });
    expect(m.imageLayers).toEqual({});
    expect(Object.keys(m.layers)).toEqual(['vat']);
    warn.mockRestore();
  });
});

describe('manifest models.buildings', () => {
  const buildings = {
    path: 'models/buildings/{i}_{j}.glb', chunks: [[0, 1], [1, 1]], frame: 'local', featureCount: 42,
    label_de: 'Gebäude (LoD2)', attribution: '© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (LoD2)',
  };

  it('parses a valid entry', () => {
    const m = validateManifest({ ...base, models: { buildings } });
    expect(m.models?.buildings).toEqual(buildings);
  });

  it('skips invalid / out-of-grid / duplicate chunk pairs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = parseModels({ buildings: { ...buildings, chunks: [[0, 0], [0, 0], [2, 0], [0, -1], [0.5, 1], 'x', [1]] } }, { nx: 2, ny: 2 });
    expect(r?.buildings?.chunks).toEqual([[0, 0]]);
    warn.mockRestore();
  });

  it('treats malformed entries as absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseModels(undefined, { nx: 2, ny: 2 })).toBeUndefined();
    expect(parseModels({}, { nx: 2, ny: 2 })).toBeUndefined();
    expect(parseModels({ buildings: { ...buildings, frame: 'utm' } }, { nx: 2, ny: 2 })).toBeUndefined();
    expect(parseModels({ buildings: { ...buildings, chunks: 'all' } }, { nx: 2, ny: 2 })).toBeUndefined();
    expect(validateManifest({ ...base, models: { buildings: { path: 1 } } }).models).toBeUndefined();
    const d = parseModels({ buildings: { path: 'b/{i}_{j}.glb', frame: 'local', chunks: [] } }, { nx: 2, ny: 2 });
    expect(d?.buildings).toMatchObject({ featureCount: 0, chunks: [] });
    warn.mockRestore();
  });
});
