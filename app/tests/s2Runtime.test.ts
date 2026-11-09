import { describe, expect, it, vi } from 'vitest';
import { buildSessionManifest, joinAttribution, V3_DERIVED } from '../src/catalog/session';
import { PlaceManager } from '../src/catalog/PlaceManager';
import { tileLabelPoint, tileOutlineRings } from '../src/catalog/outline';
import { parseCatalog } from '../src/data/catalog';
import { decodeBitmap, encodeBitmap } from '../src/data/globalGrid';
import { catalogUrl } from '../src/data/urls';
import { parseOverview } from '../src/data/overview';
import { dsmAt, dsmFromChm } from '../src/terrain/canopyChm';
import { adaptPreset, PRESETS } from '../src/terrain/relief';
import { CatalogResolver, sessionRect } from '../src/terrain/sources';
import { clipLinesToTiles, polygonEdgeLines, tileClipFor } from '../src/vectors/parcelEdges';
import { buildLineLayer } from '../src/vectors/vectorData';
import { overviewRaw, twoPlaceCatalog, v3Manifest } from './fixtures/v3';

const quiet = () => {};
const CAT_URL = 'http://localhost:5299/data/fixture-v3/catalog.json';
const sq = (E: number, N: number, s: number) => [[E, N], [E + s, N], [E + s, N + s], [E, N + s], [E, N]];
const fc = (...polys: number[][][]) => ({ type: 'FeatureCollection', features: polys.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [r] } })) });

describe('derived parcel lines (lines: derived)', () => {
  it('every undirected ring segment once (rounded to 0.01 m)', () => {
    // Two 10 m squares sharing the edge E = 10 (the second one's vertices 4 mm off → same after rounding).
    const o = { E0: 0, N0: 100 };
    const lines = polygonEdgeLines(fc(sq(0, 0, 10), sq(10.004, 0, 10)), o, 3);
    const segs = lines.reduce((a, l) => a + l.xz.length / 2 - 1, 0);
    expect(segs).toBe(7); // 4 + 4 − 1 shared
    expect(lines.every((l) => l.style === 3)).toBe(true);
    // Local frame: x = E − E0, z = −(N − N0).
    expect([lines[0].xz[0], lines[0].xz[1]]).toEqual([0, 100]); // (E 0, N 0) with N0 = 100
  });

  it('clips exactly at tile edges and keeps only present tiles', () => {
    // 2 × 1 tiles of 1 km, only the west one present; a line from x = 500 to x = 1500 at z = −500.
    const clip = { x0: 0, zTop: -1000, size: 1000, w: 2, h: 1, cells: Uint8Array.from([1, 0]) };
    const out = clipLinesToTiles([{ xz: Float64Array.from([500, -500, 1500, -500]), style: 0 }], clip);
    expect(out.length).toBe(1);
    expect(Array.from(out[0].xz)).toEqual([500, -500, 1000, -500]);
    // Out and back in → two pieces.
    const clip3 = { ...clip, w: 3, cells: Uint8Array.from([1, 0, 1]) };
    const two = clipLinesToTiles([{ xz: Float64Array.from([500, -500, 2500, -500]), style: 0 }], clip3);
    expect(two.map((l) => Array.from(l.xz))).toEqual([[500, -500, 1000, -500], [2000, -500, 2500, -500]]);
  });

  it('tileClipFor maps a place presence into another (session) frame', () => {
    const c = tileClipFor({ E0: 382000, N0: 5460000, H: 2000 }, decodeBitmap({ w: 2, h: 2, bits: encodeBitmap([1, 0, 1, 1], 2, 2).bits, count: 3 })!, { E0: 380000, N0: 5460000 });
    expect([c.x0, c.zTop, c.w, c.h]).toEqual([2000, -2000, 2, 2]);
  });

  it('buildLineLayer: derive + clip + densify ≤ 2 m, a shared border drawn once', () => {
    const o = { E0: 382000, N0: 5460000 };
    const clip = tileClipFor({ E0: 382000, N0: 5460000, H: 2000 }, { w: 2, h: 2, cells: Uint8Array.from([1, 0, 1, 1]) }, o);
    // Parcel straddling the empty NE tile (east half outside) + its neighbour sharing one edge.
    const d = buildLineLayer(fc(sq(382990, 5461500, 20), sq(382970, 5461500, 20)), o, 'parcel', 500, 0, { derive: 'polygon-edges', clip });
    let maxLen = 0;
    let xMax = -Infinity;
    for (const b of d.buckets) {
      for (let k = 0; k < b.count; k++) {
        const s = b.data.subarray(k * 7, k * 7 + 7);
        maxLen = Math.max(maxLen, Math.hypot(s[3] - s[0], s[5] - s[2]));
        xMax = Math.max(xMax, s[0], s[3]);
      }
    }
    expect(maxLen).toBeLessThanOrEqual(2 + 1e-9);
    expect(xMax).toBeCloseTo(1000, 6); // cut at the tile edge E = 383000
    // West square: 3 edges + 10 m of the far edge … total length inside = 20 + 20 + 20 (+ shared edge once) + 10 + 10 + 10.
    let len = 0;
    for (const b of d.buckets) for (let k = 0; k < b.count; k++) { const s = b.data.subarray(k * 7, k * 7 + 7); len += Math.hypot(s[3] - s[0], s[5] - s[2]); }
    expect(len).toBeCloseTo(20 * 4 + 10 * 2, 6);
  });

  it('OSM 2D lines (densified: false) are densified to ≤ 2 m', () => {
    const osm = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'track' }, geometry: { type: 'LineString', coordinates: [[382100, 5461000], [382110.5, 5461000]] } }] };
    const d = buildLineLayer(osm, { E0: 382000, N0: 5460000 }, 'osm', 500, 0);
    expect(d.segmentCount).toBe(6);
  });
});

describe('canopy from DTM + CHM (v3, no dsm)', () => {
  it('dsm = dtm + decoded chm, per sample', () => {
    const dtm = Float32Array.from([200, 201, 202, 203]);
    const chm = Uint8Array.from([0, 255, 51, 128]);
    expect(Array.from(dsmFromChm(dtm, chm, 0, 40))).toEqual([200, 241, 210, Math.fround(203 + (128 * 40) / 255)]);
    expect(() => dsmFromChm(dtm, Uint8Array.from([1]), 0, 40)).toThrow();
    expect(dsmAt(250, 255, 0, 40)).toBe(290);
  });
});

describe('relief presets on v3 (derived modes)', () => {
  it('maps missing baked keys to live modes; slrm → live-lrm with r = 20', () => {
    const relikte = PRESETS.find((p) => p.id === 'relikte')!;
    const valid = new Set(['vat', 'svf', 'opns_pos', 'live-lrm', 'live-hillshade', 'live-slope']);
    const a = adaptPreset(relikte, (k) => valid.has(k), V3_DERIVED);
    expect(a.base).toBe('vat');
    expect(a.overlay?.key).toBe('live-lrm');
    expect(a.lrmRadius).toBe(20);
    expect(adaptPreset(relikte, () => true, V3_DERIVED)).toBe(relikte);
    expect(adaptPreset(relikte, () => false, undefined)).toBe(relikte);
  });
});

describe('minimap outlines of catalog places', () => {
  it('outer ring around an L of three tiles, clockwise, collinear points removed', () => {
    const bm = { w: 2, h: 2, cells: Uint8Array.from([1, 0, 1, 1]), count: 3 };
    const rings = tileOutlineRings([0, 0, 2000, 2000], bm);
    expect(rings.length).toBe(1);
    expect(rings[0]).toEqual([[0, 2000], [1000, 2000], [1000, 1000], [2000, 1000], [2000, 0], [0, 0], [0, 2000]]);
    expect(tileLabelPoint([0, 0, 2000, 2000], bm)).toEqual([500, 500]);
  });
  it('corner-touching tiles give two rings; empty → none', () => {
    expect(tileOutlineRings([0, 0, 2000, 2000], { w: 2, h: 2, cells: Uint8Array.from([1, 0, 0, 1]), count: 2 }).length).toBe(2);
    expect(tileLabelPoint([0, 0, 1000, 1000], { w: 1, h: 1, cells: Uint8Array.from([0]), count: 0 })).toBeNull();
  });
});

describe('VITE_CATALOG_URL', () => {
  it('unset / ?aoi= / non-http → single-AOI mode (null)', () => {
    // Hermetic: the public Pages build sets VITE_CATALOG_URL for the whole job, tests included.
    vi.stubEnv('VITE_CATALOG_URL', '');
    try {
      expect(catalogUrl(undefined, 'http://localhost:5240/', '')).toBeNull();
      vi.stubEnv('VITE_CATALOG_URL', 'https://example.org/orte/catalog.json');
      expect(catalogUrl(undefined, 'http://localhost:5240/', '')).toBe('https://example.org/orte/catalog.json');
    } finally {
      vi.unstubAllEnvs();
    }
    expect(catalogUrl('', 'http://localhost:5240/', '')).toBeNull();
    expect(catalogUrl('data/fixture-v3/catalog.json', 'http://localhost:5240/', '?aoi=overall')).toBeNull();
    expect(catalogUrl('javascript:alert(1)', 'http://localhost:5240/', '')).toBeNull();
    expect(catalogUrl('data/fixture-v3/catalog.json', 'http://localhost:5240/app/', '')).toBe('http://localhost:5240/app/data/fixture-v3/catalog.json');
    expect(catalogUrl('https://example.org/orte/catalog.json', 'http://localhost:5240/', '')).toBe('https://example.org/orte/catalog.json');
  });
});

function session() {
  const cat = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
  const ov = parseOverview(overviewRaw(), 'http://localhost:5299/data/fixture-v3/overview/overview.json', quiet);
  const { rect, topLevel } = sessionRect(cat, ov);
  return { cat, ov, rect, topLevel, res: new CatalogResolver(cat, ov, rect) };
}

describe('session manifest', () => {
  it('v3 over the session rectangle, origin = its SW corner, levels 0 … K, hRef inside the range', () => {
    const { cat, ov, rect, topLevel } = session();
    const m = buildSessionManifest(cat, ov, rect, topLevel);
    expect(m.version).toBe(3);
    expect(m.origin).toEqual({ E0: 380000, N0: 5460000 });
    expect(m.size).toEqual({ width: 8000, height: 4000 });
    expect(m.levels!.map((l) => [l.level, l.chunks.nx, l.chunks.ny])).toEqual([[0, 16, 8], [1, 8, 4], [2, 4, 2], [3, 2, 1]]);
    expect(m.levels![2].layers.vat.path).toBe('levels/2/vat/{i}_{j}.avif');
    expect(m.derived?.vat?.method).toBe('rvt-vat-combined-v1');
    expect(m.heightRange.min).toBeLessThanOrEqual(cat.height_ref_m);
  });
  it('joinAttribution keeps each entry once', () => {
    expect(joinAttribution('a; b', undefined, 'b;c', 'a')).toBe('a; b; c');
  });
});

describe('PlaceManager', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as unknown as Response;

  it('loads near places with CORS / no credentials, strips AVIF without support, fails bad manifests', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { cat, res } = session();
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.includes('ort-b')) return ok(v3Manifest());
      return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    }) as unknown as typeof fetch;
    let avifMissing = 0;
    const pm = new PlaceManager(cat, res, { avif: false, fetchFn, onAvifMissing: () => avifMissing++ });
    let changes = 0;
    pm.onChange(() => changes++);
    pm.update(383000, 5461000);
    await vi.waitFor(() => expect(res.placeLoad('ort-b').state).toBe('ready'));
    await vi.waitFor(() => expect(res.placeLoad('ort-a').state).toBe('failed'));
    expect(calls.map((c) => c[0]).sort()).toEqual(['http://localhost:5299/data/ort-b/manifest.json', 'https://example.org/ort-a/manifest.json']);
    expect(calls.every(([, i]) => i?.mode === 'cors' && i?.credentials === 'omit')).toBe(true);
    expect(calls.some(([u]) => u.includes('ort-c'))).toBe(false); // 'stats' place: never fetched
    const b = pm.ready().find((r) => r.place.id === 'ort-b')!;
    expect(b.manifest.layers.svf).toBeUndefined(); // AVIF stripped
    expect(b.manifest.layers.chm).toBeDefined();
    expect(avifMissing).toBeGreaterThan(0);
    expect(changes).toBeGreaterThanOrEqual(2);
    // Far away (> 12 km) → dropped back to idle.
    pm.update(383000 + 20000, 5461000);
    expect(res.placeLoad('ort-b').state).toBe('idle');
    warn.mockRestore();
  });

  it('a manifest for another place is rejected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { cat, res } = session();
    const fetchFn = (async () => ok(v3Manifest({ place: { id: 'ort-x', ags: '10000002' } }))) as unknown as typeof fetch;
    const pm = new PlaceManager(cat, res, { avif: true, fetchFn });
    await pm.ensure('ort-b');
    expect(res.placeLoad('ort-b').state).toBe('failed');
    warn.mockRestore();
  });
});
