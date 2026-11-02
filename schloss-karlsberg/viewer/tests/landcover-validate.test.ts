// Validation of the catalogue's top-level `landcover` list (KB-I09 follow-up: typed in model/src/spec.ts, checked in
// model/src/validate.ts). Lives in viewer/tests because the ground subsystem owns the land cover end to end.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANDCOVER_COVERS, type LandcoverArea, type SiteSpec } from '@model/spec.ts';
import { validateSite } from '@model/validate.ts';

const cat = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../model/catalogue.json'), 'utf8')) as SiteSpec;

const square: LandcoverArea = {
  id: 'LC-99',
  cover: 'hay',
  name_de: 'Testwiese',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [382000, 5466000],
        [382100, 5466000],
        [382100, 5466100],
        [382000, 5466100],
        [382000, 5466000],
      ],
    ],
  },
  confidence: 'low',
  tag: 'cover I (test)',
};
const withLc = (lc: unknown[]) => ({ ...structuredClone(cat), landcover: lc });
const lcErrors = (lc: unknown[]) => validateSite(withLc(lc), 'v2').errors.filter((e) => e.path.startsWith('$.landcover'));

describe('landcover validation (spec.ts LandcoverArea, validate.ts)', () => {
  it('accepts the catalogue as built', () => {
    expect(cat.landcover?.length).toBeGreaterThan(10);
    const r = validateSite(cat, 'v2');
    expect(r.errors.filter((e) => e.path.startsWith('$.landcover'))).toEqual([]);
    for (const a of cat.landcover ?? []) expect(LANDCOVER_COVERS).toContain(a.cover);
  });

  it('accepts a valid area and a catalogue without the key', () => {
    expect(lcErrors([square])).toEqual([]);
    const { landcover: _drop, ...rest } = structuredClone(cat);
    expect(validateSite(rest, 'v2').errors.filter((e) => e.path.startsWith('$.landcover'))).toEqual([]);
  });

  it('rejects duplicate ids, unknown covers, missing evidence tags and bad ids', () => {
    expect(lcErrors([square, square]).map((e) => e.message)).toContain('duplicate id');
    expect(lcErrors([{ ...square, cover: 'orchard' }])[0].message).toMatch(/unknown cover/);
    expect(lcErrors([{ ...square, tag: 'from a map' }])[0].path).toMatch(/\.tag$/);
    expect(lcErrors([{ ...square, id: 'X1' }])[0].path).toMatch(/\.id$/);
    expect(lcErrors([{ ...square, confidence: 'certain' }])[0].path).toMatch(/\.confidence$/);
  });

  it('rejects open, clockwise and out-of-window rings', () => {
    const r = square.geometry.coordinates[0];
    const open = { ...square, geometry: { type: 'Polygon', coordinates: [r.slice(0, 4)] } };
    expect(lcErrors([open])[0].message).toBe('ring must be closed');
    const cw = { ...square, geometry: { type: 'Polygon', coordinates: [[...r].reverse()] } };
    expect(lcErrors([cw])[0].message).toBe('ring must be counter-clockwise');
    const far = { ...square, geometry: { type: 'Polygon', coordinates: [r.map(([e, n]) => [e - 100000, n])] } };
    expect(lcErrors([far])[0].message).toMatch(/window/);
    expect(lcErrors([{ ...square, geometry: { type: 'Point', coordinates: [382000, 5466000] } }])[0].path).toMatch(/geometry$/);
  });

  it('checks forest mixes, min_slope and epochs', () => {
    const forest = { ...square, cover: 'forest', mix: [{ species: 'fagus', share: 0.7 }, { species: 'quercus', share: 0.2 }] };
    expect(lcErrors([forest])[0].message).toBe('shares must sum to 1');
    expect(lcErrors([{ ...forest, mix: [{ species: 'fagus', share: 1 }] }])).toEqual([]);
    expect(lcErrors([{ ...square, min_slope: -0.2 }])[0].path).toMatch(/min_slope$/);
    expect(lcErrors([{ ...square, epoch: { from: 1790, to: 1780 } }])[0].path).toMatch(/epoch$/);
  });
});
