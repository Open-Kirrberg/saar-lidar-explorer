/**
 * Far stand-ins for the garden crowns (backlog KB-I105). The site trees (model site/trees.ts `treeMeshes`) are clump
 * crowns of 250–2300 triangles, one InstancedMesh per species and variant over the whole garden, so all of them were
 * drawn at full detail at every distance (≈ 1 M triangles in every Rundflug frame). Beyond SITE_STANDIN_NEAR m a crown
 * is a few dozen pixels and its clumps no longer read; there it is drawn as its **hull**: a low-poly shrink-wrap of the
 * same crown geometry (same silhouette, proportions, per-clump colour, bloom tint and `crown` attribute, so the foliage
 * shading applies unchanged) in a twin InstancedMesh with the same material.
 *
 * - `crownHull` (pure geometry): directions of a staggered latitude–longitude sphere in crown-envelope space (the
 *   `crown` attribute, |xyz| ≈ 1 on the envelope); per direction the outermost leaf vertex near it (radial reach minus a
 *   penalty for its distance off the ray), so lumps of the clump silhouette survive and the hull never bulges past the
 *   crown. Normals blend the hull's own smooth normal with the envelope normal like the clumps (`pushLobe`, 0.62).
 * - `SiteCrownLod` (siteTreeLod.ts) moves instances between the full mesh and the hull twin by camera distance.
 */
import * as THREE from 'three';

/** Hull resolution: meridians and polar ring angles (rad from the top, first 0, last π). */
export interface HullOptions {
  meridians?: number;
  rings?: readonly number[];
  /** penalty per unit of off-ray distance (envelope units): higher = tighter lumps, lower = rounder hull */
  penalty?: number;
  /** envelope-normal share of the shading normal (the clump crowns use 0.62) */
  blend?: number;
  /** 0: a hull vertex lies at the outermost vertex's projection on its ray; 1: at that vertex's full radius */
  reach?: number;
  /** crown-attribute radius factor: the clump crown's visible surface lies partly in its gaps (inner, darker) [I] */
  depth?: number;
}

/** 7 meridians, 5 inner rings: 7 + 4 · 14 + 7 = 70 triangles (the ring at 2.75 rad keeps hanging skirts and cone feet). */
export const HULL_DEFAULT: Required<HullOptions> = { meridians: 7, rings: [0, 0.55, 1.1, 1.7, 2.3, 2.75, Math.PI], penalty: 0.8, reach: 0.5, blend: 0.62, depth: 0.94 };

/** Triangles of a hull with `m` meridians and `r` rings (poles included). */
export function hullTriangles(m: number, r: number): number {
  return 2 * m + 2 * m * (r - 3);
}

/** Unit directions of the hull vertices (staggered rings, poles once) and the triangle index. */
export function hullDirections(meridians: number, rings: readonly number[]): { dirs: THREE.Vector3[]; index: number[] } {
  const dirs: THREE.Vector3[] = [new THREE.Vector3(0, 1, 0)];
  const ringStart: number[] = [0];
  for (let k = 1; k < rings.length - 1; k++) {
    ringStart.push(dirs.length);
    const th = rings[k];
    for (let j = 0; j < meridians; j++) {
      const ph = ((j + (k % 2) * 0.5) / meridians) * Math.PI * 2;
      dirs.push(new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)));
    }
  }
  const bottom = dirs.length;
  dirs.push(new THREE.Vector3(0, -1, 0));
  const at = (k: number, j: number) => ringStart[k] + (((j % meridians) + meridians) % meridians);
  const index: number[] = [];
  const M = meridians;
  const last = rings.length - 2;
  for (let j = 0; j < M; j++) index.push(0, at(1, j + 1), at(1, j));
  for (let k = 1; k < last; k++) {
    // odd rings are shifted by half a step: the lower ring's vertex between upper j and j+1 is j+1 below an odd ring
    // (phases j+½ / j+1½ over j+1) and j below an even one (j / j+1 over j+½)
    const shift = k % 2;
    for (let j = 0; j < M; j++) {
      const a = at(k, j);
      const c0 = at(k + 1, j + shift);
      index.push(a, at(k, j + 1), c0);
      index.push(a, c0, at(k + 1, j + shift - 1));
    }
  }
  for (let j = 0; j < M; j++) index.push(at(last, j), at(last, j + 1), bottom);
  return { dirs, index };
}

/**
 * Shrink-wrap hull of a crown geometry (non-indexed or indexed, with `position`, `normal` and `crown`; optional
 * `color`). The result is indexed, with `position`, `normal`, `crown` and (when the source has it) `color`.
 */
export function crownHull(src: THREE.BufferGeometry, o: HullOptions = {}): THREE.BufferGeometry {
  const opt = { ...HULL_DEFAULT, ...o };
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const cw = src.getAttribute('crown') as THREE.BufferAttribute | undefined;
  const col = src.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!cw) throw new Error('crownHull: the crown geometry has no `crown` attribute');
  // frame: the leaf vertices' bounding box (centre, half sizes), so the hull can never leave the crown's bounds
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const e = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (cw.getW(i) < 0) continue; // branch limbs
    e.fromBufferAttribute(pos, i);
    lo.min(e);
    hi.max(e);
  }
  const ctr = lo.clone().add(hi).multiplyScalar(0.5);
  const half = hi.clone().sub(lo).multiplyScalar(0.5).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
  const { dirs, index } = hullDirections(opt.meridians, opt.rings);
  const n = dirs.length;
  const P = new Float32Array(n * 3);
  const C = new Float32Array(n * 4);
  const Co = col ? new Float32Array(n * 3) : null;
  for (let k = 0; k < n; k++) {
    const d = dirs[k];
    let best = -Infinity;
    let bi = -1;
    for (let i = 0; i < pos.count; i++) {
      if (cw.getW(i) < 0) continue;
      e.fromBufferAttribute(pos, i).sub(ctr).divide(half);
      const along = e.dot(d);
      if (along <= 0) continue;
      const off = Math.sqrt(Math.max(0, e.lengthSq() - along * along));
      const s = along - opt.penalty * off;
      if (s > best) {
        best = s;
        bi = i;
      }
    }
    // the winning vertex's projection on the ray, pushed `reach` of the way out to its full radius
    let r = 0.3;
    let crownScale = 0;
    if (bi >= 0) {
      e.fromBufferAttribute(pos, bi).sub(ctr).divide(half);
      const along = e.dot(d);
      const len = e.length();
      r = Math.max(0.15, along + opt.reach * (len - along));
      crownScale = r / Math.max(1e-6, len);
    }
    // in the box frame, clamped to the box
    e.copy(d).multiplyScalar(r).clampScalar(-1, 1).multiply(half).add(ctr);
    P[k * 3] = e.x;
    P[k * 3 + 1] = e.y;
    P[k * 3 + 2] = e.z;
    if (bi >= 0) {
      // the winning vertex's envelope position, scaled like the hull vertex (|xyz| stays ≲ 1)
      e.set(cw.getX(bi), cw.getY(bi), cw.getZ(bi)).multiplyScalar(crownScale);
      if (e.length() > 1.15) e.setLength(1.15); // cone crowns run past the unit envelope at their tips
      e.multiplyScalar(opt.depth);
      C[k * 4] = e.x;
      C[k * 4 + 1] = e.y;
      C[k * 4 + 2] = e.z;
      C[k * 4 + 3] = Math.min(0.98, cw.getW(bi));
    } else {
      C[k * 4] = d.x * 0.3;
      C[k * 4 + 1] = d.y * 0.3;
      C[k * 4 + 2] = d.z * 0.3;
      C[k * 4 + 3] = 0.5;
    }
    if (Co && col) {
      const j = Math.max(0, bi);
      Co[k * 3] = col.getX(j);
      Co[k * 3 + 1] = col.getY(j);
      Co[k * 3 + 2] = col.getZ(j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // blend with the envelope normal (the ellipsoid inscribed in the box)
  const N = g.getAttribute('normal') as THREE.BufferAttribute;
  const hn = new THREE.Vector3();
  const en = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    hn.set(N.getX(k), N.getY(k), N.getZ(k));
    en.set((P[k * 3] - ctr.x) / (half.x * half.x), (P[k * 3 + 1] - ctr.y) / (half.y * half.y), (P[k * 3 + 2] - ctr.z) / (half.z * half.z)).normalize();
    hn.multiplyScalar(1 - opt.blend).addScaledVector(en, opt.blend).normalize();
    N.setXYZ(k, hn.x, hn.y, hn.z);
  }
  g.setAttribute('crown', new THREE.BufferAttribute(C, 4));
  if (Co) g.setAttribute('color', new THREE.BufferAttribute(Co, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
