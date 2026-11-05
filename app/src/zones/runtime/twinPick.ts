/**
 * Built twins (ADR 0042): what can be clicked, and the hover / tap highlight (docs/style.md „Interaction look“).
 *
 * `TwinTargets` merges the drawn twin into one BVH (zone frame) whose vertices carry a target index: −1 = an
 * occluder (walls, floor, enclosing targets), else a clickable target (a product slot or a catalogue object,
 * `catalogue.ts` `resolveTarget`). One `raycastFirst` per pick finds the nearest opaque surface; glass is left
 * out, so products behind display glass stay pickable and walls still block. Built once per drawn LOD.
 *
 * `TwinHighlight` draws the hovered target with a warm outline (inverted hull, constant pixel width) and a rim
 * glow (additive fresnel) in `messing` lightened by 30 %, and lifts it by 2 % (scale about its foot). Both work on
 * the twin's unlit + COLOR_0 materials, which they never touch. No allocations per frame.
 */
import { AdditiveBlending, BackSide, Box3, BufferAttribute, BufferGeometry, DoubleSide, FrontSide, LessEqualDepth, Matrix4, Mesh, ShaderMaterial, Vector2, Vector3 } from 'three';
import type { Material, Object3D, Ray, WebGLRenderer } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { discoveryId, groupTarget, isEnclosing, resolveTarget } from '../catalogue';
import type { NodeExtras, PickTarget, ZoneCatalogue } from '../catalogue';

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

  /** Nearest clickable target along `ray` (zone frame), or null (nothing, an occluder, or too far). */
  pick(ray: Ray, far = PICK_FAR_M): PickHit | null {
    const hit = this.bvh?.raycastFirst(ray, DoubleSide, 0, far);
    if (!hit?.face) return null;
    const t = this.vertTarget[hit.face.a] ?? -1;
    if (t < 0) return null;
    return { target: groupTarget(this.entries[t]!.target, hit.distance, this.cat), distance: hit.distance };
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

  /** Every target that counts for discovery is reachable? (debug: ids in the catalogue but not in the twin) */
  missing(): string[] {
    const have = new Set<string>();
    for (const e of this.entries) {
      have.add(discoveryId(e.target));
      const g = e.target.kind === 'object' ? this.cat.objects.get(e.target.key)?.group : undefined;
      if (g) have.add(g);
    }
    return this.cat.discoverable.filter((id) => !have.has(id));
  }

  dispose(): void {
    this.bvh?.geometry.dispose();
    this.bvh = null;
    this.entries = [];
    this.byKey.clear();
    this.groups.clear();
    this.vertTarget = new Int32Array(0);
  }
}

// ---- highlight ---------------------------------------------------------------------------------------------

const OUTLINE_VS = /* glsl */ `
uniform float uWidth;
uniform vec2 uRes;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  vec3 nv = normalize( normalMatrix * normal );
  vec2 nc = ( projectionMatrix * vec4( nv, 0.0 ) ).xy;
  float l = length( nc );
  if ( l > 1e-5 ) clip.xy += ( nc / l ) * uWidth * 2.0 / uRes * clip.w;
  gl_Position = clip;
}`;
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
  private readonly cache = new WeakMap<Mesh, Lifted>();
  private active: Lifted[] = [];
  private key: string | null = null;
  private amt = 0;
  private readonly pivot = new Vector3();
  private readonly m1 = new Matrix4();
  private readonly m2 = new Matrix4();
  private readonly res = new Vector2();

  constructor(private readonly renderer: WebGLRenderer) {
    const color = { value: new Vector3(...HIGHLIGHT_SRGB) };
    const res = { value: new Vector2(1, 1) };
    const hull = (c: Vector3, alpha: number) =>
      new ShaderMaterial({
        uniforms: { uColor: { value: c }, uAmt: { value: 0 }, uAlpha: { value: alpha }, uWidth: { value: 3 }, uRes: res },
        vertexShader: OUTLINE_VS,
        fragmentShader: OUTLINE_FS,
        side: BackSide,
        transparent: true,
        depthWrite: false,
      });
    this.ink = hull(new Vector3(...INK_SRGB), 0.45);
    this.outline = hull(color.value, 1);
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
    look.box.getCenter(this.pivot);
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
      for (const o of l.overlays) o.visible = true;
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
    this.key = null;
    this.amt = 0;
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
    const s = 1 + LIFT * a;
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
  }
}
