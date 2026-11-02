/**
 * KB-I29 menagerie layout (research/10 §b.4): where the animal houses, their runs, the grilles between them, the net
 * posts and the watercourse stand, in EN, from `facade.menagerie` and grammar MENAGERIE. Pure (no three); the
 * exterior builder (exterior/menagerie.ts) only extrudes what this returns.
 *
 * 'ring' (KL-B40 "Bärenzwinger"): `houses` square houses plus an optional loge share `houses (+1)` equal slots on the
 * circle of house centres, each facing the centre (the moat and the island pavilion); radial grilles on the slot
 * boundaries run from the back line of the houses in to the moat edge [D T20 houses; I yards and grilles].
 * 'rows' (KL-B43 "Herzogsterrassen"): each row p0 -> p1 is the back line of a straight row of single-storey houses
 * [D T1 p. 383]; the row is cut into `houses` equal slots, every slot gets a house fronting towards `front_azimuth`
 * and a run of `run_depth` in front of it, slots crossed by the watercourse stay open [I].
 *
 * Wave-6 review fix: ring yards are closed behind the houses (a grille from each house's back corner to the outer end
 * of the radial grille beside it), so every yard is house + two radial grilles + the moat; radial grilles are flagged
 * so the builder can run them in to the water edge. Row houses get a seeded irregularity (MENAGERIE.rowJitter), and each
 * row's back line carries a terrace wall (the ≈ 1 m LiDAR step, `terraces`). 'island' and 'open_pavilion' have no plan
 * here: the builder draws them on the building footprint.
 */
import type { EN, MenagerieSpec } from '../spec.ts';
import { MENAGERIE } from './grammar.ts';
import { mulberry32 } from './geom.ts';

export interface MenagerieHouse {
  kind: 'house' | 'loge';
  /** Centre of the house plan. */
  centre: EN;
  /** Unit vector (E, N) out of the front (grille) face. */
  front: EN;
  width: number;
  depth: number;
  eaves: number;
  pitch: number;
  roof: 'pyramid' | 'gable';
}

/** A grille (fence of iron bars) from a to b. */
export interface MenagerieGrille {
  a: EN;
  b: EN;
  /** Ring: a radial yard partition whose inner end `b` lies on the moat side (the builder runs it in to the water). */
  radial?: boolean;
}

/** Terrace retaining wall along a row's back line, `back` = unit vector (E, N) towards the upper terrace. */
export interface MenagerieTerrace {
  a: EN;
  b: EN;
  back: EN;
}

export interface MenagerieRun {
  /** Corner ring of the run (4 points, CCW not guaranteed). */
  ring: EN[];
}

export interface MenagerieLayout {
  houses: MenagerieHouse[];
  grilles: MenagerieGrille[];
  runs: MenagerieRun[];
  /** Net posts (≈ 3.6 m) around the runs. */
  posts: EN[];
  channel: EN[] | null;
  /** 'rows': one terrace wall per row back line. */
  terraces: MenagerieTerrace[];
}

const add = (p: EN, v: EN, k: number): EN => [p[0] + v[0] * k, p[1] + v[1] * k];
const az = (deg: number): EN => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];

/** Distance from p to the polyline. */
export function distToPolyline(p: EN, line: EN[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t));
  }
  return best;
}

/** `seed` drives the row irregularity only (callers pass hashString(building id) ^ options.seed). */
export function menagerieLayout(m: MenagerieSpec, seed = 0): MenagerieLayout {
  if (m.kind === 'ring') return ringLayout(m);
  if (m.kind === 'rows') return rowsLayout(m, seed);
  return { houses: [], grilles: [], runs: [], posts: [], channel: null, terraces: [] };
}

function ringLayout(m: MenagerieSpec): MenagerieLayout {
  const r = m.ring!;
  const H = MENAGERIE.ringHouse;
  const Lg = MENAGERIE.loge;
  const loge = r.loge_azimuth !== undefined;
  const slots = r.houses + (loge ? 1 : 0);
  const a0 = r.loge_azimuth ?? 0;
  const houses: MenagerieHouse[] = [];
  const grilles: MenagerieGrille[] = [];
  for (let i = 0; i < slots; i++) {
    const dir = az(a0 + (i * 360) / slots);
    const isLoge = loge && i === 0;
    const S = isLoge ? Lg : H;
    houses.push({ kind: isLoge ? 'loge' : 'house', centre: add(r.centre, dir, r.radius), front: [-dir[0], -dir[1]], width: S.width, depth: S.depth, eaves: S.eaves, pitch: S.pitch, roof: 'pyramid' });
  }
  // the moat edge: the catalogue moat radius, else the yard depth in front of the houses
  const inner = r.moat_radius ?? r.radius - H.depth / 2 - MENAGERIE.ringYard;
  for (let i = 0; i < slots; i++) {
    // radial grille on the boundary to the next slot: from the back line of the houses in to the moat edge
    const g = az(a0 + ((i + 0.5) * 360) / slots);
    const out = add(r.centre, g, r.radius + H.depth / 2);
    grilles.push({ a: out, b: add(r.centre, g, Math.min(inner, r.radius - H.depth / 2 - 0.3)), radial: true });
    // close the yard behind: back corner of this house -> outer end of the radial grille -> back corner of the next
    const h0 = houses[i];
    const h1 = houses[(i + 1) % slots];
    grilles.push({ a: backCorner(h0, 1), b: out }, { a: out, b: backCorner(h1, -1) });
  }
  return { houses, grilles, runs: [], posts: [], channel: null, terraces: [] };
}

/** Back corner of a ring house on the side of increasing (`s` = 1) or decreasing (-1) azimuth. */
function backCorner(h: MenagerieHouse, s: 1 | -1): EN {
  // front points at the centre; the azimuth tangent (cw seen from above) is the front turned left
  const tan: EN = [-h.front[1], h.front[0]];
  return [h.centre[0] - h.front[0] * (h.depth / 2) + tan[0] * s * (h.width / 2), h.centre[1] - h.front[1] * (h.depth / 2) + tan[1] * s * (h.width / 2)];
}

function rowsLayout(m: MenagerieSpec, seed: number): MenagerieLayout {
  const H = MENAGERIE.rowHouse;
  const J = MENAGERIE.rowJitter;
  const rnd = mulberry32(seed >>> 0);
  const terraces: MenagerieTerrace[] = [];
  const runDepth = m.run_depth ?? MENAGERIE.run.depth;
  const houses: MenagerieHouse[] = [];
  const grilles: MenagerieGrille[] = [];
  const runs: MenagerieRun[] = [];
  const posts: EN[] = [];
  const channel = m.channel && m.channel.length >= 2 ? m.channel : null;
  const clear = MENAGERIE.channel.width / 2 + MENAGERIE.channel.kerb + 0.4;
  for (const row of m.rows ?? []) {
    const len = Math.hypot(row.p1[0] - row.p0[0], row.p1[1] - row.p0[1]);
    if (len < 1e-6 || row.houses < 1) continue;
    const tan: EN = [(row.p1[0] - row.p0[0]) / len, (row.p1[1] - row.p0[1]) / len];
    // front: towards front_azimuth (sign of the row normal closest to it), else the left normal of p0 -> p1
    let front: EN = [-tan[1], tan[0]];
    if (m.front_azimuth !== undefined) {
      const f = az(m.front_azimuth);
      if (front[0] * f[0] + front[1] * f[1] < 0) front = [-front[0], -front[1]];
    }
    const slot = len / row.houses;
    const w0 = Math.min(H.width, slot - H.gap);
    terraces.push({ a: row.p0, b: row.p1, back: [-front[0], -front[1]] });
    for (let i = 0; i < row.houses; i++) {
      const s0 = i * slot;
      const s1 = s0 + slot;
      // seeded irregularity (drawn for every slot so open slots do not shift the sequence)
      const w = w0 - J.narrow * rnd();
      // the house stays inside its slot with >= 0.15 m to the slot boundary (neighbours never touch)
      const shift = (rnd() * 2 - 1) * Math.max(0, Math.min(J.shift, (slot - w) / 2 - 0.15));
      const dEaves = (rnd() * 2 - 1) * J.eaves;
      const mid = add(row.p0, tan, (s0 + s1) / 2 + shift);
      // a slot the watercourse crosses stays open (no house, no run)
      if (channel) {
        const back0 = add(row.p0, tan, s0 - clear);
        const back1 = add(row.p0, tan, s1 + clear);
        const crosses =
          segmentCrosses(back0, back1, channel) ||
          segmentCrosses(add(back0, front, H.depth + runDepth), add(back1, front, H.depth + runDepth), channel) ||
          [0, 0.5, 1].some((k) => distToPolyline(add(add(row.p0, tan, s0 + slot * k), front, H.depth / 2), channel) < clear);
        if (crosses) continue;
      }
      houses.push({ kind: 'house', centre: add(mid, front, H.depth / 2), front, width: w, depth: H.depth, eaves: H.eaves + dEaves, pitch: H.pitch, roof: 'gable' });
      const c0 = add(add(row.p0, tan, s0), front, H.depth);
      const c1 = add(add(row.p0, tan, s1), front, H.depth);
      const c2 = add(c1, front, runDepth);
      const c3 = add(c0, front, runDepth);
      runs.push({ ring: [c0, c1, c2, c3] });
      // grilles: the slot boundaries through the run, and the run front
      grilles.push({ a: c0, b: c3 }, { a: c1, b: c2 }, { a: c3, b: c2 });
      // net posts at the run corners and along its sides
      const n = Math.max(1, Math.round(runDepth / MENAGERIE.run.postSpacing));
      for (let k = 1; k <= n; k++) posts.push(add(c0, front, (runDepth * k) / n), add(c1, front, (runDepth * k) / n));
    }
  }
  return { houses, grilles: dedupeGrilles(grilles), runs, posts: dedupePoints(posts), channel, terraces };
}

function segmentCrosses(a: EN, b: EN, line: EN[]): boolean {
  for (let i = 1; i < line.length; i++) {
    const c = line[i - 1];
    const d = line[i];
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
    if (Math.abs(den) < 1e-12) continue;
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
    const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}

const key = (p: EN) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

function dedupePoints(ps: EN[]): EN[] {
  const seen = new Set<string>();
  return ps.filter((p) => (seen.has(key(p)) ? false : (seen.add(key(p)), true)));
}

/** Neighbouring slots share their boundary grille: keep one. */
function dedupeGrilles(gs: MenagerieGrille[]): MenagerieGrille[] {
  const seen = new Set<string>();
  return gs.filter((g) => {
    const k = [key(g.a), key(g.b)].sort().join('|');
    return seen.has(k) ? false : (seen.add(k), true);
  });
}
