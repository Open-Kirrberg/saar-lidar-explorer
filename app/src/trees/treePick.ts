/**
 * 🌳 Tree picking — pure CPU ray test against the instance rows (no three / DOM).
 *
 * The trees are drawn as instanced lathe shapes whose geometry exists only in the vertex shader
 * (TreeMaterial.ts), so three's raycaster can't see them (`mesh.raycast` is a no-op). Instead a
 * tap/click tests the ray against one vertical cylinder per tree built from the same row the
 * shader reads: axis at (x, z), from the displayed ground `hRef + (g − hRef)·exag` up to + h (the
 * tree itself is not exaggerated), radius = the shader's crown radius (seed jitter upper bound ×
 * distance crown scale). Only trees the shader actually draws count: existence weight
 * (`treeVisibility` × lens fade) ≥ 0.5. Cost: one pass over the resident rows (≈ 10⁵ trees,
 * a few ms) per tap, chunks whose box the ray misses are skipped by the caller.
 */
import { CROWN_SCALE_MAX, crownScale, displayY, treeVisibility } from './lod';
import type { TreeLodParams } from './lod';
import { TREE_STRIDE } from './treeData';

export interface PickRay {
  ox: number;
  oy: number;
  oz: number;
  /** Unit direction. */
  dx: number;
  dy: number;
  dz: number;
}

export interface PickOptions {
  hRef: number;
  exag: number;
  params: TreeLodParams;
  /** 0 = trees fully shown, 1 = faded out (Relikt-Blick). */
  lensFade: number;
  /** Extra radius per metre of distance for a near miss (≈ slack px × metres per px at 1 m). */
  slackPerM: number;
  /** Ignore trees whose crown appears smaller than this many slack units (far forest stays free for clicks). */
  minApparent: number;
  /** Ignore trees farther than this (m, 3D distance to the trunk base). */
  maxDistance: number;
}

export interface PickHit {
  /** The row array the tree came from. */
  rows: Float32Array;
  /** Row index in `rows` (row offset = index · TREE_STRIDE). */
  index: number;
  /** Ray parameter of the entry point (m). */
  t: number;
  /** False: hit only with the slack radius (a near miss). */
  exact: boolean;
}

/**
 * Entry/exit of a ray through a vertical cylinder (axis x = cx, z = cz, y ∈ [y0, y1], radius R).
 * Returns [tIn, tOut] (tIn may be < 0 when the origin is inside) or null.
 */
export function rayCylinder(ray: PickRay, cx: number, cz: number, y0: number, y1: number, R: number): [number, number] | null {
  const fx = ray.ox - cx;
  const fz = ray.oz - cz;
  const a = ray.dx * ray.dx + ray.dz * ray.dz;
  const c = fx * fx + fz * fz - R * R;
  let t0: number;
  let t1: number;
  if (a < 1e-12) {
    if (c > 0) return null; // vertical ray outside the circle
    t0 = -Infinity;
    t1 = Infinity;
  } else {
    const b = 2 * (fx * ray.dx + fz * ray.dz);
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    t0 = (-b - s) / (2 * a);
    t1 = (-b + s) / (2 * a);
  }
  if (Math.abs(ray.dy) < 1e-12) {
    if (ray.oy < y0 || ray.oy > y1) return null;
  } else {
    let a0 = (y0 - ray.oy) / ray.dy;
    let a1 = (y1 - ray.oy) / ray.dy;
    if (a0 > a1) [a0, a1] = [a1, a0];
    t0 = Math.max(t0, a0);
    t1 = Math.min(t1, a1);
  }
  return t0 <= t1 && t1 > 0 ? [t0, t1] : null;
}

/** Slab test: does the ray reach the box before `maxT`? */
export function rayHitsBox(
  ray: PickRay,
  b: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number },
  maxT = Infinity,
): boolean {
  let t0 = 0;
  let t1 = maxT;
  for (const [o, d, lo, hi] of [
    [ray.ox, ray.dx, b.xMin, b.xMax],
    [ray.oy, ray.dy, b.yMin, b.yMax],
    [ray.oz, ray.dz, b.zMin, b.zMax],
  ] as const) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let a = (lo - o) / d;
    let c = (hi - o) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Nearest tree along the ray in one row array (stride 8: x, g, z, h, r, rank, seed, kind).
 * Exact hits (shader crown radius) win over near misses (radius + slack); among each kind the
 * smallest entry `t` wins. `best` carries the result across several arrays (pass the previous one).
 */
export function pickTreeRows(rows: Float32Array, ray: PickRay, o: PickOptions, best: PickHit | null = null): PickHit | null {
  let out = best;
  const fade = 1 - Math.min(1, Math.max(0, o.lensFade));
  if (fade <= 0) return out;
  for (let k = 0, off = 0; off < rows.length; k++, off += TREE_STRIDE) {
    const x = rows[off];
    const z = rows[off + 2];
    const h = rows[off + 3];
    const base = displayY(rows[off + 1], o.hRef, o.exag);
    const ex = x - ray.ox;
    const ey = base - ray.oy;
    const ez = z - ray.oz;
    const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (d > o.maxDistance) continue;
    if (treeVisibility(rows[off + 5], d, o.params) * fade < 0.5) continue;
    const R = rows[off + 4] * 1.1 * Math.min(CROWN_SCALE_MAX, crownScale(d, o.params));
    const slack = o.slackPerM * d;
    if (R < o.minApparent * slack) continue;
    const exactHit = rayCylinder(ray, x, z, base, base + h, R);
    if (exactHit) {
      const t = Math.max(0, exactHit[0]);
      if (!out || !out.exact || t < out.t) out = { rows, index: k, t, exact: true };
      continue;
    }
    if (out?.exact) continue;
    const near = rayCylinder(ray, x, z, base, base + h + slack, R + slack);
    if (near) {
      const t = Math.max(0, near[0]);
      if (!out || t < out.t) out = { rows, index: k, t, exact: false };
    }
  }
  return out;
}
