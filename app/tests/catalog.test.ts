import { describe, expect, it, vi } from 'vitest';
import { loadCatalog, parseCatalog, placeAt, planPlaces, resolveCatalogUrl } from '../src/data/catalog';
import { encodeBitmap, GLOBAL_GRID } from '../src/data/globalGrid';
import { overviewRaw, twoPlaceCatalog } from './fixtures/v3';
import { parseOverview } from '../src/data/overview';

const CAT_URL = 'https://open-kirrberg.github.io/orte-katalog/catalog.json';

const quiet = () => {};

describe('catalog sle-catalog-v1', () => {
  it('parses places, resolves URLs against the catalog and builds the tile → owner map', () => {
    const c = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
    expect(c.places.map((p) => p.id)).toEqual(['ort-a', 'ort-b', 'ort-c']);
    expect(c.byId.get('ort-a')!.dataUrl).toBe('https://example.org/ort-a/');
    expect(c.byId.get('ort-b')!.dataUrl).toBe('https://open-kirrberg.github.io/ort-b/');
    expect(c.overviewUrl).toBe('https://open-kirrberg.github.io/orte-katalog/overview/overview.json');
    expect(c.height_ref_m).toBe(230);
    expect(c.owners.get('380_5461')).toBe('ort-a');
    expect(c.owners.get('381_5460')).toBe('ort-a');
    expect(c.owners.get('382_5461')).toBe('ort-b');
    expect(c.owners.get('383_5461')).toBeUndefined(); // B's NE tile is not owned
    expect(c.owners.get('383_5460')).toBe('ort-b');
    expect(c.owners.get('384_5460')).toBe('ort-c');
    expect(placeAt(c, 381500, 5461500)?.id).toBe('ort-a');
    expect(placeAt(c, 383500, 5461500)).toBeUndefined();
  });

  it('rejects a wrong format, grid or height_ref (no catalog mode)', () => {
    expect(() => parseCatalog({ ...twoPlaceCatalog(), format: 'sle-catalog-v2' }, CAT_URL, quiet)).toThrow();
    expect(() => parseCatalog({ ...twoPlaceCatalog(), grid: { ...GLOBAL_GRID, tile_m: 500 } }, CAT_URL, quiet)).toThrow();
    expect(() => parseCatalog({ ...twoPlaceCatalog(), height_ref_m: 'x' }, CAT_URL, quiet)).toThrow();
    expect(() => parseCatalog([], CAT_URL, quiet)).toThrow();
  });

  it('tolerance: bad id/ags/bbox/tiles skipped, missing data_url and unknown status → stats, duplicate claims → first', () => {
    const raw = twoPlaceCatalog();
    const warn = vi.fn();
    raw.places.push(
      { id: 'Bad_ID', name_de: 'x', ags: '10000009', state: 'SL', status: '3d', data_url: 'https://x/', bbox: [380000, 5460000, 381000, 5461000], tiles: encodeBitmap([1], 1, 1) },
      { id: 'ort-d', name_de: 'D', ags: '123', state: 'SL', status: '3d', data_url: 'https://x/', bbox: [380000, 5460000, 381000, 5461000], tiles: encodeBitmap([1], 1, 1) },
      { id: 'ort-e', name_de: 'E', ags: '10000005', state: 'SL', status: '3d', data_url: 'https://x/', bbox: [380000, 5460000, 380500, 5461000], tiles: encodeBitmap([1], 1, 1) },
      { id: 'ort-f', name_de: 'F', ags: '10000006', state: 'SL', status: '3d', data_url: 'https://x/', bbox: [380000, 5460000, 381000, 5461000], tiles: encodeBitmap([1, 1], 2, 1) },
      { id: 'ort-g', name_de: 'G', ags: '10000007', state: 'SL', status: '3d', bbox: [386000, 5460000, 387000, 5461000], tiles: encodeBitmap([1], 1, 1) },
      { id: 'ort-h', name_de: 'H', ags: '10000008', state: 'SL', status: 'archived', data_url: 'https://x/', bbox: [387000, 5460000, 388000, 5461000], tiles: encodeBitmap([1], 1, 1) },
      // Claims A's SW tile 380_5460 (invalid catalog): A keeps it.
      { id: 'ort-i', name_de: 'I', ags: '10000010', state: 'SL', status: '3d', data_url: 'http://evil.example/', bbox: [380000, 5460000, 381000, 5461000], tiles: encodeBitmap([1], 1, 1) },
    );
    const c = parseCatalog(raw, CAT_URL, warn);
    expect(c.byId.has('Bad_ID')).toBe(false);
    expect(c.byId.has('ort-d')).toBe(false); // ags
    expect(c.byId.has('ort-e')).toBe(false); // bbox not on 1 km
    expect(c.byId.has('ort-f')).toBe(false); // tiles size ≠ bbox
    expect(c.byId.get('ort-g')!.status).toBe('stats'); // no data_url
    expect(c.byId.get('ort-h')!.status).toBe('stats'); // unknown status
    expect(c.byId.get('ort-i')!.status).toBe('stats'); // http on a public host is not allowed
    expect(c.owners.get('380_5460')).toBe('ort-a');
    expect(warn).toHaveBeenCalled();
  });

  it('URL rules: https anywhere, http only for local hosts, trailing slash for data_url', () => {
    expect(resolveCatalogUrl('https://a.example/x', CAT_URL, true)).toBe('https://a.example/x/');
    expect(resolveCatalogUrl('http://localhost:5246/data/ort/', CAT_URL, true)).toBe('http://localhost:5246/data/ort/');
    expect(resolveCatalogUrl('http://127.0.0.1/x/', CAT_URL)).toBe('http://127.0.0.1/x/');
    expect(resolveCatalogUrl('http://dev.localhost/x/', CAT_URL)).toBe('http://dev.localhost/x/');
    expect(resolveCatalogUrl('http://example.org/x/', CAT_URL)).toBeNull();
    expect(resolveCatalogUrl('javascript:alert(1)', CAT_URL)).toBeNull();
    expect(resolveCatalogUrl('https://u:p@a.example/', CAT_URL)).toBeNull();
    // Relative to a dev catalog on localhost.
    expect(resolveCatalogUrl('../ort-a/', 'http://localhost:5246/data/fixture-v3/catalog.json', true)).toBe('http://localhost:5246/data/ort-a/');
  });

  it('places within 8 km load (nearest first), beyond 12 km drop, fly-to target first', () => {
    const c = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
    // Camera inside A: both 3D places load, A first; C ('stats') never.
    expect(planPlaces(c.places, 381000, 5461000, new Set())).toEqual({ load: ['ort-a', 'ort-b'], drop: [] });
    // 10 km west of A: nothing loads; an active place stays (hysteresis band 8–12 km).
    expect(planPlaces(c.places, 370000, 5461000, new Set(['ort-a']))).toEqual({ load: [], drop: [] });
    // 13 km west of A: A drops.
    expect(planPlaces(c.places, 367000, 5461000, new Set(['ort-a']))).toEqual({ load: [], drop: ['ort-a'] });
    // A fly-to target loads first even when far, and is not dropped.
    expect(planPlaces(c.places, 381000, 5461000, new Set(), 'ort-b').load[0]).toBe('ort-b');
    expect(planPlaces(c.places, 300000, 5461000, new Set(['ort-b']), 'ort-b').drop).toEqual([]);
  });

  it('loadCatalog fetches with no-cache, CORS, no credentials', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(twoPlaceCatalog())));
    const c = await loadCatalog(CAT_URL, fetchFn as unknown as typeof fetch);
    expect(c.places.length).toBe(3);
    expect(fetchFn).toHaveBeenCalledWith(CAT_URL, { cache: 'no-cache', mode: 'cors', credentials: 'omit' });
    const bad = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(loadCatalog(CAT_URL, bad as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('overview sle-overview-v1', () => {
  const URL_OV = 'https://open-kirrberg.github.io/orte-katalog/overview/overview.json';
  it('parses levels from 2, resolves the base URL', () => {
    const o = parseOverview(overviewRaw(), URL_OV, quiet);
    expect(o.baseUrl).toBe('https://open-kirrberg.github.io/orte-katalog/overview/');
    expect(o.levels.map((l) => l.level)).toEqual([2, 3]);
    expect(o.levels[0].chunks).toEqual({ nx: 4, ny: 2 });
    expect(o.levels[1].chunks).toEqual({ nx: 2, ny: 1 });
    expect(o.levels[0].layers.vat.lossy).toBe(true);
    expect(o.levels[0].presence.count).toBe(3);
  });

  it('malformed levels end the list; a list not starting at 2 is rejected; bad format throws', () => {
    const raw = overviewRaw();
    (raw.levels[1] as { chunks: unknown }).chunks = { nx: 3, ny: 1 };
    expect(parseOverview(raw, URL_OV, quiet).levels.map((l) => l.level)).toEqual([2]);
    const r2 = overviewRaw();
    r2.levels.shift();
    expect(parseOverview(r2, URL_OV, quiet).levels).toEqual([]);
    const r3 = overviewRaw();
    (r3.levels[0].height.dtm as { path: string }).path = 'levels/2/dtm/{i}_{j}.avif';
    expect(parseOverview(r3, URL_OV, quiet).levels).toEqual([]);
    const r4 = overviewRaw({ bbox: [380000, 5460000, 387000, 5464000] }); // not aligned at 2 km → sizes mismatch
    expect(parseOverview(r4, URL_OV, quiet).levels).toEqual([]);
    expect(() => parseOverview({ ...overviewRaw(), format: 'x' }, URL_OV, quiet)).toThrow();
    expect(() => parseOverview({ ...overviewRaw(), grid: {} }, URL_OV, quiet)).toThrow();
  });
});
