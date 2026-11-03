/**
 * Wave 10 (garden, audit #11): the July state of each Mistbeet light (grammar HOTBED_LIGHT): closed, propped up at its
 * high (N) edge, taken off, or limewashed against the sun. Pure and deterministic (its own seeded stream, so the bed
 * stream of gardenDetail.ts is untouched).
 */
import { mulberry32 } from '../layout/geom.ts';
import { HOTBED_LIGHT } from '../layout/grammar.ts';

export type LightState = { kind: 'closed' | 'whitewashed' | 'removed' } | { kind: 'propped'; deg: number };

/** States of `n` lights of one frame row. */
export function hotbedLightStates(n: number, seed: number): LightState[] {
  const rnd = mulberry32(seed ^ 0x40b3ed);
  const H = HOTBED_LIGHT;
  const out: LightState[] = [];
  for (let i = 0; i < n; i++) {
    const u = rnd();
    const v = rnd();
    if (u < H.propped) out.push({ kind: 'propped', deg: H.prop[0] + (H.prop[1] - H.prop[0]) * v });
    else if (u < H.propped + H.removed) out.push({ kind: 'removed' });
    else if (u < H.propped + H.removed + H.whitewashed) out.push({ kind: 'whitewashed' });
    else out.push({ kind: 'closed' });
  }
  return out;
}

/**
 * The glass light of a frame box as a quad in the box's cross-section (d across the box, from the low front edge at
 * +D to the high back edge at −D; h heights): rotated about its low edge by `propDeg` (0 = lying on the box).
 * Returns [front d, front h, back d, back h].
 */
export function lightSection(D: number, loY: number, hiY: number, propDeg = 0): [number, number, number, number] {
  const run = 2 * D;
  const rise = hiY - loY;
  const len = Math.hypot(run, rise);
  const a = Math.atan2(rise, run) + (propDeg * Math.PI) / 180;
  return [D, loY, D - len * Math.cos(a), loY + len * Math.sin(a)];
}
