import { describe, expect, it } from 'vitest';
import { normaliseRoofTypeLoose } from '../src/validate.ts';
import { roofHeightAtInset, roofPlan, roofSection } from '../src/layout/roof.ts';
import { readCatalogueV1 } from './helpers.ts';

describe('roofSection', () => {
  it('reproduces every catalogue v1 ridge_h from the default rules (no fitting)', () => {
    let n = 0;
    for (const b of readCatalogueV1().buildings) {
      const r = b.roof;
      if (r.ridge_h === undefined || r.eaves_h === undefined || r.depth_m === undefined || !r.type) continue;
      const type = normaliseRoofTypeLoose(r.type)!;
      const s = roofSection({ type, depth: r.depth_m, eaves_h: r.eaves_h, pitch_lower: r.pitch_lower, pitch_upper: r.pitch_upper, matchRidge: false });
      expect(s.ridge_h, b.id).toBeCloseTo(r.ridge_h, 1);
      n++;
    }
    expect(n).toBe(21);
  });

  it('mansard: break at 0.4·depth/2 and slopes at the given pitches (CdL)', () => {
    const s = roofSection({ type: 'mansard', depth: 18, eaves_h: 356.4, pitch_lower: 70, pitch_upper: 30 });
    expect(s.break_h! - s.eaves_h).toBeCloseTo(3.6, 9);
    expect(s.break_inset!).toBeCloseTo(3.6 / Math.tan((70 * Math.PI) / 180), 9);
    expect(s.ridge_h).toBeCloseTo(364.44, 2);
    expect(s.profile).toHaveLength(5);
    expect(s.profile[2]).toEqual([0, s.ridge_h]);
    expect(s.adjusted).toBe(false);
  });

  it('mansard: solves the break height to match a given ridge', () => {
    const s = roofSection({ type: 'mansard', depth: 18, eaves_h: 356.4, pitch_lower: 70, pitch_upper: 30, ridge_h: 365.4 });
    expect(s.ridge_h).toBeCloseTo(365.4, 9);
    expect(s.adjusted).toBe(true);
    // the slopes still have their pitches
    const [, b, r] = s.profile;
    expect(Math.atan2(b[1] - s.eaves_h, b[0] + 9) * (180 / Math.PI)).toBeCloseTo(70, 6);
    expect(Math.atan2(r[1] - b[1], r[0] - b[0]) * (180 / Math.PI)).toBeCloseTo(30, 6);
  });

  it('mansard with a flat deck (HMS reading, pitch_upper = 0)', () => {
    const s = roofSection({ type: 'mansard', depth: 17, eaves_h: 355, pitch_lower: 70, pitch_upper: 0 });
    expect(s.ridge_h).toBeCloseTo(s.break_h!, 9);
    expect(s.deck_width).toBeCloseTo(17 - 2 * s.break_inset!, 9);
    expect(s.profile).toHaveLength(4);
  });

  it('hip: rise = depth/2 · tan(pitch); pitch solved to a given ridge', () => {
    const s = roofSection({ type: 'hip', depth: 10, eaves_h: 347.8, pitch_lower: 40 });
    expect(s.rise).toBeCloseTo(5 * Math.tan((40 * Math.PI) / 180), 9);
    const t = roofSection({ type: 'hip', depth: 10, eaves_h: 347.8, pitch_lower: 40, ridge_h: 352.8 });
    expect(t.ridge_h).toBeCloseTo(352.8, 9);
    expect(t.pitch_lower).toBeCloseTo(45, 6);
    expect(t.adjusted).toBe(true);
  });

  it('dome rise = 0.3 · diameter; none/flat/mound have no rise', () => {
    expect(roofSection({ type: 'dome', depth: 28, eaves_h: 350.3 }).ridge_h).toBeCloseTo(358.7, 9);
    for (const type of ['none', 'flat', 'mound'] as const) expect(roofSection({ type, depth: 10, eaves_h: 300 }).rise).toBe(0);
  });

  it('roofHeightAtInset follows the profile', () => {
    const s = roofSection({ type: 'gable', depth: 11, eaves_h: 263.5, pitch_lower: 48 });
    expect(roofHeightAtInset(s, 0)).toBeCloseTo(263.5, 9);
    expect(roofHeightAtInset(s, 5.5)).toBeCloseTo(s.ridge_h, 9);
    expect(roofHeightAtInset(s, 2.75)).toBeCloseTo(263.5 + s.rise / 2, 9);
  });
});

describe('roofPlan', () => {
  it('hipped roof ridge = length − depth; gable ridge = length', () => {
    const hip = roofSection({ type: 'hip', depth: 12, eaves_h: 0, pitch_lower: 45 });
    expect(roofPlan(hip, 40).ridgeLength).toBeCloseTo(28, 9);
    const gable = roofSection({ type: 'gable', depth: 12, eaves_h: 0, pitch_lower: 45 });
    expect(roofPlan(gable, 40)).toMatchObject({ ridgeLength: 40, hippedEnds: false });
    const pav = roofSection({ type: 'pavilion', depth: 8, eaves_h: 0, pitch_lower: 35 });
    expect(roofPlan(pav, 8).ridgeLength).toBe(0);
  });

  it('hipped mansard: break rectangle inset on all sides', () => {
    const m = roofSection({ type: 'mansard', depth: 18, eaves_h: 0, pitch_lower: 70, pitch_upper: 30 });
    const p = roofPlan(m, 78);
    expect(p.hippedEnds).toBe(true);
    expect(p.breakRect![0]).toBeCloseTo(78 - 2 * m.break_inset!, 9);
    expect(p.breakRect![1]).toBeCloseTo(18 - 2 * m.break_inset!, 9);
    expect(p.ridgeLength).toBeCloseTo(60, 9);
  });
});
