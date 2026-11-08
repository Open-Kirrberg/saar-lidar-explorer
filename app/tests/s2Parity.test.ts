/**
 * S2 catalog-mode parity: overview coverage (contract 3.1 „Overview no-data“), per-place relict
 * candidates (F15, ADR 0053), per-place layer tables (historic maps), minimap XYZ names, report /
 * Riesen scoping and the legacy-store seeding.
 */
import { describe, expect, it, vi } from 'vitest';
import { ownerAt, sessionCoverageIds } from '../src/catalog';
import { inCatalog3d } from '../src/catalog/leaderboard';
import { buildSessionManifest, mergePlaceTables, seedFromLegacy } from '../src/catalog/session';
import type { Candidate } from '../src/candidates/candidateData';
import { loadReviewsSeeded, reattachWithin } from '../src/candidates/reviewStore';
import {
  addCandidates,
  catalogMayHaveCandidates,
  clipToPlace,
  defaultCandidateMeta,
  mergeCandidateMeta,
  placeCandidatesAllowed,
  sortCandidates,
} from '../src/candidates/source';
import { parseCatalog } from '../src/data/catalog';
import { encodeBitmap } from '../src/data/globalGrid';
import { candidatesStorageKey, validateManifest } from '../src/data/manifest';
import type { Manifest, ManifestCandidates } from '../src/data/manifest';
import { parseOverview } from '../src/data/overview';
import { placeXyzOverlay } from '../src/map/overlays';
import { coverageGrid, coverageTileIds, isCovered } from '../src/terrain/coverage';
import { CatalogResolver, sessionRect } from '../src/terrain/sources';
import { Terrain } from '../src/terrain/Terrain';
import { overviewRaw, twoPlaceCatalog, v3Manifest } from './fixtures/v3';

const CAT_URL = 'https://example.org/orte-katalog/catalog.json';
const quiet = () => {};

/** Overview bbox [380000, 5460000, 388000, 5464000] → coverage 8 × 4 tiles, row 0 = north. */
function cov(cells: number[]) {
  return encodeBitmap(cells, 8, 4);
}

function memKV(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
}

function cand(id: string, E: number, N: number, extra: Partial<Candidate> = {}): Candidate {
  return { id, cls: 'pit', score: 0.5, E, N, z: NaN, metrics: {}, reasons: ['x'], forest: false, nearPath: false, alongPath: false, nearKnown: null, ...extra };
}

describe('overview coverage (revision 3.1)', () => {
  it('parses a valid bitmap; bit (col, row) is tile (Emin/1000 + col, Nmax/1000 − 1 − row)', () => {
    const cells = new Array(32).fill(0);
    cells[0] = 1; // col 0, row 0 → 380_5463 (north-west)
    cells[3 * 8 + 7] = 1; // col 7, row 3 → 387_5460 (south-east)
    const o = parseOverview(overviewRaw({ coverage: cov(cells) }), CAT_URL, quiet);
    expect(o.coverage?.count).toBe(2);
    expect(coverageTileIds(o.coverage!, o.bbox)).toEqual(['380_5463', '387_5460']);
  });

  it('ignores (with a warning) a wrong size, bad base64 or a count mismatch; absent stays absent', () => {
    for (const bad of [
      encodeBitmap(new Array(16).fill(1), 4, 4),
      { w: 8, h: 4, bits: '!!!!', count: 0 },
      { ...cov(new Array(32).fill(1)), count: 31 },
    ]) {
      const warn = vi.fn();
      const o = parseOverview(overviewRaw({ coverage: bad }), CAT_URL, warn);
      expect(o.coverage).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^coverage .*ignored/));
      expect(o.levels.length).toBe(2); // the levels are unaffected
    }
    expect(parseOverview(overviewRaw(), CAT_URL, quiet).coverage).toBeUndefined();
  });

  it('session coverage: the overview bitmap when valid (incl. unowned tiles), else the owned tiles', () => {
    const cat = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
    const cells = new Array(32).fill(0);
    cells[3 * 8 + 7] = 1; // 387_5460: real data, no owner
    cells[3 * 8 + 0] = 1; // 380_5460: owned by ort-a
    const withCov = parseOverview(overviewRaw({ coverage: cov(cells) }), CAT_URL, quiet);
    expect([...sessionCoverageIds(cat, withCov)].sort()).toEqual(['380_5460', '387_5460']);
    const without = parseOverview(overviewRaw(), CAT_URL, quiet);
    expect([...sessionCoverageIds(cat, without)].sort()).toEqual([...cat.owners.keys()].sort());
    expect([...sessionCoverageIds(cat, null)].length).toBe(cat.owners.size);
    // Into the session grid (row 0 = south): the far-east unowned tile is covered.
    const { rect } = sessionRect(cat, withCov);
    const g = coverageGrid(sessionCoverageIds(cat, withCov), rect);
    expect(isCovered(g, 387500 - rect.E0, -(5460500 - rect.N0))).toBe(true);
    expect(isCovered(g, 381500 - rect.E0, -(5460500 - rect.N0))).toBe(false); // owned but no source data
    expect(isCovered(g, -10, -10)).toBe(false); // outside the rectangle
  });

  it('Terrain height readers answer NaN outside covered tiles (no readout, clamp, pick or profile from filler)', () => {
    const g = coverageGrid(['380_5460'], { E0: 380000, N0: 5460000, W: 2000, H: 1000 });
    const fake = {
      coverage: g,
      heights: { heightAt: () => 250, heightAtDisplayed: () => 250 },
      canopyHeights: { loadedCount: 1, heightAt: () => 270 },
      uniforms: { uHRef: { value: 200 }, uExag: { value: 2 } },
      covered: Terrain.prototype.covered,
      toDisplayY: Terrain.prototype.toDisplayY,
    };
    const T = Terrain.prototype;
    expect(T.heightAt.call(fake as never, 500, -500)).toBe(250);
    expect(T.surfaceY.call(fake as never, 500, -500)).toBe(300);
    expect(T.canopyHeightAt.call(fake as never, 500, -500)).toBe(270);
    expect(T.heightAt.call(fake as never, 1500, -500)).toBeNaN();
    expect(T.surfaceY.call(fake as never, 1500, -500)).toBeNaN();
    expect(T.canopyHeightAt.call(fake as never, 1500, -500)).toBeNaN();
    // Single-AOI (no coverage): everything counts.
    expect(T.heightAt.call({ ...fake, coverage: null } as never, 1500, -500)).toBe(250);
  });
});

describe('per-place relict candidates (F15 in catalog mode)', () => {
  const cat = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
  const mB = validateManifest(v3Manifest()); // ort-b: 382000–384000 × 5460000–5462000, NE tile absent

  it('opt-in: manifest candidates and no catalog opt-out (ADR 0053)', () => {
    const meta = { path: 'candidates/candidates.geojson' } as ManifestCandidates;
    expect(placeCandidatesAllowed({}, { candidates: meta })).toBe(true);
    expect(placeCandidatesAllowed({ options: { relict_candidates: true } }, { candidates: meta })).toBe(true);
    expect(placeCandidatesAllowed({ options: { relict_candidates: false } }, { candidates: meta })).toBe(false);
    expect(placeCandidatesAllowed({ options: { relict_candidates: true } }, {})).toBe(false);
    expect(catalogMayHaveCandidates([{ status: 'stats' }, { status: '3d', options: { relict_candidates: false } }])).toBe(false);
    expect(catalogMayHaveCandidates([{ status: 'building' }])).toBe(true);
  });

  it('clips to the place’s owned + present tiles, so a border candidate is kept once', () => {
    const list = [
      cand('pit-382500-5460500', 382500, 5460500), // ort-b SW tile (present)
      cand('pit-383500-5461500', 383500, 5461500), // ort-b NE tile: owned? no (bit 0) → dropped
      cand('pit-381500-5460500', 381500, 5460500), // ort-a's tile (a stale run over the border) → dropped
      cand('pit-383500-5460500', 383500, 5460500), // SE (present)
    ];
    const kept = clipToPlace(list, 'ort-b', cat.owners, mB);
    expect(kept.map((c) => c.id)).toEqual(['pit-382500-5460500', 'pit-383500-5460500']);
    // The neighbour publishes the border candidate too: kept once (first id wins), both lists merged.
    const byId = new Map<string, Candidate>();
    expect(addCandidates(byId, kept)).toBe(2);
    expect(addCandidates(byId, [cand('pit-382500-5460500', 382500, 5460500), cand('mound-1', 380500, 5460500, { cls: 'mound', score: 0.9 })])).toBe(1);
    expect(sortCandidates([...byId.values()]).map((c) => c.id)).toEqual(['mound-1', 'pit-382500-5460500', 'pit-383500-5460500']);
  });

  it('merged metadata: counts over the loaded candidates, method versions once, latest run', () => {
    const a = { ...defaultCandidateMeta(), method: 'lrm-rules', version: 2, generated: '2026-11-01T00:00:00Z', params: { min_score: 0.4 } };
    const b = { ...defaultCandidateMeta(), method: 'lrm-rules', version: 2, generated: '2026-11-08T00:00:00Z' };
    const m = mergeCandidateMeta([a, b], [cand('p', 0, 0), cand('m', 0, 0, { cls: 'mound' })]);
    expect(m.featureCount).toBe(2);
    expect(m.counts).toEqual({ pit: 1, mound: 1 });
    expect(m.method_versions).toEqual(['lrm-rules v2']);
    expect(m.generated).toBe('2026-11-08T00:00:00Z');
    expect(m.params).toEqual({ min_score: 0.4 }); // first place's params → default min score
    expect(mergeCandidateMeta([], []).featureCount).toBe(0);
  });

  it('review re-attachment only moves decisions inside loaded places', () => {
    const store = {
      version: 1 as const,
      decisions: {
        'pit-old-a': { status: 'confirmed' as const, at: '2026-01-01T00:00:00Z', class: 'pit' as const, E: 382501, N: 5460500, score: 0.5 },
        'pit-old-b': { status: 'rejected' as const, at: '2026-01-01T00:00:00Z', class: 'pit' as const, E: 380501, N: 5460500, score: 0.5 },
      },
    };
    const loaded = [cand('pit-382500-5460500', 382500, 5460500), cand('pit-380500-5460500', 380500, 5460500)];
    const r = reattachWithin(store, loaded, (E) => E >= 382000); // only ort-b loaded
    expect(r.moved).toBe(1);
    expect(Object.keys(r.store.decisions).sort()).toEqual(['pit-382500-5460500', 'pit-old-b']);
  });

  it('catalog review store `katalog` is seeded once from the deployed single-AOI store', () => {
    const d = { status: 'unsure', at: '2026-01-01T00:00:00Z', class: 'pit', E: 1, N: 2, score: 0.4 };
    const kv = memKV({ [candidatesStorageKey('overall')]: JSON.stringify({ version: 1, decisions: { 'pit-1-2': d } }) });
    const s = loadReviewsSeeded(kv, 'katalog', ['overall']);
    expect(Object.keys(s.decisions)).toEqual(['pit-1-2']);
    expect(kv.map.has(candidatesStorageKey('katalog'))).toBe(true);
    // Later: the catalog store wins, nothing is merged again.
    kv.setItem(candidatesStorageKey('katalog'), JSON.stringify({ version: 1, decisions: {} }));
    expect(Object.keys(loadReviewsSeeded(kv, 'katalog', ['overall']).decisions)).toEqual([]);
  });

  it('seedFromLegacy copies a store once (measurements)', () => {
    const kv = memKV({ 'sle.measure.v1.overall': '{"version":1}' });
    expect(seedFromLegacy(kv, 'sle.measure.v1.katalog', ['sle.measure.v1.overall'])).toBe('sle.measure.v1.overall');
    expect(kv.getItem('sle.measure.v1.katalog')).toBe('{"version":1}');
    expect(seedFromLegacy(kv, 'sle.measure.v1.katalog', ['sle.measure.v1.overall'])).toBeNull();
    expect(seedFromLegacy(null, 'x', ['y'])).toBeNull();
  });
});

describe('per-place layer tables (historic maps, F14 in catalog mode)', () => {
  const HIST = {
    hist_1840: { path: 'hist_1840/{i}_{j}.jpg', encoding: 'rgb', format: 'jpg', pixelsPerChunk: 500, kind: 'image', label_de: 'Karte 1836–41', attribution: '© GeoBasis-DE/LVGL-SL (2026) (Historische Karten)' },
    hist_1935: { path: 'hist_1935/{i}_{j}.jpg', encoding: 'rgb', format: 'jpg', pixelsPerChunk: 500, kind: 'image', label_de: 'TK25 1935–40' },
  };

  function session(first?: Manifest): Manifest {
    const cat = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);
    const ov = parseOverview(overviewRaw(), CAT_URL, quiet);
    const { rect, topLevel } = sessionRect(cat, ov);
    return buildSessionManifest(cat, ov, rect, topLevel, first);
  }

  it('a later place’s historic maps join the session tables; existing keys and place manifests stay untouched', () => {
    const first = validateManifest(v3Manifest());
    const s = session(first);
    expect(s.imageLayers.hist_1840).toBeUndefined();
    const withHist = validateManifest(v3Manifest({ layers: { ...(v3Manifest().layers as object), ...HIST } }));
    const added = mergePlaceTables(s, withHist);
    expect(added.sort()).toEqual(['hist_1840', 'hist_1935']);
    expect(s.imageLayers.hist_1840.label_de).toBe('Karte 1836–41');
    expect(s.levels![0].imageLayers?.hist_1840).toBeDefined(); // level 0 shares the table
    expect(first.imageLayers.hist_1840).toBeUndefined(); // the start place's manifest is not mutated
    expect(first.levels![1].imageLayers?.hist_1840).toBeUndefined();
    expect(mergePlaceTables(s, withHist)).toEqual([]); // idempotent
  });

  it('without historic maps nothing is added (the „Bilder“ row stays as it was)', () => {
    const s = session(validateManifest(v3Manifest()));
    const keys = Object.keys(s.imageLayers);
    expect(mergePlaceTables(s, validateManifest(v3Manifest()))).toEqual([]);
    expect(Object.keys(s.imageLayers)).toEqual(keys);
  });

  it('minimap: v3 place XYZ names match single-AOI names (vat from `derived`, hist from the image layer)', () => {
    const m = validateManifest(v3Manifest({ layers: { ...(v3Manifest().layers as object), ...HIST } }));
    expect(placeXyzOverlay('vat', { url: 'xyz/vat/{z}/{x}/{y}.png', minZoom: 12, maxZoom: 16 }, m)).toMatchObject({ name: 'Relief: VAT (Kombination)', image: false });
    expect(placeXyzOverlay('hist_1840', { url: 'xyz/hist_1840/{z}/{x}/{y}.png', minZoom: 12, maxZoom: 17 }, m)).toMatchObject({ name: 'Karte 1836–41', image: true });
  });
});

describe('catalog scoping (Riesen, report)', () => {
  const cat = parseCatalog(twoPlaceCatalog(), CAT_URL, quiet);

  it('Riesen collecting counts only the 3D area (tiles of 3d / building places)', () => {
    expect(inCatalog3d(cat, 380500, 5460500)).toBe(true); // ort-a '3d'
    expect(inCatalog3d(cat, 382500, 5460500)).toBe(true); // ort-b 'building'
    expect(inCatalog3d(cat, 384500, 5460500)).toBe(false); // ort-c 'stats'
    expect(inCatalog3d(cat, 390500, 5460500)).toBe(false); // no owner
  });

  it('ownerAt: the tile owner with its manifest once ready (report map + name)', () => {
    const ov = parseOverview(overviewRaw(), CAT_URL, quiet);
    const resolver = new CatalogResolver(cat, ov, sessionRect(cat, ov).rect);
    const s = { catalog: cat, resolver };
    expect(ownerAt(s, 382500, 5460500)).toMatchObject({ place: { id: 'ort-b' } });
    expect(ownerAt(s, 382500, 5460500)?.manifest).toBeUndefined();
    const m = validateManifest(v3Manifest());
    resolver.setPlace('ort-b', { state: 'ready', manifest: m, baseUrl: 'https://example.org/ort-b/' });
    expect(ownerAt(s, 382500, 5460500)?.manifest).toBe(m);
    expect(ownerAt(s, 390500, 5460500)).toBeNull();
  });
});
