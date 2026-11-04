/**
 * Wave 10 (garden, audit #11): July states and section of the Mistbeet lights (model/src/site/hotbed.ts).
 */
import { describe, expect, it } from 'vitest';
import { HOTBED_LIGHT } from '../src/layout/grammar.ts';
import { hotbedLightStates, lightSection } from '../src/site/hotbed.ts';

describe('hotbed lights', () => {
  it('are deterministic and split into the grammar shares', () => {
    const a = hotbedLightStates(4000, 7);
    expect(hotbedLightStates(4000, 7)).toEqual(a);
    const share = (k: string) => a.filter((s) => s.kind === k).length / a.length;
    expect(share('propped')).toBeCloseTo(HOTBED_LIGHT.propped, 1);
    expect(share('removed')).toBeCloseTo(HOTBED_LIGHT.removed, 1);
    expect(share('whitewashed')).toBeCloseTo(HOTBED_LIGHT.whitewashed, 1);
    for (const s of a) if (s.kind === 'propped') expect(s.deg).toBeGreaterThanOrEqual(HOTBED_LIGHT.prop[0]), expect(s.deg).toBeLessThanOrEqual(HOTBED_LIGHT.prop[1]);
  });

  it('lies on the box when closed and pivots about its low front edge when propped', () => {
    const [fd, fh, bd, bh] = lightSection(0.65, 0.27, 0.47, 0);
    expect([fd, fh]).toEqual([0.65, 0.27]);
    expect(bd).toBeCloseTo(-0.65, 9);
    expect(bh).toBeCloseTo(0.47, 9);
    const p = lightSection(0.65, 0.27, 0.47, 15);
    expect(p[0]).toBe(0.65);
    expect(p[3]).toBeGreaterThan(0.47 + 0.25);
    // same length
    expect(Math.hypot(p[0] - p[2], p[3] - p[1])).toBeCloseTo(Math.hypot(1.3, 0.2), 9);
  });
});
