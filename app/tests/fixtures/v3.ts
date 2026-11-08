/** Synthetic v3 catalog / overview / place manifests for unit tests (S2). Not served by the app. */
import { encodeBitmap, GLOBAL_GRID } from '../../src/data/globalGrid';

/** Two places side by side: A owns 2 × 2 tiles, B owns 3 of its 2 × 2 tiles (NE missing). */
export function twoPlaceCatalog(extra: Record<string, unknown> = {}) {
  return {
    format: 'sle-catalog-v1',
    generated: '2026-11-08T00:00:00Z',
    crs: 'EPSG:25832',
    grid: GLOBAL_GRID,
    height_ref_m: 230,
    ownership: { rule: 'largest-share-v1', outlines: 'BKG VG25, Stand 31.12.2025', attribution: '© BKG' },
    overview: 'overview/overview.json',
    attribution: '© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0',
    places: [
      { id: 'ort-a', name_de: 'Ort A', ags: '10000001', state: 'SL', status: '3d', data_url: 'https://example.org/ort-a',
        bbox: [380000, 5460000, 382000, 5462000], tiles: encodeBitmap([1, 1, 1, 1], 2, 2) },
      { id: 'ort-b', name_de: 'Ort B', ags: '10000002', state: 'SL', status: 'building', data_url: '../ort-b/',
        bbox: [382000, 5460000, 384000, 5462000], tiles: encodeBitmap([1, 0, 1, 1], 2, 2) },
      { id: 'ort-c', name_de: 'Ort C', ags: '10000003', state: 'SL', status: 'stats',
        bbox: [384000, 5460000, 385000, 5461000], tiles: encodeBitmap([1], 1, 1) },
    ],
    ...extra,
  };
}

/** Overview over [380000, 5460000, 388000, 5464000] with levels 2 (2 km) and 3 (4 km). */
export function overviewRaw(extra: Record<string, unknown> = {}) {
  const lv = (k: number, cells: number[]) => {
    const S = 500 * 2 ** k;
    const nx = 8000 / S;
    const ny = 4000 / S;
    return {
      level: k, cellSize: 2 ** k, chunkSize: 500,
      size: { width: 8000 / 2 ** k, height: 4000 / 2 ** k }, chunks: { nx, ny },
      presence: encodeBitmap(cells, nx, ny),
      height: { dtm: { path: `levels/${k}/dtm/{i}_{j}.webp`, encoding: 'terrarium', apron: 1, quant_m: 0.05 } },
      layers: { vat: { path: `levels/${k}/vat/{i}_{j}.avif`, encoding: 'u8', min: 0, max: 1, lossy: true, label_de: 'VAT' } },
    };
  };
  return {
    format: 'sle-overview-v1', generated: '2026-11-08', crs: 'EPSG:25832', grid: GLOBAL_GRID,
    bbox: [380000, 5460000, 388000, 5464000], heightRange: { min: 230, max: 400 },
    levels: [lv(2, [0, 0, 0, 0, 1, 1, 1, 0]), lv(3, [1, 1])],
    attribution: '© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0',
    ...extra,
  };
}

/** A small v3 place: 2 × 2 tiles at [382000, 5460000], NE tile absent. */
export function v3Manifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    aoi: 'ort-b',
    name: 'Ort B',
    place: { id: 'ort-b', ags: '10000002' },
    crs: 'EPSG:25832',
    grid: GLOBAL_GRID,
    origin: { E0: 382000, N0: 5460000 },
    size: { width: 2000, height: 2000 },
    cellSize: 1,
    chunkSize: 500,
    chunks: { nx: 4, ny: 4 },
    presence: encodeBitmap([1, 0, 1, 1], 2, 2),
    heightRange: { min: 230, max: 300 },
    height: { dtm: { path: 'dtm/{i}_{j}.webp', encoding: 'terrarium', apron: 1 } },
    layers: {
      svf: { path: 'relief/svf/{i}_{j}.avif', encoding: 'u8', min: 0.6, max: 1, lossy: true, label_de: 'Himmelssicht (SVF)' },
      opns_pos: { path: 'relief/opns_pos/{i}_{j}.avif', encoding: 'u8', min: 60, max: 95, unit: 'deg', lossy: true, label_de: 'Offenheit positiv' },
      chm: { path: 'relief/chm/{i}_{j}.webp', encoding: 'u8', min: 0, max: 40, unit: 'm', label_de: 'Vegetationshöhe' },
      mask: { path: 'relief/mask/{i}_{j}.webp', encoding: 'u8', min: 0, max: 1, label_de: 'Ergänzte Daten' },
      ortho: { path: 'ortho/{i}_{j}.avif', encoding: 'rgb', format: 'avif', pixelsPerChunk: 1000, kind: 'image', label_de: 'Luftbild (DOP20)' },
    },
    derived: {
      hillshade: { method: 'live-hillshade', label_de: 'Schummerung' },
      slope: { method: 'live-slope', unit: 'deg', label_de: 'Hangneigung' },
      slrm: { method: 'live-lrm', params: { radius_m: 20 }, unit: 'm', label_de: 'Lokales Relief' },
      vat: { method: 'rvt-vat-combined-v1', inputs: ['svf', 'opns_pos'], label_de: 'VAT (Kombination)' },
    },
    levels: [
      { level: 0 },
      { level: 1, cellSize: 2, chunks: { nx: 2, ny: 2 }, size: { width: 1000, height: 1000 },
        height: { dtm: { path: 'levels/1/dtm/{i}_{j}.webp', encoding: 'terrarium', apron: 1 } },
        layers: {
          vat: { path: 'levels/1/vat/{i}_{j}.avif', encoding: 'u8', min: 0, max: 1, lossy: true, label_de: 'VAT (Kombination)' },
          ortho: { path: 'ortho/levels/1/{i}_{j}.avif', encoding: 'rgb', format: 'avif', pixelsPerChunk: 500, kind: 'image', label_de: 'Luftbild (DOP20)' },
        } },
    ],
    build: { pipeline: '0.9.0' },
    attribution: '© GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0',
    ...extra,
  };
}

