/**
 * KB-I68 fence layout (pure, no three): the post-and-rail fence in front of the court-mouth guard houses (Le Clerc 1790)
 * and the barrière (Schlagbaum) between the valley-entrance guard houses (PV 1791 l. 1). Positions are in the plan frame
 * of the site builders (x = E − E0, y = N − N0); heights are metres above the ground at each point, so the renderer
 * drapes the fence on the terrain. Norms and their evidence tags: layout/grammar.ts FENCE.
 */
import { FENCE } from '../layout/grammar.ts';
import { type P2, mulberry32, polylineLength, pointAlong } from '../layout/geom.ts';

export interface FencePost {
  p: P2;
  /** top above ground (m) */
  h: number;
  /** square section (m) */
  size: number;
  /** horizontal offset of the top against the foot (m): hand-set posts stand a little out of plumb [I] */
  lean: P2;
}

export interface FenceRail {
  a: P2;
  b: P2;
  /** height above ground at both ends (m) */
  z: number;
  /** sag at mid-span (m) */
  sag: number;
}

export interface BarrierBeam {
  /** foot of the pivot post (the beam's heel end with the counterweight lies behind it) */
  pivot: P2;
  /** foot of the forked rest post at the beam tip */
  rest: P2;
  /** unit plan direction pivot → rest */
  dir: P2;
  /** beam length from the pivot to the tip (m) */
  length: number;
  /** height of the beam axis at the pivot / at the rest (m above ground) */
  pivotH: number;
  restH: number;
  /** heel end behind the pivot (the counterweight box hangs there) */
  heel: P2;
}

export interface FenceLayout {
  posts: FencePost[];
  rails: FenceRail[];
  beam?: BarrierBeam;
}

export interface PostRailOptions {
  spacing?: number;
  rails?: number;
  seed?: number;
}

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2, s = 1): P2 => [a[0] + b[0] * s, a[1] + b[1] * s];

/**
 * Posts every ≤ `spacing` m along `line` (first and last at the ends, evenly divided per run so no short end bay), with
 * `rails` horizontal rails between neighbouring posts at evenly spaced heights up to just under the post top. Small
 * deterministic jitter in height and plumb (`seed`).
 */
export function postRailLayout(line: readonly P2[], height: number, opts: PostRailOptions = {}): FenceLayout {
  const C = FENCE.postRail;
  const spacing = opts.spacing ?? C.spacing;
  const nRails = Math.max(1, opts.rails ?? C.rails);
  const rnd = mulberry32((opts.seed ?? 1) >>> 0);
  const L = polylineLength(line);
  const posts: FencePost[] = [];
  const rails: FenceRail[] = [];
  if (line.length < 2 || !(L > 0.2)) return { posts, rails };
  const bays = Math.max(1, Math.ceil(L / spacing - 1e-6));
  for (let i = 0; i <= bays; i++) {
    const { p } = pointAlong(line, (L * i) / bays);
    const ang = rnd() * Math.PI * 2;
    const lean = C.lean * height * rnd();
    posts.push({ p: [p[0], p[1]], h: height * (0.97 + 0.06 * rnd()), size: C.post, lean: [Math.cos(ang) * lean, Math.sin(ang) * lean] });
  }
  for (let i = 0; i < bays; i++) {
    const a = posts[i].p;
    const b = posts[i + 1].p;
    for (let k = 0; k < nRails; k++) {
      const z = height * ((k + 1) / (nRails + 0.35)) + (rnd() - 0.5) * 0.04;
      rails.push({ a, b, z, sag: C.sag * (0.5 + rnd()) });
    }
  }
  return { posts, rails };
}

/**
 * A barrière across the gap `a` → `b` (e.g. from one guard house face to the other): a beam of FENCE.barriere.beam m
 * centred on the gap (shortened to the gap minus FENCE.clear at both ends when the gap is narrower), on a pivot post at
 * its `a` side, resting in a forked post at its `b` side; the rest of the gap on both sides is closed by post-and-rail
 * runs that stop `clear` short of the pivot and rest posts. With `beamOnly`, no side runs.
 */
export function barriereLayout(a: P2, b: P2, height: number, opts: PostRailOptions & { beamOnly?: boolean } = {}): FenceLayout {
  const B = FENCE.barriere;
  const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out: FenceLayout = { posts: [], rails: [] };
  if (!(gap > 2 * FENCE.clear + 1)) return out;
  const dir: P2 = [(b[0] - a[0]) / gap, (b[1] - a[1]) / gap];
  const length = Math.min(B.beam, gap - 2 * FENCE.clear - B.post);
  const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const pivot = add(mid, dir, -length / 2);
  const rest = add(mid, dir, length / 2);
  out.beam = { pivot, rest, dir, length, pivotH: B.pivotH, restH: B.restH, heel: add(pivot, dir, -B.counter) };
  if (opts.beamOnly) return out;
  // side runs: a → (pivot − heel room) and (rest + clear) → b; the heel swings over the a-side run, so that run
  // stops behind the counterweight
  const seed = opts.seed ?? 1;
  const runA: P2[] = [add(a, dir, FENCE.clear), add(pivot, dir, -(B.counter + FENCE.clear))];
  const runB: P2[] = [add(rest, dir, FENCE.clear + B.post), add(b, dir, -FENCE.clear)];
  for (const [i, run] of [runA, runB].entries()) {
    const d = sub(run[1], run[0]);
    if (d[0] * dir[0] + d[1] * dir[1] < 1) continue; // no room
    const r = postRailLayout(run, height, { ...opts, seed: (seed ^ (0x9e37 * (i + 1))) >>> 0 });
    out.posts.push(...r.posts);
    out.rails.push(...r.rails);
  }
  return out;
}
