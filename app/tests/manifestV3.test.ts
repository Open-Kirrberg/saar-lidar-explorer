import { describe, expect, it, vi } from 'vitest';
import { encodeBitmap, GLOBAL_GRID } from '../src/data/globalGrid';
import { v3Manifest } from './fixtures/v3';
import { checkU8Layer, isAvifPath, parseDerived, parseVectors, stripAvif, validateManifest } from '../src/data/manifest';
import { liveVat, slopeDeg, vatError, vatHillshade, vatPreset, VAT_FLAT, VAT_GENERAL, liveVatChunk } from '../src/terrain/liveVat';

describe('manifest version 3', () => {
  it('loads a v3 place: grid, presence, place, derived, avif layers, level 1', () => {
    const m = validateManifest(v3Manifest());
    expect(m.version).toBe(3);
    expect(m.gridOk).toBe(true);
    expect(m.place).toEqual({ id: 'ort-b', ags: '10000002' });
    expect(m.presence!.count).toBe(3);
    expect(m.pipeline).toBe('0.9.0');
    expect(Object.keys(m.derived!)).toEqual(['hillshade', 'slope', 'slrm', 'vat']);
    expect(m.layers.svf.lossy).toBe(true);
    expect(m.imageLayers.ortho.format).toBe('avif');
    expect(m.levels.length).toBe(2);
    expect(m.levels[1].layers.vat.lossy).toBe(true);
    expect(m.levels[1].imageLayers!.ortho.pixelsPerChunk).toBe(500);
    expect(m.height.dsm).toBeUndefined();
  });

  it('v1 and v2 manifests are unchanged (no v3 keys)', () => {
    const v2 = { ...v3Manifest(), version: 2, presence: undefined, derived: undefined, grid: undefined };
    const m = validateManifest(v2);
    expect(m.version).toBe(2);
    expect(m.gridOk).toBeUndefined();
    expect(m.presence).toBeUndefined();
    expect(m.derived).toBeUndefined();
    const v1 = validateManifest({ ...v2, version: 1 });
    expect(v1.levels.length).toBe(1);
    expect(() => validateManifest({ ...v2, version: 4 })).toThrow();
  });

  it('tolerance: bad grid / unaligned rectangle only disables placement; invalid presence → all present + flag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateManifest(v3Manifest({ grid: { ...GLOBAL_GRID, chunk_m: 250 } })).gridOk).toBe(false);
    expect(validateManifest(v3Manifest({ origin: { E0: 382500, N0: 5460000 } })).gridOk).toBe(false);
    const bad = validateManifest(v3Manifest({ presence: { w: 2, h: 2, bits: 'DQ==', count: 1 } }));
    expect(bad.presenceInvalid).toBe(true);
    expect(bad.presence).toBeUndefined();
    const wrongSize = validateManifest(v3Manifest({ presence: encodeBitmap([1, 1, 1], 3, 1) }));
    expect(wrongSize.presenceInvalid).toBe(true);
    warn.mockRestore();
  });

  it('format rules: terrarium never AVIF; data layers never AVIF; format must match the extension', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => validateManifest(v3Manifest({ height: { dtm: { path: 'dtm/{i}_{j}.avif', encoding: 'terrarium', apron: 1 } } }))).toThrow();
    const m = validateManifest(v3Manifest({
      layers: {
        chm: { path: 'relief/chm/{i}_{j}.avif', encoding: 'u8', min: 0, max: 40 },
        svf: { path: 'relief/svf/{i}_{j}.avif', encoding: 'u8', min: 0.6, max: 1 }, // no lossy flag → set
        bldg: { path: 'relief/bldg/{i}_{j}.webp', encoding: 'u8', min: 0, max: 1, format: 'png' },
        mask: { path: 'relief/mask/{i}_{j}.webp', encoding: 'u8', min: 0, max: 1, format: 'webp' },
      },
    }));
    expect(m.layers.chm).toBeUndefined();
    expect(m.layers.svf.lossy).toBe(true);
    expect(m.layers.bldg).toBeUndefined();
    expect(m.layers.mask).toBeDefined();
    // svf without opns_pos → the derived vat entry is dropped (inputs are not layers).
    expect(m.derived?.vat).toBeUndefined();
    expect(isAvifPath('a/b.avif')).toBe(true);
    expect(isAvifPath('a/b.avif?x=1')).toBe(true);
    expect(isAvifPath('a/b.webp')).toBe(false);
    expect(checkU8Layer('vat', { path: 'x.png', encoding: 'u8', min: 0, max: 1 })).toBeDefined();
    warn.mockRestore();
  });

  it('derived: unknown methods and missing inputs are ignored', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const layers = { svf: { path: 's', encoding: 'u8' as const, min: 0.6, max: 1 }, opns_pos: { path: 'o', encoding: 'u8' as const, min: 60, max: 95 } };
    const d = parseDerived({
      vat: { method: 'rvt-vat-combined-v1', inputs: ['svf', 'opns_pos'], label_de: 'VAT' },
      foo: { method: 'magic', label_de: 'x' },
      bar: { method: 'rvt-vat-combined-v1', inputs: ['svf', 'nope'], label_de: 'x' },
      baz: { method: 'rvt-vat-combined-v1', inputs: ['svf'], label_de: 'x' },
    }, layers)!;
    expect(Object.keys(d)).toEqual(['vat']);
    warn.mockRestore();
  });

  it('without AVIF: every .avif layer is absent and the derived vat falls back', () => {
    const m = validateManifest(v3Manifest());
    const n = stripAvif(m);
    expect(n).toBe(5); // svf, opns_pos, ortho (level 0) + vat, ortho (level 1)
    expect(m.layers.svf).toBeUndefined();
    expect(m.imageLayers.ortho).toBeUndefined();
    expect(m.levels[0].layers.svf).toBeUndefined();
    expect(m.levels[1].layers.vat).toBeUndefined();
    expect(m.levels[1].imageLayers!.ortho).toBeUndefined();
    expect(m.derived!.vat).toBeUndefined();
    expect(m.derived!.hillshade).toBeDefined();
    expect(m.layers.chm).toBeDefined();
  });

  it('vectors v3: OSM densified false, parcels with derived lines need polygons', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = parseVectors({
      osm: { path: 'vectors/osm.geojson', crs: 'EPSG:25832', densified: false },
      flurstuecke: { lines: 'derived', crs: 'EPSG:25832', labels: 'vectors/l.geojson', polygons: 'vectors/p.geojson' },
    })!;
    expect(v.osm!.densified).toBe(false);
    expect(v.flurstuecke!.lines).toBe('derived');
    expect(v.flurstuecke!.path).toBe('');
    expect(parseVectors({ flurstuecke: { lines: 'derived', crs: 'EPSG:25832', labels: 'l' } })).toBeUndefined();
    // Old manifests keep their baked boundary file.
    const old = parseVectors({ flurstuecke: { path: 'vectors/f.geojson', crs: 'EPSG:25832', labels: 'l' } })!;
    expect(old.flurstuecke!.lines).toBeUndefined();
    expect(old.flurstuecke!.path).toBe('vectors/f.geojson');
    warn.mockRestore();
  });
});

describe('live VAT rvt-vat-combined-v1 (TS reference of the shader)', () => {
  it('flat ground: hs = sin 35°, slope 0 — hand-computed per the contract', () => {
    expect(vatHillshade(0, 0)).toBeCloseTo(Math.sin((35 * Math.PI) / 180), 9);
    expect(slopeDeg(0, 0)).toBe(0);
    // general: r1 = 0.5 + 0.5·0.573576 = 0.786788; o = 22/25 = 0.88; r2 = 1 − (1 − 2·0.286788)·0.12 = 0.948829; svf 1 → v 1 → VAT = r2
    expect(vatPreset(vatHillshade(0, 0), 0, 1, 90, VAT_GENERAL)).toBeCloseTo(0.948829, 5);
    // flat: o = 5/6; r2 = 1 − 0.426424 · (1/6) = 0.928929
    expect(vatPreset(vatHillshade(0, 0), 0, 1, 90, VAT_FLAT)).toBeCloseTo(0.928929, 5);
    expect(liveVat(0, 0, 1, 90)).toBeCloseTo(0.938879, 5);
  });

  it('45° east-facing slope, O = 70°, svf 0.8 — dark branch of the overlay', () => {
    // n = (−1, 0, 1)/√2, L = (−0.579228, 0.579228, 0.573576) → hs = 0.815154
    expect(vatHillshade(1, 0)).toBeCloseTo(0.815154, 5);
    expect(slopeDeg(1, 0)).toBeCloseTo(45, 9);
    // general: r1 = 0.05 + 0.407577 = 0.457577 (≤ 0.5) → r2 = 2·r1·0.08 = 0.073212; v = 1/3 → 0.061010
    expect(vatPreset(0.815154, 45, 0.8, 70, VAT_GENERAL)).toBeCloseTo(0.06101, 5);
    // flat: o = clamp(−15/6) = 0 → 0
    expect(vatPreset(0.815154, 45, 0.8, 70, VAT_FLAT)).toBe(0);
    expect(liveVat(1, 0, 0.8, 70)).toBeCloseTo(0.030505, 5);
  });

  it('the sun comes from the north-west: a NW-facing slope is brighter than a SE-facing one', () => {
    // NW-facing: the ground rises to the south-east → ∂h/∂E > 0, ∂h/∂N < 0.
    expect(vatHillshade(0.3, -0.3)).toBeGreaterThan(vatHillshade(-0.3, 0.3));
    expect(vatHillshade(-10, 10)).toBe(0); // clamped
  });

  it('chunk evaluation uses the apron for central differences (row 0 = north) and the error metric', () => {
    const n = 4;
    const S = n + 2;
    const h = new Float32Array(S * S);
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) h[r * S + c] = 100 + 0.5 * c - 0.25 * r; // rises east and north
    const svf = new Uint8Array(n * n).fill(255);
    const opn = new Uint8Array(n * n).fill(200);
    const out = liveVatChunk(h, svf, opn, n, { min: 0.6, max: 1 }, { min: 60, max: 95 });
    const O = 60 + (200 / 255) * 35;
    expect(out[5]).toBeCloseTo(liveVat(0.5, 0.25, 1, O), 6);
    const baked = Uint8Array.from(out, (v) => Math.round(v * 255));
    baked[0] += 3;
    const e = vatError(out, baked);
    expect(e.max).toBe(3);
    expect(e.mean).toBeCloseTo(3 / 16, 6);
  });
});
