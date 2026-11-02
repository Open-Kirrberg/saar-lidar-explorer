/** KB-I45 (wave 7): the battered, bevelled hedge / box-edging cross-section (site/hedgeProfile.ts). */
import { describe, expect, it } from 'vitest';
import { HEDGE_PROFILE_FACES, hedgeProfile } from '../src/site/hedgeProfile.ts';

describe('hedgeProfile', () => {
  const box = hedgeProfile(-0.085, 0.085, 10, 10.35, 0.04);

  it('spans the given width and height, symmetric about the centre', () => {
    expect(box).toHaveLength(HEDGE_PROFILE_FACES + 1);
    expect(box[0].d).toBeCloseTo(-0.085);
    expect(box[5].d).toBeCloseTo(0.085);
    expect(box[0].h).toBe(10);
    expect(Math.max(...box.map((p) => p.h))).toBeCloseTo(10.35);
    for (let i = 0; i < 3; i++) {
      expect(box[i].d).toBeCloseTo(-box[5 - i].d);
      expect(box[i].h).toBeCloseTo(box[5 - i].h);
      expect(box[i].nd).toBeCloseTo(-box[5 - i].nd);
    }
  });

  it('is convex and narrows upward (batter, shoulder, flat crown)', () => {
    expect(box[1].d).toBeGreaterThan(box[0].d);
    expect(box[2].d).toBeGreaterThan(box[1].d);
    expect(box[1].h).toBeCloseTo(10.35 - 0.04);
    expect(box[2].h).toBeCloseTo(box[3].h);
    // convex: every turn along the outline is to the same side
    for (let i = 1; i + 1 < box.length; i++) {
      const a = box[i - 1];
      const b = box[i];
      const c = box[i + 1];
      expect((b.d - a.d) * (c.h - b.h) - (b.h - a.h) * (c.d - b.d)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('has unit normals pointing out and turning up toward the crown', () => {
    for (const p of box) expect(Math.hypot(p.nd, p.nh)).toBeCloseTo(1);
    expect(box[0].nd).toBeLessThan(0);
    expect(box[0].nh).toBeGreaterThan(0); // battered side faces a little up
    expect(box[1].nh).toBeGreaterThan(box[0].nh);
    expect(box[2].nh).toBeGreaterThan(box[1].nh);
  });

  it('clamps the bevel on a low hedge and keeps a crown', () => {
    const low = hedgeProfile(0, 0.4, 0, 0.05, 0.2);
    expect(low[1].h).toBeGreaterThanOrEqual(0.05 * 0.55 - 1e-9);
    expect(low[3].d - low[2].d).toBeGreaterThan(0);
  });
});
