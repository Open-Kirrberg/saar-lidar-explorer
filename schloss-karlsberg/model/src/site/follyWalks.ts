/**
 * KB-I71 (wave-7 review fix): gently winding garden walks that lead from an existing walk to a folly, in the manner of
 * the 1780s landscape garden ("serpentine walks", research/11 §4.4 [N]): the line swings to alternate sides of the
 * straight connection with one bend per ~`bendEvery` m, then a Chaikin smoothing rounds the bends. Bends that would
 * enter an obstacle (a building footprint, a pond) swing to the other side, or flatten when both sides are blocked.
 *
 * Pure (no three): used by the catalogue builder (scripts/catalogue-v2/terrain.ts) and tested in model/tests.
 */
import { chaikin } from '../layout/garden.ts';
import { pointInPolygon, type P2 } from '../layout/geom.ts';

export interface SerpentineOptions {
  /** metres per bend (default 35) */
  bendEvery?: number;
  /** lateral swing as a share of the length (default 0.1), capped at `maxAmp` m (default 7) */
  amp?: number;
  maxAmp?: number;
  /** side of the first bend: +1 left of a→b, −1 right (default +1) */
  side?: 1 | -1;
  /** rings (closed or open) the bends keep `clear` m away from */
  avoid?: readonly (readonly P2[])[];
  clear?: number;
}

function segDist(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}

/** True when `p` lies inside a ring or within `clear` m of its edge. */
export function blocked(p: P2, avoid: readonly (readonly P2[])[], clear: number): boolean {
  for (const r of avoid) {
    if (r.length < 3) continue;
    if (pointInPolygon(p, r as P2[])) return true;
    for (let i = 0; i < r.length; i++) if (segDist(p, r[i], r[(i + 1) % r.length]) < clear) return true;
  }
  return false;
}

/**
 * A winding walk from `a` to `b` (same frame as the inputs, metres). Deterministic; the end points are kept exactly.
 */
export function serpentineWalk(a: P2, b: P2, o: SerpentineOptions = {}): P2[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-6) return [a, b];
  const t: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: P2 = [-t[1], t[0]];
  const bends = Math.max(1, Math.round(L / (o.bendEvery ?? 35)));
  const amp = Math.min(o.maxAmp ?? 7, (o.amp ?? 0.1) * L);
  const avoid = o.avoid ?? [];
  const clear = o.clear ?? 2;
  let side: number = o.side ?? 1;
  const ctl: P2[] = [a];
  for (let k = 0; k < bends; k++) {
    const s = (L * (k + 0.5)) / bends;
    const base: P2 = [a[0] + t[0] * s, a[1] + t[1] * s];
    let p: P2 = [base[0] + n[0] * amp * side, base[1] + n[1] * amp * side];
    if (blocked(p, avoid, clear)) {
      const q: P2 = [base[0] - n[0] * amp * side, base[1] - n[1] * amp * side];
      p = blocked(q, avoid, clear) ? base : q;
      if (p === q) side = -side;
    }
    ctl.push(p);
    side = -side;
  }
  ctl.push(b);
  return chaikin(ctl, 3);
}

/** Length of a polyline (m). */
export function walkLength(line: readonly P2[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return s;
}
