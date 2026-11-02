/**
 * KB-I03 time slice: `epoch {from, to}` on buildings and terrain features, one pure filter `inEpoch`, scene year 1789.
 * The scenario tests follow research/11 §6.5 and are written against inEpoch before the basin / Rundpavillon exist.
 */
import { describe, expect, it } from 'vitest';
import { loadSite } from '../src/catalogue.ts';
import { DEFAULT_BUILD_OPTIONS, type BuildContext, makeLayoutFn } from '../src/context.ts';
import { SCENE_YEAR, epochIssues, inEpoch, inScene } from '../src/layout/epoch.ts';
import { createMaterials } from '../src/materials/index.ts';
import { buildExterior } from '../src/exterior/index.ts';
import { buildInterior } from '../src/interior/index.ts';
import { siteBuildings, siteFeatures } from '../src/site/access.ts';
import type { Epoch, TerrainFeature } from '../src/spec.ts';
import { validateSite } from '../src/validate.ts';
import { placedBuildings } from '../../plans/src/sheets/common.ts';
import { readCatalogue } from './helpers.ts';

const { spec } = loadSite(readCatalogue());
const base = { spec, materials: createMaterials(), terrain: () => NaN, options: { ...DEFAULT_BUILD_OPTIONS }, layout: makeLayoutFn(spec) };
const ctx = (lod: 0 | 1 | 2, year = SCENE_YEAR): BuildContext => ({ ...base, lod, options: { ...DEFAULT_BUILD_OPTIONS, year } });

describe('inEpoch', () => {
  it('no epoch = always standing; the scene year defaults to 1789', () => {
    expect(SCENE_YEAR).toBe(1789);
    expect(DEFAULT_BUILD_OPTIONS.year).toBe(1789);
    expect(inEpoch(undefined)).toBe(true);
    expect(inEpoch(null, 1700)).toBe(true);
    expect(inEpoch({})).toBe(true);
  });

  it('from and to are inclusive years with open ends', () => {
    const e: Epoch = { from: 1785, to: 1785 };
    expect(inEpoch(e, 1784)).toBe(false);
    expect(inEpoch(e, 1785)).toBe(true);
    expect(inEpoch(e, 1786)).toBe(false);
    expect(inEpoch(e)).toBe(false); // default 1789
    expect(inEpoch({ from: 1792 }, 1791)).toBe(false);
    expect(inEpoch({ from: 1792 }, 2025)).toBe(true);
    expect(inEpoch({ to: 1790 }, 1700)).toBe(true);
    expect(inEpoch({ to: 1790 }, 1791)).toBe(false);
  });

  // research/11 §6.5: "the basin is shown for 1789 and hidden for 1791"
  it('axial basin 1783-1790: shown in 1789, hidden in 1791', () => {
    const basin: Epoch = { from: 1783, to: 1790 }; // [D Schneider via LA Speyer; research/11 §1.3, S3]
    expect(inEpoch(basin, 1789)).toBe(true);
    expect(inEpoch(basin, 1791)).toBe(false);
  });

  // research/11 §6.5: "the Rundpavillon is at the CdL in 1789 and in the Karlslust in 1792"
  it('Rundpavillon: at the CdL in 1789, as the Karlslust "Eremitage" in 1792', () => {
    // two catalogue entries for one moved building; the move year 1792 belongs to the Karlslust state [D Schneider; I]
    const atCdl: Epoch = { from: 1785, to: 1791 };
    const eremitage: Epoch = { from: 1792 };
    expect([inEpoch(atCdl, 1789), inEpoch(eremitage, 1789)]).toEqual([true, false]);
    expect([inEpoch(atCdl, 1792), inEpoch(eremitage, 1792)]).toEqual([false, true]);
  });

  it('inScene filters a list by year', () => {
    const fs = [{ id: 'a' }, { id: 'b', epoch: { from: 1783, to: 1790 } }, { id: 'c', epoch: { from: 1792 } }];
    expect(inScene(fs).map((f) => f.id)).toEqual(['a', 'b']);
    expect(inScene(fs, 1791).map((f) => f.id)).toEqual(['a']);
    expect(inScene(fs, 1792).map((f) => f.id)).toEqual(['a', 'c']);
  });
});

describe('epoch validation', () => {
  it('epochIssues accepts integer years and rejects from > to, fractions and unknown keys', () => {
    expect(epochIssues(undefined)).toEqual([]);
    expect(epochIssues({ from: 1785, to: 1785 })).toEqual([]);
    expect(epochIssues({ from: 1790, to: 1785 })).toContain('from > to');
    expect(epochIssues({ from: 1785.5 }).length).toBe(1);
    expect(epochIssues({ year: 1785 }).length).toBe(1);
    expect(epochIssues('1785').length).toBe(1);
  });

  it('validateSite reports a bad epoch on a building and on a terrain feature', () => {
    const raw = readCatalogue();
    raw.buildings[0].epoch = { from: 1790, to: 1780 };
    (raw.terrain_features[0] as TerrainFeature).epoch = { to: 1789.2 };
    const r = validateSite(raw, 'v2');
    expect(r.errors.some((e) => e.path.endsWith('.epoch') && e.path.includes('buildings'))).toBe(true);
    expect(r.errors.some((e) => e.path.endsWith('.epoch') && e.path.includes('terrain_features'))).toBe(true);
  });
});

describe('summer-1789 state of the catalogue', () => {
  it('KB-B13 (1785 fair rotunda) and KL-B49 (1785 Hymen temple) stay in the spec with epoch 1785', () => {
    for (const id of ['KB-B13', 'KL-B49']) {
      const b = spec.buildings.find((x) => x.id === id)!;
      expect(b, id).toBeDefined();
      expect(b.epoch).toEqual({ from: 1785, to: 1785 });
      expect(b.epoch_tag).toMatch(/^D/);
      expect(b.placement).not.toBe('hypothetical'); // "another date" is an epoch, never 'hypothetical'
    }
  });

  it('siteBuildings drops them by default and shows them for 1785', () => {
    const ids1789 = siteBuildings(spec, ctx(1)).map((b) => b.id);
    expect(ids1789).not.toContain('KB-B13');
    expect(ids1789).not.toContain('KL-B49');
    expect(ids1789).toContain('KB-B10');
    const ids1785 = siteBuildings(spec, ctx(1, 1785)).map((b) => b.id);
    expect(ids1785).toContain('KB-B13');
    expect(ids1785).toContain('KL-B49');
  });

  it('builders return empty groups outside the epoch', () => {
    const b13 = spec.buildings.find((x) => x.id === 'KB-B13')!;
    expect(buildExterior(b13, ctx(1)).children.length).toBe(0);
    expect(buildExterior(b13, ctx(1, 1785)).children.length).toBeGreaterThan(0);
    expect(buildInterior(b13, ctx(2)).children.length).toBe(0);
  });

  it('plan sheets list only buildings of the scene year', () => {
    const ids = placedBuildings(spec).map((b) => b.id);
    expect(ids).not.toContain('KB-B13');
    expect(ids).not.toContain('KL-B49');
    expect(placedBuildings(spec, 1785).map((b) => b.id)).toContain('KB-B13');
  });

  it('terrain features without an epoch are all in the 1789 scene', () => {
    expect(siteFeatures(spec).length).toBe(spec.terrain_features.filter((f) => inEpoch(f.epoch)).length);
  });
});
