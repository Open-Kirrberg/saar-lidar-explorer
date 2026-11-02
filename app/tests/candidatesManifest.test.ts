import { describe, expect, it, vi } from 'vitest';
import {
  CANDIDATE_CLASS_LABELS_DE,
  CANDIDATE_MASK_CODES,
  candidatesStorageKey,
  isCandidateClass,
  parseCandidates,
  validateManifest,
} from '../src/data/manifest';

const grid = { nx: 2, ny: 2 };

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

const full = {
  path: 'candidates/candidates.geojson',
  crs: 'EPSG:25832',
  featureCount: 7,
  heights: 'baked',
  counts: { pit: 4, mound: 2, linear: 1, bogus: 9, rect: 'x' },
  classes: { pit: 'Grube', nope: 'X' },
  method: 'lrm-rules',
  version: 1,
  generated: '2026-11-01T12:00:00Z',
  params: { threshold_m: 0.3 },
  weights: { depth: 0.4, bad: 'x' },
  mask: { path: 'candidates/mask/{i}_{j}.png', encoding: 'class8', minScore: 0.3, chunks: [[0, 1], [5, 5], [0, 1], [1.5, 0]] },
  label_de: 'Kandidaten',
};

describe('parseCandidates', () => {
  it('parses a full entry with defaults merged and junk dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = parseCandidates(full, grid)!;
    expect(c.path).toBe('candidates/candidates.geojson');
    expect(c.featureCount).toBe(7);
    expect(c.heights).toBe('baked');
    expect(c.counts).toEqual({ pit: 4, mound: 2, linear: 1 });
    expect(c.classes.pit).toBe('Grube');
    expect(c.classes.mound).toBe(CANDIDATE_CLASS_LABELS_DE.mound);
    expect((c.classes as Record<string, string>).nope).toBeUndefined();
    expect(c.weights).toEqual({ depth: 0.4 });
    expect(c.mask).toEqual({ path: 'candidates/mask/{i}_{j}.png', encoding: 'class8', minScore: 0.3, chunks: [[0, 1]] });
    expect(c.label_de).toBe('Kandidaten');
    expect(c.version).toBe(1);
    warn.mockRestore();
  });

  it('defaults optional fields', () => {
    const c = parseCandidates({ path: 'c.geojson', crs: 'EPSG:25832' }, grid)!;
    expect(c).toEqual({
      path: 'c.geojson', crs: 'EPSG:25832', featureCount: 0, counts: {},
      classes: { ...CANDIDATE_CLASS_LABELS_DE }, method: '', version: 0, params: {}, label_de: 'Verdachtsflächen',
    });
    expect(c.mask).toBeUndefined();
  });

  it('rejects missing path / wrong crs, drops a malformed mask', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseCandidates(undefined, grid)).toBeUndefined();
    expect(parseCandidates(null, grid)).toBeUndefined();
    expect(parseCandidates({ crs: 'EPSG:25832' }, grid)).toBeUndefined();
    expect(parseCandidates({ path: 'c.geojson', crs: 'EPSG:4326' }, grid)).toBeUndefined();
    const c = parseCandidates({ path: 'c.geojson', crs: 'EPSG:25832', mask: { path: 'm/{i}_{j}.png', encoding: 'u8' } }, grid)!;
    expect(c.mask).toBeUndefined();
    const m = parseCandidates({ path: 'c.geojson', crs: 'EPSG:25832', mask: { path: 'm/{i}_{j}.png', encoding: 'class8' } }, grid)!;
    expect(m.mask).toEqual({ path: 'm/{i}_{j}.png', encoding: 'class8', minScore: 0 });
    warn.mockRestore();
  });
});

describe('validateManifest + candidates', () => {
  it('carries candidates through and omits them when absent/invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateManifest({ ...base, candidates: full }).candidates?.counts.pit).toBe(4);
    expect('candidates' in validateManifest(base)).toBe(false);
    expect('candidates' in validateManifest({ ...base, candidates: { path: 1 } })).toBe(false);
    warn.mockRestore();
  });
});

describe('candidate constants', () => {
  it('class codes, guard and storage key', () => {
    expect(Object.values(CANDIDATE_MASK_CODES)).toEqual(['pit', 'mound', 'linear', 'rect', 'platform', 'crater', 'crater_field']);
    expect(CANDIDATE_MASK_CODES[6]).toBe('crater');
    expect(CANDIDATE_MASK_CODES[7]).toBe('crater_field');
    expect(isCandidateClass('rect')).toBe(true);
    expect(isCandidateClass('wall')).toBe(false);
    expect(candidatesStorageKey('karlsberg')).toBe('sle.candidates.v1.karlsberg');
  });
});
