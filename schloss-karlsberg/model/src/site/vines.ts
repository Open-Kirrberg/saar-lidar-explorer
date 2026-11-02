/**
 * KB-I35 vineyard plants (LP06 30, research/11 S10): one vine per stake on the rows the ground shader draws
 * (viewer/src/landcoverBake.ts VINE_GLSL), so the 3D plants near the camera stand exactly on the painted rows.
 *
 * Row frame (local x, z; `across` = the unit vector across the rows, i.e. along the contour, as the terrain shader's
 * `uVineAcross`): q = (xz · across) / rowDistance; row k is centred at q = k + 0.5. Along a row (alongDir = (−across.z,
 * across.x)) the shader swells the leaf wall plant by plant with cos(2π (along + rowShift · k)), so the stakes stand
 * at along = m − rowShift · k (m integer). Contour walks every `walkEvery` m along the rows stay free.
 *
 * `vinePlants` is pure (no three); `vineGeometry` builds the instanced plant (stake + leaf column) with the `crown`
 * attribute of the foliage shading (stake w = −1: bark).
 */
import * as THREE from 'three';
import { pointInPolygon, type P2 } from '../layout/geom.ts';
import { VINEYARD } from '../layout/grammar.ts';
import { mulberry32 } from '../layout/geom.ts';

export interface VinePlantOptions {
  /** keep stakes at least this far (m) inside the outline (the staked parcel edge) */
  inset?: number;
  /** extra test per stake (e.g. the ground class is still vineyard there) */
  accept?: (x: number, z: number) => boolean;
  /** cap on the number of stakes (safety) */
  max?: number;
}

/** Distance (m) from `p` to the nearest multiple of `period` (the contour walks). */
export function walkDistance(along: number, period: number = VINEYARD.walkEvery): number {
  const f = along / period + 0.5;
  return Math.abs(f - Math.floor(f) - 0.5) * period;
}

function edgeDistance(p: P2, ring: readonly P2[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - az) * ez) / l2)) : 0;
    d = Math.min(d, Math.hypot(p[0] - ax - ex * t, p[1] - az - ez * t));
  }
  return d;
}

/**
 * Stake positions (local x, z pairs) inside the vineyard outlines `rings` (local [x, z], closed or open), on the shader's
 * rows and plant phase, off the contour walks. Deterministic, no randomness.
 */
export function vinePlants(rings: readonly (readonly P2[])[], across: readonly [number, number], o: VinePlantOptions = {}): Float32Array {
  const V = VINEYARD;
  const inset = o.inset ?? 0.6;
  const max = o.max ?? 200000;
  const ax = across[0];
  const az = across[1];
  const al: P2 = [-az, ax];
  const out: number[] = [];
  for (const r0 of rings) {
    if (r0.length < 3) continue;
    const ring = r0[0][0] === r0[r0.length - 1][0] && r0[0][1] === r0[r0.length - 1][1] ? r0 : [...r0, r0[0]];
    let q0 = Infinity;
    let q1 = -Infinity;
    let a0 = Infinity;
    let a1 = -Infinity;
    for (const [x, z] of ring) {
      const q = (x * ax + z * az) / V.rowDistance;
      const a = x * al[0] + z * al[1];
      q0 = Math.min(q0, q);
      q1 = Math.max(q1, q);
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
    }
    for (let k = Math.floor(q0) - 1; k <= Math.ceil(q1); k++) {
      const s = V.rowDistance * (k + 0.5);
      const m0 = Math.floor(a0 + V.rowShift * k) - 1;
      const m1 = Math.ceil(a1 + V.rowShift * k) + 1;
      for (let m = m0; m <= m1; m++) {
        const a = m * V.stakeSpacing - V.rowShift * k;
        if (walkDistance(a) < V.walk / 2 + 0.3) continue;
        const x = ax * s + al[0] * a;
        const z = az * s + al[1] * a;
        const p: P2 = [x, z];
        if (!pointInPolygon(p, ring) || edgeDistance(p, ring) < inset) continue;
        if (o.accept && !o.accept(x, z)) continue;
        out.push(x, z);
        if (out.length / 2 >= max) return new Float32Array(out);
      }
    }
  }
  return new Float32Array(out);
}

/**
 * One vine plant in metres, standing at the origin (y up): a square stake (`stakeHeight`, w = −1 in the `crown`
 * attribute, so the foliage shader draws it as bark) and a loose leaf column of `clumps` small clumps round it between
 * VINEYARD.canopy[0] and [1]. `detail` 0 = octahedral clumps (far), 1 = icosahedral clumps (near), 2 = once-subdivided
 * icosahedra (the few plants next to the camera, where the 20-face clumps showed their facets; wave-7 review fix).
 * The clump layout (centres, radii, shade seed) depends only on `seed` and `clumps`, not on `detail`, so the tiers and
 * the leaf cards derived from one of them agree. Normals are blended between the clump sphere and the column envelope;
 * `crown` xyz = position in the column envelope (≈ −1..1). `fat` scales the clump radii (the far tier's fewer, larger
 * clumps keep the leaf cover of the near plant at a distance). The stake's side normals lean half toward the sky, so its
 * shaded faces read as weathered grey wood rather than black slots.
 */
export function vineGeometry(seed: number, detail: 0 | 1 | 2 = 1, clumps = 4, stake = true, fat = 1): THREE.BufferGeometry {
  const V = VINEYARD;
  const rnd = mulberry32(seed ^ 0x7e1);
  const pos: number[] = [];
  const nrm: number[] = [];
  const cw: number[] = [];
  const [c0, c1] = V.canopy;
  const cy = (c0 + c1) / 2;
  const hh = (c1 - c0) / 2;
  const R = V.canopyR;
  const push = (x: number, y: number, z: number, n: THREE.Vector3, w: number) => {
    pos.push(x, y, z);
    nrm.push(n.x, n.y, n.z);
    cw.push(x / R, (y - cy) / hh, z / R, w);
  };
  if (stake) {
    // square stake without caps (8 triangles), a little lean is given per instance
    const s = V.stakeWidth / 2;
    const corners: [number, number][] = [
      [-s, -s],
      [s, -s],
      [s, s],
      [-s, s],
    ];
    const n = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i];
      const [x1, z1] = corners[(i + 1) % 4];
      n.set(z1 - z0, 0, -(x1 - x0)).normalize();
      n.y = 0.5;
      n.normalize();
      const y0 = -0.15;
      const y1 = V.stakeHeight;
      for (const [x, y, z] of [
        [x0, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y0, z0],
        [x1, y1, z1],
        [x0, y1, z0],
      ] as [number, number, number][])
        push(x, y, z, n, -1);
    }
  }
  // clump layout first (independent of the detail level)
  const layout: { cx: number; cz: number; y: number; r: number; ry: number; w: number; js: number }[] = [];
  for (let k = 0; k < clumps; k++) {
    // clumps spiral up the stake, leaning out from it; the top one sits over the stake head's foot
    const t = clumps === 1 ? 0.5 : k / (clumps - 1);
    const a = k * 2.4 + rnd() * 0.8;
    const off = clumps === 1 ? 0 : R * (0.35 + 0.25 * rnd()) * (1 - 0.4 * t);
    const r = (clumps === 1 ? R : R * (0.55 + 0.2 * rnd()) * (1 - 0.15 * t)) * fat;
    const ry = clumps === 1 ? hh * 0.95 : r * (0.9 + 0.3 * rnd());
    layout.push({
      cx: Math.cos(a) * off,
      cz: Math.sin(a) * off,
      y: clumps === 1 ? cy : c0 + 0.22 + t * (c1 - c0 - 0.4),
      r,
      ry,
      w: rnd() * 0.98,
      js: Math.floor(rnd() * 0x7fffffff),
    });
  }
  const base = detail === 2 ? new THREE.IcosahedronGeometry(1, 1) : detail === 1 ? new THREE.IcosahedronGeometry(1, 0) : new THREE.OctahedronGeometry(1, 0);
  const g = base.index ? base.toNonIndexed() : base;
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e = new THREE.Vector3();
  for (const c of layout) {
    // vertex jitter (0.85-1.15 per shared corner) from the clump's own stream, so it does not shift later clumps
    const jr = mulberry32(c.js);
    const jit = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!jit.has(key)) jit.set(key, 0.85 + 0.3 * jr());
      const f = jit.get(key)!;
      v.set(p.getX(i) * c.r * f + c.cx, p.getY(i) * c.ry * f + c.y, p.getZ(i) * c.r * f + c.cz);
      n.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      e.set(v.x / R, (v.y - cy) / hh, v.z / R).normalize();
      n.multiplyScalar(0.45).addScaledVector(e, 0.55).normalize();
      push(v.x, v.y, v.z, n, c.w);
    }
  }
  g.dispose();
  if (g !== base) base.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('crown', new THREE.Float32BufferAttribute(cw, 4));
  geo.computeBoundingSphere();
  return geo;
}
