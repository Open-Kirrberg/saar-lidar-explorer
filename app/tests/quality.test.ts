import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, applyQuality, buildingRadii, pixelRatioFor, qualityKnobs } from '../src/ui/quality';
import { QUALITY_LEVELS } from '../src/ui/settings';
import { DEFAULT_BUDGET, MiB } from '../src/terrain/budget';
import { DEFAULT_BUILDING_OPTIONS } from '../src/buildings/BuildingLayer';
import { DEFAULT_LOD } from '../src/pointcloud/lod';

describe('quality presets', () => {
  it('"Hoch" equals the engine defaults (choosing nothing changes nothing)', () => {
    const h = QUALITY_PRESETS.hoch;
    expect(h.budgetMiB * MiB).toBe(DEFAULT_BUDGET);
    expect(h.pixelError).toBe(1);
    expect(h.canopyDistance).toBe(2000);
    expect(h.lodScale).toBe(1);
    expect(h.labelScale).toBe(1);
    expect(h.pointBudget).toBe(DEFAULT_LOD.budget);
    const b = buildingRadii(h.buildingRadius);
    expect(b.loadRadius).toBe(DEFAULT_BUILDING_OPTIONS.loadRadius);
    expect(b.dropRadius).toBe(DEFAULT_BUILDING_OPTIONS.dropRadius);
    expect(b.fade).toEqual(DEFAULT_BUILDING_OPTIONS.fade);
  });

  it('every knob gets cheaper (or equal) from Hoch → Mittel → Niedrig', () => {
    const [h, m, n] = QUALITY_LEVELS.map(qualityKnobs);
    for (const k of ['pixelRatioCap', 'budgetMiB', 'canopyDistance', 'lodScale', 'labelScale', 'buildingRadius', 'pointBudget'] as const) {
      expect(m[k]).toBeLessThanOrEqual(h[k]);
      expect(n[k]).toBeLessThanOrEqual(m[k]);
    }
    expect(m.pixelError).toBeGreaterThan(h.pixelError);
    expect(n.pixelError).toBeGreaterThan(m.pixelError);
  });

  it('building fade ends inside the load radius and the drop radius is beyond it', () => {
    for (const q of QUALITY_LEVELS) {
      const b = buildingRadii(qualityKnobs(q).buildingRadius);
      expect(b.fade[0]).toBeLessThan(b.fade[1]);
      expect(b.fade[1]).toBeLessThan(b.loadRadius);
      expect(b.dropRadius).toBeGreaterThan(b.loadRadius);
    }
  });

  it('pixel ratio is min(DPR, cap) and tolerates bad DPR values', () => {
    expect(pixelRatioFor('hoch', 3)).toBe(2);
    expect(pixelRatioFor('hoch', 1)).toBe(1);
    expect(pixelRatioFor('mittel', 2)).toBe(1.5);
    expect(pixelRatioFor('niedrig', 2)).toBe(1);
    expect(pixelRatioFor('hoch', NaN)).toBe(1);
    expect(pixelRatioFor('hoch', 0)).toBe(1);
  });

  it('applyQuality writes every target; point budget only when asked', () => {
    let pr = 0;
    let budget = -1;
    const fade: number[] = [];
    const t = {
      setPixelRatio: (r: number) => (pr = r),
      devicePixelRatio: 2,
      streaming: { pixelError: 1, budget: 0, canopyDistance: 0 },
      lodDistances: [180, 600, 1400, 4000],
      baseDistances: [180, 600, 1400, 4000],
      labels: { distanceScale: 1 },
      buildings: { opts: { loadRadius: 0, dropRadius: 0 }, fade: { set: (a: number, b: number) => fade.splice(0, 2, a, b) } },
      pointClouds: { setBudget: (n: number) => (budget = n) },
    };
    applyQuality('niedrig', t);
    expect(pr).toBe(1);
    expect(t.streaming).toEqual({ pixelError: 2.5, budget: 300 * MiB, canopyDistance: 1000 });
    expect(t.lodDistances).toEqual([90, 300, 700, 2000]);
    expect(t.labels.distanceScale).toBe(0.5);
    expect(t.buildings.opts).toEqual({ loadRadius: 1000, dropRadius: 1300 });
    expect(fade).toEqual([750, 975]);
    expect(budget).toBe(-1);
    applyQuality('hoch', t, true);
    expect(t.lodDistances).toEqual([180, 600, 1400, 4000]); // scaled from the base, not compounded
    expect(budget).toBe(3_000_000);
    expect(pr).toBe(2);
  });

  it('a point budget set by the user survives preset picks (v1.0.1)', () => {
    const calls: Array<[number, boolean | undefined]> = [];
    const prefs = { budgetUser: false };
    const t = {
      setPixelRatio: () => {},
      devicePixelRatio: 1,
      streaming: { pixelError: 1, budget: 0, canopyDistance: 0 },
      lodDistances: [1],
      baseDistances: [1],
      pointClouds: { prefs, setBudget: (n: number, fromPreset?: boolean) => calls.push([n, fromPreset]) },
    };
    applyQuality('mittel', t, true);
    expect(calls).toEqual([[2_000_000, true]]); // marked as coming from the preset
    prefs.budgetUser = true;
    applyQuality('niedrig', t, true);
    expect(calls).toHaveLength(1);
  });
});
