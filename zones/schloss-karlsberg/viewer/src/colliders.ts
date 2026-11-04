/**
 * Walk colliders as cached pieces (KB-I106). One BVH per terrain tile (TILE² cells, built from the height grid with the
 * render mesh's triangulation), per building level group and one for the site features; the walk queries the pieces
 * around the camera. A piece is built once and reused, so a „Gehe zu“ or a walk refresh only builds what is new
 * (was: one merged BVH of everything within 130 m, rebuilt up to three times per goto ≈ 0.5 s each on the phone proxy).
 */
import * as THREE from 'three';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';

export interface ColliderPiece {
  key: string;
  bvh: MeshBVH;
  /** World-space bounds (pieces whose box misses a query are skipped). */
  box: THREE.Box3;
  triangles: number;
}

/** Terrain collider tile edge in cells (1 m cells: 32 × 32 m, ≈ 2k triangles, ~1–2 ms BVH on the phone proxy). */
export const TILE = 32;

export interface ColliderGrid {
  west: number;
  north: number;
  cell: number;
  cols: number;
  rows: number;
}

/**
 * Tile origins (r0, c0) (multiples of TILE) whose cells come within `radius` m of the local point (x, z). Local frame:
 * x = E − e0, z = −(N − n0); cell centres at west + (c + 0.5)·cell, north − (r + 0.5)·cell (PixelIsArea).
 */
export function tilesAround(x: number, z: number, radius: number, g: ColliderGrid, e0: number, n0: number): [number, number][] {
  const c = (x + e0 - g.west) / g.cell - 0.5;
  const r = (g.north - (n0 - z)) / g.cell - 0.5;
  const span = radius / g.cell;
  const lastR = Math.max(0, g.rows - 2);
  const lastC = Math.max(0, g.cols - 2);
  const rLo = Math.max(0, Math.floor((r - span) / TILE));
  const rHi = Math.min(Math.floor(lastR / TILE), Math.floor((r + span) / TILE));
  const cLo = Math.max(0, Math.floor((c - span) / TILE));
  const cHi = Math.min(Math.floor(lastC / TILE), Math.floor((c + span) / TILE));
  const out: [number, number][] = [];
  for (let tr = rLo; tr <= rHi; tr++) for (let tc = cLo; tc <= cHi; tc++) out.push([tr * TILE, tc * TILE]);
  return out;
}

/**
 * Collider geometry of one terrain tile: vertices at the cell centres of rows r0…r0+TILE and cols c0…c0+TILE (clamped),
 * triangles (a, c, b), (b, c, e) as the render mesh at step 1 (terrain.ts); cells with a NaN corner are left out.
 */
export function terrainTileGeometry(h: ArrayLike<number>, g: ColliderGrid, r0: number, c0: number, cellX: (c: number) => number, cellZ: (r: number) => number): THREE.BufferGeometry | null {
  const r1 = Math.min(g.rows - 1, r0 + TILE);
  const c1 = Math.min(g.cols - 1, c0 + TILE);
  const nr = r1 - r0 + 1;
  const nc = c1 - c0 + 1;
  if (nr < 2 || nc < 2) return null;
  const pos = new Float32Array(nr * nc * 3);
  let k = 0;
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      pos[k++] = cellX(c);
      pos[k++] = h[r * g.cols + c];
      pos[k++] = cellZ(r);
    }
  const idx: number[] = [];
  for (let i = 0; i < nr - 1; i++)
    for (let j = 0; j < nc - 1; j++) {
      const a = i * nc + j;
      const b = a + 1;
      const c = a + nc;
      const e = c + 1;
      if (Number.isNaN(pos[a * 3 + 1]) || Number.isNaN(pos[b * 3 + 1]) || Number.isNaN(pos[c * 3 + 1]) || Number.isNaN(pos[e * 3 + 1])) continue;
      idx.push(a, c, b, b, c, e);
    }
  if (!idx.length) return null;
  // NaN vertices stay in the buffer unreferenced; the BVH bounds only see indexed triangles
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

/** Merge meshes (world matrices current) into one non-indexed world-space geometry; null if empty. */
export function mergeWorld(meshes: THREE.Mesh[]): THREE.BufferGeometry | null {
  let n = 0;
  for (const m of meshes) n += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
  if (!n) return null;
  const pos = new Float32Array(n * 3);
  let k = 0;
  const v = new THREE.Vector3();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const p = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const cnt = idx ? idx.count : p.count;
    for (let i = 0; i < cnt; i++) {
      v.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      pos[k++] = v.x;
      pos[k++] = v.y;
      pos[k++] = v.z;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return geo;
}

/** A piece from a world-space geometry (the BVH may reorder its index). */
export function pieceFrom(key: string, geo: THREE.BufferGeometry): ColliderPiece {
  const bvh = new MeshBVH(geo);
  const box = new THREE.Box3();
  bvh.getBoundingBox(box);
  const triangles = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  return { key, bvh, box, triangles };
}

/** Least-recently-used cache: `get` refreshes, `prune` drops the oldest entries beyond `max` not in `keep`. */
export class LruCache<T> {
  private map = new Map<string, T>();
  constructor(
    public max: number,
    private onEvict: (v: T) => void = () => {},
  ) {}
  get size(): number {
    return this.map.size;
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  get(key: string): T | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, v: T): void {
    this.map.delete(key);
    this.map.set(key, v);
  }
  delete(key: string): void {
    const v = this.map.get(key);
    if (v === undefined) return;
    this.map.delete(key);
    this.onEvict(v);
  }
  prune(keep: ReadonlySet<string>): void {
    for (const k of [...this.map.keys()]) {
      if (this.map.size <= this.max) return;
      if (!keep.has(k)) this.delete(k);
    }
  }
  clear(): void {
    for (const k of [...this.map.keys()]) this.delete(k);
  }
}

const rayBox = new THREE.Box3();

/** Distance to the first hit of a ray over the pieces (only pieces whose box the ray can reach); Infinity if none. */
export function raycastPieces(pieces: readonly ColliderPiece[], ray: THREE.Ray, maxDist: number): { distance: number; point: THREE.Vector3 } | null {
  let best: { distance: number; point: THREE.Vector3 } | null = null;
  rayBox.makeEmpty();
  rayBox.expandByPoint(ray.origin);
  rayBox.expandByPoint(ray.at(maxDist, new THREE.Vector3()));
  for (const p of pieces) {
    if (!p.box.intersectsBox(rayBox)) continue;
    const hit = p.bvh.raycastFirst(ray, THREE.DoubleSide);
    if (hit && hit.distance <= maxDist && (!best || hit.distance < best.distance)) best = { distance: hit.distance, point: hit.point };
  }
  return best;
}

/**
 * Push a capsule segment (radius r) horizontally out of the triangles of the pieces whose box touches `box` (walls push
 * horizontally only; floors are the ground probe's). Moves `seg` in place.
 */
export function pushOutPieces(pieces: readonly ColliderPiece[], seg: THREE.Line3, box: THREE.Box3, r: number): void {
  const triPoint = new THREE.Vector3();
  const capPoint = new THREE.Vector3();
  for (const p of pieces) {
    if (!p.box.intersectsBox(box)) continue;
    p.bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri: ExtendedTriangle) => {
        const dist = tri.closestPointToSegment(seg, triPoint, capPoint);
        if (dist < r) {
          const depth = r - dist;
          const dir = capPoint.sub(triPoint).normalize();
          dir.y = 0;
          if (dir.lengthSq() < 1e-6) return false;
          dir.normalize();
          seg.start.addScaledVector(dir, depth);
          seg.end.addScaledVector(dir, depth);
        }
        return false;
      },
    });
  }
}
