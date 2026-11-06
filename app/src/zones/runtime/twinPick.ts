/**
 * Built twins (ADR 0042): what can be clicked, and the hover / tap highlight (docs/style.md „Interaction look“).
 *
 * `TwinTargets` merges the drawn twin into one BVH (zone frame) whose vertices carry a target index: −1 = an
 * occluder (walls, floor, enclosing targets), else a clickable target (a product slot or a catalogue object,
 * `catalogue.ts` `resolveTarget`). One `raycastFirst` per pick finds the nearest opaque surface; glass is left
 * out, so products behind display glass stay pickable and walls still block. Built once per drawn LOD.
 * Small products also get an invisible proxy box (`../pickProxy.ts`): a tap near a bread on the bread wall picks the
 * bread, not the shelf, with a pick radius of ≈ 44 px on touch.
 *
 * `TwinHighlight` draws the hovered target with a warm outline (inverted hull, constant pixel width) and a rim
 * glow (additive fresnel) in `messing` lightened by 30 %, and lifts it by 2 % (scale about its foot). Both work on
 * the twin's unlit + COLOR_0 materials, which they never touch. No allocations per frame. Flat targets on a wall
 * (the gable mural, the picture frames: single-sided decals, no back faces for a hull) get a warm picture frame
 * just in front of them instead of the outline, and no lift (`../flatFrame.ts`). Where a hull face looks along the
 * view ray its offset points away from the target's centre on screen.
 */
import { AdditiveBlending, BackSide, Box3, BufferAttribute, BufferGeometry, DoubleSide, FrontSide, LessEqualDepth, Matrix4, Mesh, ShaderMaterial, Vector2, Vector3 } from 'three';
import type { Material, Object3D, Ray, WebGLRenderer } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { discoveryId, groupTarget, isEnclosing, resolveTarget } from '../catalogue';
import type { NodeExtras, PickTarget, ZoneCatalogue } from '../catalogue';
import { FRAME_GAP_M, FRAME_LIFT_M, flatPanel, frameRing, frameWidth } from '../flatFrame';
import type { P3 } from '../flatFrame';
import { chooseProxy, isSmallBox, proxySlack } from '../pickProxy';
import type { ProxyBox } from '../pickProxy';

/** `messing` #C29A4B mixed 30 % towards white (style.md: lighter by 30 %), sRGB. */
export const HIGHLIGHT_SRGB: readonly [number, number, number] = [0xd4 / 255, 0xb8 / 255, 0x81 / 255];
/** style.md optional ink line `#3A2A22` ≈ 40 %: a thin dark edge outside the warm outline (contrast on light walls). */
export const INK_SRGB: readonly [number, number, number] = [0x3a / 255, 0x2a / 255, 0x22 / 255];
export const LIFT = 0.02;
/** Outline widths in CSS px: warm band, ink edge outside it. */
export const OUTLINE_PX = 3;
export const INK_PX = 4.5;
/** Picks farther than this (m) are ignored (the gable mural from the street is ≈ 15 m). */
export const PICK_FAR_M = 30;

interface TargetEntry {
  target: PickTarget;
  meshes: Mesh[];
  box: Box3;
}

export interface PickHit {
  target: PickTarget;
  distance: number;
}

const isOpaque = (mat: Material | Material[]): boolean =>
  ([] as Material[]).concat(mat).some((m) => !(m.transparent && m.opacity < 0.99) && m.visible !== false && m.opacity > 0.01);

/** Node extras chain of `o` up to (excluding) `root`, nearest first. */
function chainOf(o: Object3D, root: Object3D): NodeExtras[] {
  const out: NodeExtras[] = [];
  for (let n: Object3D | null = o; n && n !== root; n = n.parent) out.push(n.userData as NodeExtras);
  return out;
}

export class TwinTargets {
  private bvh: MeshBVH | null = null;
  private vertTarget = new Int32Array(0);
  private entries: TargetEntry[] = [];
  private readonly byKey = new Map<string, TargetEntry>();
  /** Pick proxies of the small products, and their entry index. */
  private proxies: ProxyBox[] = [];
  private proxyOf: number[] = [];
  /** Highlight meshes + box per target key (groups: the union of their members), built lazily. */
  private readonly groups = new Map<string, { meshes: Mesh[]; box: Box3 }>();

  constructor(private readonly cat: ZoneCatalogue) {}

  get size(): number {
    return this.entries.length;
  }

  /** Target keys (debug / tests). */
  keys(): string[] {
    return this.entries.map((e) => e.target.key);
  }

  /** (Re)build from the drawn meshes under `root` (`root.updateMatrixWorld(true)` must be current). */
  index(root: Object3D): void {
    this.dispose();
    const v = new Vector3();
    const parts: { mesh: Mesh; entry: TargetEntry | null }[] = [];
    root.traverseVisible((o) => {
      const m = o as Mesh;
      if (!m.isMesh || m.userData.sleOverlay || !m.geometry?.attributes.position || !isOpaque(m.material)) return;
      const t = resolveTarget(chainOf(m, root), this.cat);
      let entry: TargetEntry | null = null;
      if (t) {
        entry = this.byKey.get(t.key) ?? null;
        if (!entry) {
          entry = { target: t, meshes: [], box: new Box3() };
          this.byKey.set(t.key, entry);
        }
        entry.meshes.push(m);
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        entry.box.union(new Box3().copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
      }
      parts.push({ mesh: m, entry });
    });
    // enclosing targets (a room, the facade) only block
    const size = new Vector3();
    for (const [k, e] of this.byKey) {
      e.box.getSize(size);
      if (isEnclosing(size.x, size.y, size.z)) this.byKey.delete(k);
    }
    this.entries = [...this.byKey.values()];
    const slot = new Map(this.entries.map((e, i) => [e, i]));
    const c = new Vector3();
    this.entries.forEach((e, i) => {
      if (e.target.kind !== 'product') return;
      e.box.getSize(size);
      if (!isSmallBox([size.x, size.y, size.z])) return;
      e.box.getCenter(c);
      this.proxies.push({ c: [c.x, c.y, c.z], h: [size.x / 2, size.y / 2, size.z / 2] });
      this.proxyOf.push(i);
    });
    let nv = 0;
    let ni = 0;
    for (const p of parts) {
      nv += p.mesh.geometry.attributes.position!.count;
      ni += p.mesh.geometry.index?.count ?? p.mesh.geometry.attributes.position!.count;
    }
    if (!ni) return;
    const pos = new Float32Array(nv * 3);
    const idx = new Uint32Array(ni);
    this.vertTarget = new Int32Array(nv);
    let ov = 0;
    let oi = 0;
    for (const { mesh, entry } of parts) {
      const src = mesh.geometry.attributes.position!;
      const t = entry ? (slot.get(entry) ?? -1) : -1;
      for (let i = 0; i < src.count; i++) {
        v.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
        pos[3 * (ov + i)] = v.x;
        pos[3 * (ov + i) + 1] = v.y;
        pos[3 * (ov + i) + 2] = v.z;
        this.vertTarget[ov + i] = t;
      }
      const index = mesh.geometry.index;
      if (index) for (let i = 0; i < index.count; i++) idx[oi + i] = index.getX(i) + ov;
      else for (let i = 0; i < src.count; i++) idx[oi + i] = ov + i;
      ov += src.count;
      oi += index?.count ?? src.count;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(new BufferAttribute(idx, 1));
    this.bvh = new MeshBVH(g, { targetLeafSize: 10 });
  }

  /** Number of small-product pick proxies (debug / tests). */
  get proxyCount(): number {
    return this.proxies.length;
  }

  /**
   * Nearest clickable target along `ray` (zone frame, unit direction), or null (nothing, an occluder, or too far).
   * `angle` (rad, `pickAngle`) = the pick radius: a ray that misses but passes that close to a small product, in
   * front of what it does hit, picks the product (an exact product hit always wins). Behind a clickable target (a
   * shelf bar) the proxy may lie a little deeper (`proxySlack`), behind an occluder (a wall) not at all.
   */
  pick(ray: Ray, far = PICK_FAR_M, angle = 0): PickHit | null {
    if (!this.bvh) return null;
    const hit = this.bvh.raycastFirst(ray, DoubleSide, 0, far);
    const t = hit?.face ? (this.vertTarget[hit.face.a] ?? -1) : -1;
    const exact = t >= 0 ? this.entries[t]! : null;
    if (exact?.target.kind !== 'product' && angle > 0 && this.proxies.length) {
      const o = ray.origin;
      const d = ray.direction;
      // behind a wall (an occluder, t = −1) no depth slack: a thin wall never lets a pick through
      const p = chooseProxy([o.x, o.y, o.z], [d.x, d.y, d.z], this.proxies, angle, hit ? hit.distance : Infinity, far, proxySlack(t));
      if (p.index >= 0) return { target: this.entries[this.proxyOf[p.index]!]!.target, distance: p.distance };
    }
    if (!exact || !hit) return null;
    return { target: groupTarget(exact.target, hit.distance, this.cat), distance: hit.distance };
  }

  /** Meshes and world box to highlight for a target (a group: all its members). */
  look(t: PickTarget): { meshes: Mesh[]; box: Box3 } | null {
    const direct = this.byKey.get(t.key);
    if (direct) return direct;
    let g = this.groups.get(t.key);
    if (!g) {
      g = { meshes: [], box: new Box3() };
      for (const e of this.entries) {
        if (e.target.kind === 'object' && this.cat.objects.get(e.target.key)?.group === t.key) {
          g.meshes.push(...e.meshes);
          g.box.union(e.box);
        }
      }
      this.groups.set(t.key, g);
    }
    return g.meshes.length ? g : null;
  }

  /** Every target that counts for discovery is reachable? (debug: ids that count but are not in the drawn twin) */
  missing(discoverable: readonly string[] = this.cat.discoverable): string[] {
    const have = new Set<string>();
    for (const e of this.entries) {
      have.add(discoveryId(e.target));
      const g = e.target.kind === 'object' ? this.cat.objects.get(e.target.key)?.group : undefined;
      if (g) have.add(g);
    }
    return discoverable.filter((id) => !have.has(id));
  }

  dispose(): void {
    this.bvh?.geometry.dispose();
    this.bvh = null;
    this.entries = [];
    this.proxies = [];
    this.proxyOf = [];
    this.byKey.clear();
    this.groups.clear();
    this.vertTarget = new Int32Array(0);
  }
}

// ---- highlight ---------------------------------------------------------------------------------------------

// Offset along the screen-space normal; where the normal looks along the view ray (the back of a flat panel on a
// wall: no screen-space normal) along the direction away from the target's centre on screen instead.
const OUTLINE_VS = /* glsl */ `
uniform float uWidth;
uniform vec2 uRes;
uniform vec3 uCentre;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  vec3 nv = normalize( normalMatrix * normal );
  vec2 nc = ( projectionMatrix * vec4( nv, 0.0 ) ).xy;
  float l = length( nc );
  vec4 cc = projectionMatrix * viewMatrix * vec4( uCentre, 1.0 );
  vec2 rd = ( clip.xy / clip.w - cc.xy / max( cc.w, 1e-4 ) ) * uRes;
  float rl = length( rd );
  vec2 dir = l > 1e-5 ? nc / l : vec2( 0.0 );
  vec2 rad = rl > 1e-3 ? rd / rl : vec2( 0.0 );
  vec2 sum = mix( rad, dir, smoothstep( 0.1, 0.45, l ) );
  float sl = length( sum );
  if ( sl > 1e-5 ) clip.xy += ( sum / sl ) * uWidth * 2.0 / uRes * clip.w;
  gl_Position = clip;
}`;
const FRAME_VS = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
const OUTLINE_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uAmt;
uniform float uAlpha;
void main() { gl_FragColor = vec4( uColor, uAlpha * uAmt ); }`;
const RIM_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vN = normalize( normalMatrix * normal );
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const RIM_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uAmt;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) );
  gl_FragColor = vec4( uColor * ( 0.16 + 0.7 * f * f ) * uAmt, 1.0 );
}`;

interface Lifted {
  mesh: Mesh;
  /** Local matrix before the lift. */
  local: Matrix4;
  /** parentWorld⁻¹ and parentWorld · local (static scene). */
  parentInv: Matrix4;
  world: Matrix4;
  autoUpdate: boolean;
  overlays: Mesh[];
}

export class TwinHighlight {
  readonly outline: ShaderMaterial;
  readonly ink: ShaderMaterial;
  readonly rim: ShaderMaterial;
  /** Picture frame of flat targets: warm band, ink edge outside it. */
  readonly frameWarm: ShaderMaterial;
  readonly frameInk: ShaderMaterial;
  private readonly cache = new WeakMap<Mesh, Lifted>();
  /** Frame meshes per target, keyed by its first mesh (empty: not flat). */
  private readonly frames = new WeakMap<Mesh, Mesh[]>();
  private frameOn: Mesh[] = [];
  private active: Lifted[] = [];
  private key: string | null = null;
  private amt = 0;
  private readonly pivot = new Vector3();
  private readonly m1 = new Matrix4();
  private readonly m2 = new Matrix4();
  private readonly res = new Vector2();
  /** Shared `uCentre` uniform of the hulls: the highlighted target's box centre (zone frame). */
  private readonly centre = { value: new Vector3() };

  constructor(private readonly renderer: WebGLRenderer) {
    const color = { value: new Vector3(...HIGHLIGHT_SRGB) };
    const res = { value: new Vector2(1, 1) };
    const hull = (c: Vector3, alpha: number) =>
      new ShaderMaterial({
        uniforms: { uColor: { value: c }, uAmt: { value: 0 }, uAlpha: { value: alpha }, uWidth: { value: 3 }, uRes: res, uCentre: this.centre },
        vertexShader: OUTLINE_VS,
        fragmentShader: OUTLINE_FS,
        side: BackSide,
        transparent: true,
        depthWrite: false,
        // a hull face in the plane of the wall behind it (the mural's back) must not z-fight with the wall
        polygonOffset: true,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: -4,
      });
    this.ink = hull(new Vector3(...INK_SRGB), 0.45);
    this.outline = hull(color.value, 1);
    const flat = (c: Vector3, alpha: number) =>
      new ShaderMaterial({
        uniforms: { uColor: { value: c }, uAmt: { value: 0 }, uAlpha: { value: alpha } },
        vertexShader: FRAME_VS,
        fragmentShader: OUTLINE_FS,
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
      });
    this.frameInk = flat(new Vector3(...INK_SRGB), 0.7);
    this.frameWarm = flat(color.value, 1);
    this.rim = new ShaderMaterial({
      uniforms: { uColor: color, uAmt: { value: 0 } },
      vertexShader: RIM_VS,
      fragmentShader: RIM_FS,
      side: FrontSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthFunc: LessEqualDepth,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
  }

  /** Highlighted target key (null = none). */
  get current(): string | null {
    return this.key;
  }

  /** Highlight `meshes` (one target; foot of `box` = scale pivot), or clear with null. */
  set(key: string | null, look: { meshes: Mesh[]; box: Box3 } | null): void {
    if (key === this.key) return;
    this.clear();
    if (!key || !look) return;
    this.key = key;
    this.amt = 0;
    this.frameOn = this.framesFor(look.meshes);
    for (const f of this.frameOn) f.visible = true;
    const flatTarget = this.frameOn.length > 0;
    look.box.getCenter(this.pivot);
    this.centre.value.copy(this.pivot);
    this.pivot.y = look.box.min.y;
    for (const mesh of look.meshes) {
      let l = this.cache.get(mesh);
      if (!l) {
        mesh.updateMatrix();
        const parentWorld = mesh.parent ? mesh.parent.matrixWorld : new Matrix4();
        const overlays: Mesh[] = [];
        if (mesh.geometry.attributes.normal) {
          for (const [mat, order] of [[this.ink, 2], [this.outline, 3], [this.rim, 4]] as const) {
            const o = new Mesh(mesh.geometry, mat);
            o.userData.sleOverlay = true;
            o.raycast = () => {};
            o.renderOrder = order;
            o.visible = false;
            mesh.add(o);
            overlays.push(o);
          }
        }
        l = {
          mesh,
          local: mesh.matrix.clone(),
          parentInv: parentWorld.clone().invert(),
          world: parentWorld.clone().multiply(mesh.matrix),
          autoUpdate: mesh.matrixAutoUpdate,
          overlays,
        };
        this.cache.set(mesh, l);
      }
      l.mesh.matrixAutoUpdate = false;
      // flat targets: the frame replaces the hull outline (only the rim glow stays)
      for (const o of l.overlays) o.visible = !flatTarget || o.material === this.rim;
      this.active.push(l);
    }
    this.apply();
  }

  clear(): void {
    for (const l of this.active) {
      l.mesh.matrix.copy(l.local);
      l.mesh.matrixAutoUpdate = l.autoUpdate;
      l.mesh.matrixWorldNeedsUpdate = true;
      for (const o of l.overlays) o.visible = false;
    }
    this.active.length = 0;
    for (const f of this.frameOn) f.visible = false;
    this.frameOn = [];
    this.key = null;
    this.amt = 0;
  }

  /** The picture frame(s) of a flat target (built once, world positions under the first mesh's parent), or []. */
  private framesFor(meshes: readonly Mesh[]): Mesh[] {
    const first = meshes[0];
    if (!first?.parent) return [];
    const have = this.frames.get(first);
    if (have) return have;
    const tris: [P3, P3, P3][] = [];
    const v = new Vector3();
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      const pos = m.geometry.attributes.position;
      if (!pos) continue;
      const idx = m.geometry.index;
      const n = idx ? idx.count : pos.count;
      const at = (i: number): P3 => {
        v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
        return [v.x, v.y, v.z];
      };
      for (let i = 0; i + 2 < n; i += 3) tris.push([at(i), at(i + 1), at(i + 2)]);
    }
    const p = flatPanel(tris);
    const out: Mesh[] = [];
    if (p) {
      const w = frameWidth(p.u1 - p.u0, p.v1 - p.v0);
      const parent = first.parent;
      const sides = p.twoSided ? [p.d1 + FRAME_LIFT_M, p.d0 - FRAME_LIFT_M] : [p.d1 + FRAME_LIFT_M];
      for (const d of sides) {
        for (const [mat, inset, width, order] of [
          [this.frameInk, FRAME_GAP_M + w, w * 0.45, 3],
          [this.frameWarm, FRAME_GAP_M, w, 4],
        ] as const) {
          const g = new BufferGeometry();
          g.setAttribute('position', new BufferAttribute(new Float32Array(frameRing(p, d, inset, width)), 3));
          const f = new Mesh(g, mat);
          f.userData.sleOverlay = true;
          f.raycast = () => {};
          f.renderOrder = order;
          f.frustumCulled = false;
          f.visible = false;
          // positions are world: undo the parent's world matrix
          f.matrixAutoUpdate = false;
          f.matrix.copy(parent.matrixWorld).invert();
          parent.add(f);
          out.push(f);
        }
      }
    }
    this.frames.set(first, out);
    return out;
  }

  /** Ease in (≈ 120 ms) and keep the outline width in pixels. */
  update(dt: number): void {
    if (!this.active.length) return;
    this.renderer.getDrawingBufferSize(this.res);
    (this.outline.uniforms.uRes!.value as Vector2).copy(this.res);
    const pr = this.renderer.getPixelRatio();
    this.outline.uniforms.uWidth!.value = OUTLINE_PX * pr;
    this.ink.uniforms.uWidth!.value = INK_PX * pr;
    if (this.amt >= 1) return;
    this.amt = Math.min(1, this.amt + (1 - this.amt) * (1 - Math.exp(-25 * Math.min(dt, 0.1))) + 0.02);
    this.apply();
  }

  private apply(): void {
    const a = this.amt;
    this.outline.uniforms.uAmt!.value = a;
    this.ink.uniforms.uAmt!.value = a;
    this.rim.uniforms.uAmt!.value = a;
    this.frameWarm.uniforms.uAmt!.value = a;
    this.frameInk.uniforms.uAmt!.value = a;
    // a panel on a wall does not lift off it
    const s = 1 + (this.frameOn.length ? 0 : LIFT * a);
    const p = this.pivot;
    // S_p = T(p) · S(s) · T(−p); local = parentInv · S_p · world
    this.m1.makeTranslation(-p.x, -p.y, -p.z);
    this.m2.makeScale(s, s, s).multiply(this.m1);
    this.m1.makeTranslation(p.x, p.y, p.z).multiply(this.m2);
    for (const l of this.active) {
      l.mesh.matrix.copy(l.parentInv).multiply(this.m1).multiply(l.world);
      l.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  dispose(): void {
    this.clear();
    this.outline.dispose();
    this.ink.dispose();
    this.rim.dispose();
    this.frameWarm.dispose();
    this.frameInk.dispose();
  }
}
