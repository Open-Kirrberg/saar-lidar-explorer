/**
 * Distance LOD of the garden crowns (backlog KB-I105): full clump crowns near the camera, their hull stand-ins
 * (crownStandIn.ts) beyond. Every registered site-tree crown mesh keeps its instances (matrices, colours) in a copy;
 * whenever the camera has moved STANDIN_STEP m, the instances within `near` m go to the full mesh and the rest to its
 * hull twin (same material, same per-instance colour), each with a tight bounding sphere for the frustum and shadow
 * culling. No instance moves or changes colour, so the swap is the only change; it lies beyond the leaf cards
 * (LEAF_CARD_FAR), where a crown is ≲ 1/30 of the screen height. The shadow map is not marked dirty: the hull is the
 * crown's own envelope.
 *
 * Counted as drawn: the full meshes hold only the near instances, so the castle's `inView()` sees what is submitted.
 */
import * as THREE from 'three';
import { crownHull } from './crownStandIn.ts';

/** Distance (m, camera to the crown centre) beyond which a garden crown is drawn as its hull, at the least [I]. */
export const SITE_STANDIN_NEAR = 160;
/**
 * …and in crown radii: a big crown keeps its clumps until it is small on screen. 34 R: a 12 m crown swaps at 204 m,
 * where it is ≲ 45 px tall on a 900 px desktop view (50° fov) and its clumps are 4-8 px [I].
 */
export const STANDIN_RADII = 34;
/** Hysteresis (m): a near crown stays near out to `near + this` (no flicker of crowns at the threshold). */
export const STANDIN_HYST = 12;
/** Camera travel (m) before the sets are recomputed. */
export const STANDIN_STEP = 4;

/**
 * Near flags for the instance centres `c` (xyz triples) seen from `p`: near when closer than `near`, or than
 * `near + hyst` if it was near before (`was`). Pure; returns the count of near instances.
 */
export function selectNear(c: ArrayLike<number>, n: number, p: { x: number; y: number; z: number }, near: number | ArrayLike<number>, hyst: number, was: Uint8Array, out: Uint8Array): number {
  let k = 0;
  for (let i = 0; i < n; i++) {
    const ni = typeof near === 'number' ? near : near[i];
    const n2 = ni * ni;
    const h2 = (ni + hyst) * (ni + hyst);
    const dx = c[i * 3] - p.x;
    const dy = c[i * 3 + 1] - p.y;
    const dz = c[i * 3 + 2] - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const on = d2 < n2 || (was[i] === 1 && d2 < h2) ? 1 : 0;
    out[i] = on;
    k += on;
  }
  return k;
}

interface Source {
  full: THREE.InstancedMesh;
  hull: THREE.InstancedMesh;
  n: number;
  mats: Float32Array;
  cols: Float32Array | null;
  centres: Float32Array;
  /** crown radius (m) per instance */
  radii: Float32Array;
  /** near distance per instance (max(near, radii · R)) */
  dist: Float32Array;
  near: Uint8Array;
  next: Uint8Array;
  /** the meshes still hold the build state (all instances in full) */
  dirty: boolean;
}

const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

export class SiteCrownLod {
  /** full crowns within this distance (m); A/B: `skb.siteTrees.near = 1e9` draws every crown in full */
  near = SITE_STANDIN_NEAR;
  /** …or within this many crown radii */
  radii = STANDIN_RADII;
  private drawnRadii = NaN;
  private hullMats = new Map<THREE.Material, THREE.Material>();

  /**
   * `prepare` patches a new hull material like the site leaf material (sky SH diffuse, foliage.ts); without it the
   * hulls share the crowns' material (tests).
   */
  constructor(private prepare: ((m: THREE.MeshStandardMaterial) => void) | null = null) {}

  /**
   * The hull's material: the crown's own plus FOL_MID, the leaf-cluster relief of the forest's mid domes (foliage.ts),
   * so the 70-triangle hull reads as a clumpy canopy like the forest crowns at the same distance, not as a smooth blob.
   */
  private hullMaterial(src: THREE.Material): THREE.Material {
    if (!this.prepare || !(src as THREE.MeshStandardMaterial).isMeshStandardMaterial) return src;
    let m = this.hullMats.get(src);
    if (!m) {
      const h = (src as THREE.MeshStandardMaterial).clone();
      h.userData = {}; // the patch flags of the source; the hull material is patched afresh
      h.defines = { ...(src.defines ?? {}), FOL_MID: '' };
      this.prepare(h);
      this.hullMats.set(src, (m = h));
    }
    return m;
  }
  /** camera inside a building: nothing is drawn (the castle culls the site vegetation there) */
  indoor = false;
  private sources: Source[] = [];
  private at = new THREE.Vector3(1e9, 1e9, 1e9);
  private drawnNear = NaN;
  private drawnIndoor = false;

  /**
   * Take over a site-tree crown mesh (model site/trees.ts: 'vegetation.leaf' with the `crown` attribute): a hull twin
   * is added next to it (same parent, name `<name>/far`, userData.lod 'far'). Returns the twin, or null when skipped.
   */
  register(im: THREE.InstancedMesh): THREE.InstancedMesh | null {
    const mat = im.material as THREE.Material;
    if (Array.isArray(mat) || mat.name !== 'vegetation.leaf' || !im.geometry.getAttribute('crown') || !im.parent || im.count < 1) return null;
    let hg = hullCache.get(im.geometry);
    if (!hg) hullCache.set(im.geometry, (hg = crownHull(im.geometry)));
    // crowns that are already cheap (clipped yew cones, 48 triangles) stay as they are
    if (triangles(hg) * 2 > triangles(im.geometry)) return null;
    const n = im.count;
    const hull = new THREE.InstancedMesh(hg, this.hullMaterial(mat), n);
    hull.count = 0;
    hull.name = `${im.name}/far`;
    hull.castShadow = im.castShadow;
    hull.receiveShadow = im.receiveShadow;
    hull.userData = { ...im.userData, lod: 'far' };
    hull.position.copy(im.position);
    hull.quaternion.copy(im.quaternion);
    hull.scale.copy(im.scale);
    hull.renderOrder = im.renderOrder;
    if (im.instanceColor) hull.setColorAt(0, new THREE.Color(1, 1, 1));
    im.parent.add(hull);
    const mats = new Float32Array(im.instanceMatrix.array.subarray(0, n * 16));
    const cols = im.instanceColor ? new Float32Array(im.instanceColor.array.subarray(0, n * 3)) : null;
    im.updateWorldMatrix(true, false);
    const centres = new Float32Array(n * 3);
    const radii = new Float32Array(n);
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    if (!im.geometry.boundingSphere) im.geometry.computeBoundingSphere();
    const r0 = im.geometry.boundingSphere!.radius * im.matrixWorld.getMaxScaleOnAxis();
    for (let i = 0; i < n; i++) {
      m.fromArray(mats, i * 16);
      radii[i] = r0 * m.getMaxScaleOnAxis();
      v.setFromMatrixPosition(m).applyMatrix4(im.matrixWorld);
      centres.set([v.x, v.y, v.z], i * 3);
    }
    // the full mesh keeps all its instances (as built) until the first update, which selects without hysteresis
    const dist = new Float32Array(n);
    for (let i = 0; i < n; i++) dist[i] = Math.max(this.near, this.radii * radii[i]);
    this.sources.push({ full: im, hull, n, mats, cols, centres, radii, dist, near: new Uint8Array(n), next: new Uint8Array(n), dirty: true });
    return hull;
  }

  /** Per frame: recompute the near sets when the camera moved STANDIN_STEP m (or `near` / indoor changed). */
  update(camera: THREE.Camera): void {
    const p = camera.position;
    const indoorChanged = this.indoor !== this.drawnIndoor;
    const distChanged = this.near !== this.drawnNear || this.radii !== this.drawnRadii;
    if (!indoorChanged && !distChanged && p.distanceToSquared(this.at) < STANDIN_STEP * STANDIN_STEP) return;
    this.drawnIndoor = this.indoor;
    this.drawnNear = this.near;
    this.drawnRadii = this.radii;
    this.at.copy(p);
    for (const s of this.sources) {
      if (distChanged) for (let i = 0; i < s.n; i++) s.dist[i] = Math.max(this.near, this.radii * s.radii[i]);
      const k = selectNear(s.centres, s.n, p, s.dist, STANDIN_HYST, s.near, s.next);
      let changed = false;
      for (let i = 0; i < s.n; i++)
        if (s.next[i] !== s.near[i]) {
          changed = true;
          break;
        }
      const swap = s.near;
      s.near = s.next;
      s.next = swap;
      if (changed || s.dirty) this.fill(s);
      s.dirty = false;
      // visible only with instances (an empty mesh still costs its state changes); never indoors
      s.full.visible = !this.indoor && k > 0;
      s.hull.visible = !this.indoor && k < s.n;
    }
  }

  private fill(s: Source): void {
    const fm = s.full.instanceMatrix.array as Float32Array;
    const hm = s.hull.instanceMatrix.array as Float32Array;
    const fc = s.full.instanceColor?.array as Float32Array | undefined;
    const hc = s.hull.instanceColor?.array as Float32Array | undefined;
    let a = 0;
    let b = 0;
    for (let i = 0; i < s.n; i++) {
      const src = s.mats.subarray(i * 16, i * 16 + 16);
      if (s.near[i]) {
        fm.set(src, a * 16);
        if (fc && s.cols) fc.set(s.cols.subarray(i * 3, i * 3 + 3), a * 3);
        a++;
      } else {
        hm.set(src, b * 16);
        if (hc && s.cols) hc.set(s.cols.subarray(i * 3, i * 3 + 3), b * 3);
        b++;
      }
    }
    s.full.count = a;
    s.hull.count = b;
    for (const im of [s.full, s.hull]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      if (im.count) im.computeBoundingSphere();
    }
  }

  /** Diagnostics: crowns drawn in full and as hulls, and their triangles. */
  stats(): { meshes: number; full: number; hull: number; fullTriangles: number; hullTriangles: number } {
    let full = 0;
    let hull = 0;
    let ft = 0;
    let ht = 0;
    for (const s of this.sources) {
      full += s.full.count;
      hull += s.hull.count;
      ft += s.full.count * triangles(s.full.geometry);
      ht += s.hull.count * triangles(s.hull.geometry);
    }
    return { meshes: this.sources.length, full, hull, fullTriangles: ft, hullTriangles: ht };
  }
}
