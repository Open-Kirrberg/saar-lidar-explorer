/**
 * V2.8b: walking on a captured mesh (gltf zone runtime). One merged BVH over the collider meshes (zone frame,
 * metres): the ground is a ray down from the knees (steps ≤ STEP_UP), walls are near-vertical triangles in a
 * band WALL_LOW…WALL_HIGH above the feet that push a vertical capsule back horizontally. Thresholds are tuned
 * on the bakery capture (handheld route, noisy floor, clutter): err on walking through an artefact. Holes in the mesh (glass, dark corners) keep the last height.
 * A built twin's walkable floor (`twin.nav`, ADR 0042) is exact instead: there a hole is the edge of the world, and
 * `holes: 'block'` stops the visitor at it (sliding along the edge, one axis at a time).
 * three.js + three-mesh-bvh only, no DOM: unit-tested on synthetic geometry.
 */
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Line3, Ray, Vector3 } from 'three';
import type { Mesh, Object3D } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export const EYE_M = 1.6;
/** Highest step the visitor climbs without jumping (kerb, door sill). */
export const STEP_UP = 0.45;
/** Deepest step down; deeper hits are holes (shiny floors reconstruct a mirrored room below the floor). */
export const STEP_DOWN = 0.6;
export const BODY_R = 0.2;
/** Wall band above the feet: below it the ground ray handles steps and floor noise, above it hangs clutter. */
export const WALL_LOW = 0.6;
export const WALL_HIGH = 1.5;
/** Triangles with n.y above this are floor (≈ 53° slope); |n.y| below it is wall. */
const FLOOR_NY = 0.6;
const DOWN = new Vector3(0, -1, 0);

/** What a step onto no floor does: `keep` = walk on at the same height (noisy captures), `block` = stop (exact nav floors). */
export type HolePolicy = 'keep' | 'block';

/**
 * Merge the meshes under `root` (world matrices applied, quantized attributes decoded) into one indexed
 * Float32 geometry + BVH. `root.updateMatrixWorld()` must be current.
 */
export function buildCollider(root: Object3D): MeshBVH | null {
  const parts: { pos: Float32Array; idx: Uint32Array }[] = [];
  const v = new Vector3();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.geometry?.attributes.position) return;
    const src = m.geometry.attributes.position;
    const pos = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(m.matrixWorld);
      pos[3 * i] = v.x;
      pos[3 * i + 1] = v.y;
      pos[3 * i + 2] = v.z;
    }
    const index = m.geometry.index;
    const idx = index ? Uint32Array.from({ length: index.count }, (_, i) => index.getX(i)) : Uint32Array.from({ length: src.count }, (_, i) => i);
    parts.push({ pos, idx });
  });
  if (!parts.length) return null;
  const nv = parts.reduce((s, p) => s + p.pos.length / 3, 0);
  const ni = parts.reduce((s, p) => s + p.idx.length, 0);
  const pos = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let ov = 0;
  let oi = 0;
  for (const p of parts) {
    pos.set(p.pos, ov * 3);
    for (let i = 0; i < p.idx.length; i++) idx[oi + i] = p.idx[i]! + ov;
    ov += p.pos.length / 3;
    oi += p.idx.length;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return new MeshBVH(g, { targetLeafSize: 10 });
}

/** Walk physics state for one visitor on one collider. */
export class Walker {
  /** Feet height of the last found ground (zone frame y). */
  groundY: number;
  private readonly ray = new Ray();
  private readonly seg = new Line3();
  private readonly box = new Box3();
  private readonly tp = new Vector3();
  private readonly sp = new Vector3();
  private readonly nrm = new Vector3();

  constructor(
    readonly bvh: MeshBVH,
    groundY: number,
    readonly bodyR = BODY_R,
    readonly holes: HolePolicy = 'keep',
  ) {
    this.groundY = groundY;
  }

  /** Ground (floor triangle) height below (x, fromY, z) within `depth` metres; NaN = none. */
  groundAt(x: number, z: number, fromY: number, depth = 3): number {
    this.ray.origin.set(x, fromY, z);
    this.ray.direction.copy(DOWN);
    // Nearest floor hit; skip steep triangles (a wall face under the knees) by stepping past them.
    const bottom = fromY - depth;
    let y = fromY;
    for (let i = 0; i < 4 && y > bottom; i++) {
      this.ray.origin.y = y;
      const hit = this.bvh.raycastFirst(this.ray, DoubleSide, 0, y - bottom);
      if (!hit) return NaN;
      // floors face up (captured meshes are consistently wound); ceilings, lintels and wall faces are skipped
      const ny = hit.face ? hit.face.normal.y : 1;
      if (ny >= FLOOR_NY) return hit.point.y;
      y = hit.point.y - 0.01;
    }
    return NaN;
  }

  /** Put the feet on the floor near `eyeY` (spawn): search from 1 m above the eye down 6 m; none → eye − EYE_M. */
  settle(x: number, z: number, eyeY: number): number {
    const g = this.groundAt(x, z, eyeY + 1, 6 + EYE_M);
    this.groundY = Number.isNaN(g) ? eyeY - EYE_M : g;
    return this.groundY;
  }

  /** Floor a walker with feet at `feet` can step onto at (x, z): STEP_UP up … STEP_DOWN down; NaN = hole. */
  floorAt(x: number, z: number, feet: number): number {
    return this.groundAt(x, z, feet + STEP_UP + 0.05, STEP_UP + 0.05 + STEP_DOWN);
  }

  /**
   * Move from (x0, z0) to (x1, z1): the feet follow the floor (up ≤ STEP_UP, down ≤ STEP_DOWN, else a hole),
   * then walls push the capsule out. Returns the new feet position. With `holes: 'block'` a move onto no floor
   * (or too high) slides along the blocked axis instead, else stays.
   */
  step(x0: number, z0: number, x1: number, z1: number): { x: number; z: number; y: number } {
    const r = this.tryStep(x1, z1);
    if (r) return r;
    if (this.holes === 'block') {
      const slide = (x1 !== x0 ? this.tryStep(x1, z0) : null) ?? (z1 !== z0 ? this.tryStep(x0, z1) : null);
      if (slide) return slide;
    }
    return { x: x0, z: z0, y: this.groundY };
  }

  /** One move attempt; null = blocked (too high, or a hole under `holes: 'block'`). */
  private tryStep(x1: number, z1: number): { x: number; z: number; y: number } | null {
    const feet = this.groundY;
    const block = this.holes === 'block';
    // No floor here (hole, mesh edge, a mirror world below shiny tiles): stay level, or NaN when blocking.
    const floor = (x: number, z: number) => {
      const g = this.floorAt(x, z, feet);
      return Number.isNaN(g) && !block ? feet : g;
    };
    // Floor first, then walls against the new feet height (a riser ahead is not a wall).
    let g = floor(x1, z1);
    if (Number.isNaN(g) || g - feet > STEP_UP + 0.05) return null; // hole (block) or too high (counter, furniture)
    let x = x1;
    let z = z1;
    for (let pass = 0; pass < 3; pass++) {
      const q = this.pushOut(x, z, Math.max(feet, g));
      if (!q) break;
      x = q.x;
      z = q.z;
    }
    if (x !== x1 || z !== z1) {
      g = floor(x, z);
      if (Number.isNaN(g) || g - feet > STEP_UP + 0.05) return null;
    }
    this.groundY = g;
    return { x, z, y: g };
  }

  /** One push-out pass of the capsule (feet + WALL_LOW … feet + WALL_HIGH) against wall triangles; null = free. */
  private pushOut(x: number, z: number, feet: number): { x: number; z: number } | null {
    const r = this.bodyR;
    this.seg.start.set(x, feet + WALL_LOW, z);
    this.seg.end.set(x, feet + WALL_HIGH, z);
    this.box.min.set(x - r, feet + WALL_LOW - r, z - r);
    this.box.max.set(x + r, feet + WALL_HIGH + r, z + r);
    let dx = 0;
    let dz = 0;
    let hit = false;
    const { seg, tp, sp, box, nrm } = this;
    this.bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri) => {
        const d = tri.closestPointToSegment(seg, tp, sp);
        if (d >= r) return false;
        // only the band itself (not the capsule's round caps): risers and floor noise are the ground ray's job
        if (tp.y < feet + WALL_LOW || tp.y > feet + WALL_HIGH) return false;
        if (Math.abs(tri.getNormal(nrm).y) >= FLOOR_NY) return false;
        // Horizontal push from the triangle point to the capsule axis (or along the normal if it touches).
        let ex = sp.x - tp.x;
        let ez = sp.z - tp.z;
        let len = Math.hypot(ex, ez);
        if (len < 1e-6) {
          ex = nrm.x;
          ez = nrm.z;
          len = Math.hypot(ex, ez) || 1;
        }
        const push = r - d + 1e-3;
        dx += (ex / len) * push;
        dz += (ez / len) * push;
        hit = true;
        return false;
      },
    });
    if (!hit) return null;
    // Many coplanar wall triangles add up; cap the push to one radius per pass.
    const m = Math.hypot(dx, dz);
    const k = m > r ? r / m : 1;
    return { x: x + dx * k, z: z + dz * k };
  }
}
