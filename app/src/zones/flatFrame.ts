/**
 * Built twins: the highlight of flat, wall-mounted targets (the gable mural, the picture frames, the hanging sign).
 * Their meshes are single-sided decals on a wall, so the inverted-hull outline (`runtime/twinPick.ts`) has no back
 * faces to draw and the visitor saw almost nothing. Instead they get a warm picture frame just in front of them.
 * Pure parts, no three.js: plain numbers in the zone frame.
 *
 * `flatPanel` decides whether a target is flat (≥ `FLAT_AREA_SHARE` of its area faces one axis, ≤ `FLAT_THICK_M`
 * thick along it) and returns its rectangle in that plane; `frameRing` turns a rectangle into a ring of quads.
 */

export type P3 = readonly [number, number, number];

/** Share of the triangle area that must face one axis (either way). */
export const FLAT_AREA_SHARE = 0.8;
/** Thickest a flat target may be along its axis (m): the mural panel is 2.5 cm plus its decals. */
export const FLAT_THICK_M = 0.08;
/** The frame floats this far in front of the target's front (m), the gap to its edge, and its width. */
export const FRAME_LIFT_M = 0.012;
export const FRAME_GAP_M = 0.012;
export const frameWidth = (w: number, h: number): number => Math.min(0.1, Math.max(0.02, 0.05 * Math.min(w, h)));

export interface FlatPanel {
  /** Unit axis the target faces (its front side when one-sided). */
  n: [number, number, number];
  /** In-plane unit axes: `u` horizontal (or x when the panel lies flat), `v = n × u`. */
  u: [number, number, number];
  v: [number, number, number];
  /** Rectangle in (u, v) and the extent along n. */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  d0: number;
  d1: number;
  /** Area faces both ways (a hanging sign): frame it on both sides. */
  twoSided: boolean;
}

const sub = (a: P3, b: P3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: P3): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Is the target made of these triangles (world positions, three per triangle) flat? Returns its panel, or null
 * (a box, a shelf, a loaf: these keep the outline).
 */
export function flatPanel(tris: readonly (readonly [P3, P3, P3])[]): FlatPanel | null {
  let total = 0;
  let best: { n: [number, number, number]; a: number } | null = null;
  const normals: { n: [number, number, number]; a: number }[] = [];
  for (const [a, b, c] of tris) {
    const cr = cross(sub(b, a), sub(c, a));
    const a2 = Math.hypot(cr[0], cr[1], cr[2]);
    if (a2 < 1e-12) continue;
    total += a2;
    const n = norm(cr);
    normals.push({ n, a: a2 });
    if (!best || a2 > best.a) best = { n, a: a2 };
  }
  if (!best || total <= 0) return null;
  let along = 0;
  let front = 0;
  let back = 0;
  // the axis: area-weighted mean of the normals parallel to the largest triangle's (either way)
  const acc: [number, number, number] = [0, 0, 0];
  for (const { n, a } of normals) {
    const c = dot(n, best.n);
    if (Math.abs(c) < 0.98) continue;
    along += a;
    const s = c > 0 ? 1 : -1;
    if (s > 0) front += a;
    else back += a;
    acc[0] += s * n[0] * a;
    acc[1] += s * n[1] * a;
    acc[2] += s * n[2] * a;
  }
  if (along / total < FLAT_AREA_SHARE) return null;
  let n = norm(acc);
  // the front is the side most of the area faces
  if (back > front) n = [-n[0], -n[1], -n[2]];
  const up: P3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(up, n));
  const v = norm(cross(n, u));
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  let d0 = Infinity;
  let d1 = -Infinity;
  for (const t of tris) {
    for (const p of t) {
      const pu = dot(p, u);
      const pv = dot(p, v);
      const pd = dot(p, n);
      u0 = Math.min(u0, pu);
      u1 = Math.max(u1, pu);
      v0 = Math.min(v0, pv);
      v1 = Math.max(v1, pv);
      d0 = Math.min(d0, pd);
      d1 = Math.max(d1, pd);
    }
  }
  if (d1 - d0 > FLAT_THICK_M) return null;
  return { n, u, v, u0, u1, v0, v1, d0, d1, twoSided: Math.min(front, back) > 0.25 * Math.max(front, back) };
}

/**
 * A rectangular ring (4 quads = 8 triangles, world positions, flat array) around the panel's rectangle grown by
 * `inset`, `width` wide, at depth `d` along the panel axis `n` (the panel's front + `FRAME_LIFT_M`, or its back −
 * `FRAME_LIFT_M` facing the other way).
 */
export function frameRing(p: FlatPanel, d: number, inset: number, width: number): number[] {
  const at = (cu: number, cv: number): P3 => [
    p.u[0] * cu + p.v[0] * cv + p.n[0] * d,
    p.u[1] * cu + p.v[1] * cv + p.n[1] * d,
    p.u[2] * cu + p.v[2] * cv + p.n[2] * d,
  ];
  const a = [p.u0 - inset, p.v0 - inset, p.u1 + inset, p.v1 + inset] as const;
  const b = [a[0] - width, a[1] - width, a[2] + width, a[3] + width] as const;
  const out: number[] = [];
  const quad = (q0: P3, q1: P3, q2: P3, q3: P3) => out.push(...q0, ...q1, ...q2, ...q0, ...q2, ...q3);
  // bottom, right, top, left: outer → inner, counter-clockwise seen from the front (+n)
  quad(at(b[0], b[1]), at(b[2], b[1]), at(a[2], a[1]), at(a[0], a[1]));
  quad(at(b[2], b[1]), at(b[2], b[3]), at(a[2], a[3]), at(a[2], a[1]));
  quad(at(b[2], b[3]), at(b[0], b[3]), at(a[0], a[3]), at(a[2], a[3]));
  quad(at(b[0], b[3]), at(b[0], b[1]), at(a[0], a[1]), at(a[0], a[3]));
  return out;
}
