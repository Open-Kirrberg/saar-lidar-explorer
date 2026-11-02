import { Box3, BufferAttribute, Float32BufferAttribute, Group, Matrix4, Mesh, Ray, Raycaster, Sphere } from 'three';
import type { BufferGeometry, Camera, Intersection, Object3D, ShaderMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { displayHeight } from '../buildings/select';
import type { Terrain } from '../terrain/Terrain';
import { CONF_CODE, aoiExtentInModel, modelOffset, partShownOnAoi } from './recon';
import type { ReconBuilding, ReconIndex, XZBounds } from './recon';
import { createReconDepthMaterial, createReconMaterial, createReconUniforms } from './ReconMaterial';
import type { ReconUniforms } from './ReconMaterial';

/**
 * F19: the light reconstruction model (one glb, one node per building) placed into the current
 * AOI. Positions keep TRUE heights; the shared-uniform material applies the exaggeration. Loaded
 * lazily on first `load()` (layer switched on); `unload()` frees GPU memory.
 *
 * Ghost mode (opacity < 1): a depth-only pre-pass (opaque list, after the terrain) followed by the
 * blended colour pass with depth test "≤", so only the front-most surface is seen over the ruins.
 */

export type ReconColorMode = 'material' | 'confidence';
export type ReconLoadState = 'idle' | 'loading' | 'ready' | 'failed';

export interface ReconPick {
  /** Building id (node name) or `site:<id>`. */
  id: string;
  building: ReconBuilding | null;
  /** Displayed world point of the hit. */
  point: { x: number; y: number; z: number };
  distance: number;
}

interface Part {
  id: string;
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
  prepass: Mesh<BufferGeometry, ShaderMaterial>;
  /** Bounding sphere at true heights (picking); the geometry's own sphere follows the exaggeration. */
  trueSphere: Sphere;
}

/** Stone grey (linear) when a producer omits COLOR_0. */
const DEFAULT_LINEAR_COLOR = [0.55, 0.52, 0.47] as const;
const RENDER_ORDER_PREPASS = 10;
const RENDER_ORDER_COLOR = 11;

const _box = new Box3();
const _identity = new Matrix4();

export class ReconLayer extends Group {
  readonly uniforms: ReconUniforms;
  readonly material: ShaderMaterial;
  readonly selectedMaterial: ShaderMaterial;
  readonly depthMaterial: ShaderMaterial;
  private readonly byId: Map<string, ReconBuilding>;
  private parts: Part[] = [];
  private boundsKey = '';
  private selectedId: string | null = null;
  private loadPromise: Promise<void> | null = null;
  private generation = 0;
  private _state: ReconLoadState = 'idle';
  private _triangles = 0;
  private readonly listeners = new Set<() => void>();
  private readonly raycaster = new Raycaster();
  /** AOI terrain extent in layer-local x/z (the model frame): parts beyond it would hang in the void. */
  private readonly extent: XZBounds;

  constructor(
    readonly index: ReconIndex,
    terrain: Terrain,
    /** URL of the dataset folder (ending in '/'). */
    private readonly baseUrl: string,
  ) {
    super();
    this.name = 'ReconLayer';
    const off = modelOffset(index.origin, terrain.manifest.origin);
    this.position.set(off.x, off.y, off.z);
    this.updateMatrix();
    this.matrixAutoUpdate = false;
    const m = terrain.manifest;
    // AOI world frame: x ∈ [0, w], z ∈ [−h, 0] (origin = SW corner); layer-local = world − offset.
    this.extent = aoiExtentInModel(index.origin, { origin: m.origin, width: m.size.width * m.cellSize, height: m.size.height * m.cellSize });
    this.uniforms = createReconUniforms(terrain.uniforms);
    this.material = createReconMaterial(this.uniforms);
    this.selectedMaterial = createReconMaterial(this.uniforms, true);
    this.depthMaterial = createReconDepthMaterial(this.uniforms);
    this.byId = new Map(index.buildings.map((b) => [b.id, b]));
  }

  get state(): ReconLoadState {
    return this._state;
  }

  get stats(): { parts: number; triangles: number } {
    return { parts: this.parts.length, triangles: this._triangles };
  }

  /** Whether the node `id` is shown on this AOI's terrain; null while not loaded or for an unknown id. */
  partShown(id: string): boolean | null {
    let found = false;
    for (const p of this.parts) {
      if (p.id !== id) continue;
      if (p.mesh.visible) return true;
      found = true;
    }
    return found ? false : null;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setColorMode(mode: ReconColorMode): void {
    this.uniforms.uMode.value = mode === 'confidence' ? 1 : 0;
  }

  /** 1 = solid; < 1 = ghost (blended front surface over the terrain). */
  setOpacity(v: number): void {
    const o = Math.max(0.05, Math.min(1, v));
    this.uniforms.uOpacity.value = o;
    const ghost = o < 0.999;
    for (const m of [this.material, this.selectedMaterial]) {
      if (m.transparent !== ghost) {
        m.transparent = ghost;
        m.depthWrite = !ghost;
        m.needsUpdate = true;
      }
    }
    for (const p of this.parts) p.prepass.visible = ghost && p.mesh.visible;
  }

  get ghost(): boolean {
    return this.material.transparent;
  }

  /** Fetch + build the model once (subsequent calls return the same promise until unload()). */
  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    const gen = ++this.generation;
    this._state = 'loading';
    this.emit();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.loadPromise = loader
      .loadAsync(this.baseUrl + this.index.files.model)
      .then((gltf) => {
        if (gen !== this.generation) {
          disposeTree(gltf.scene);
          return;
        }
        this.build(gltf.scene, rawNodeName(gltf.parser));
        this._state = 'ready';
        this.emit();
      })
      .catch((err: unknown) => {
        if (gen !== this.generation) return;
        this._state = 'failed';
        console.warn('[reconstruction] model not loaded:', err instanceof Error ? err.message : err);
        this.emit();
      });
    return this.loadPromise;
  }

  /** Free all GPU memory (layer off). A later load() fetches again (HTTP cache). */
  unload(): void {
    this.generation++;
    this.loadPromise = null;
    for (const p of this.parts) {
      p.mesh.geometry.dispose();
      this.remove(p.mesh, p.prepass);
    }
    this.parts = [];
    this._triangles = 0;
    this.boundsKey = '';
    this._state = 'idle';
    this.emit();
  }

  /** Per frame (before render): keep bounding spheres in sync with the exaggeration (culling). */
  update(_camera: Camera): void {
    if (!this.visible || this.parts.length === 0) return;
    const exag = this.uniforms.uExag.value as number;
    const hRef = this.uniforms.uHRef.value as number;
    const key = `${exag}|${hRef}`;
    if (key === this.boundsKey) return;
    this.boundsKey = key;
    for (const p of this.parts) {
      const bb = p.mesh.geometry.boundingBox!;
      _box.min.set(bb.min.x, displayHeight(bb.min.y, hRef, exag), bb.min.z);
      _box.max.set(bb.max.x, displayHeight(bb.max.y, hRef, exag), bb.max.z);
      _box.getBoundingSphere(p.mesh.geometry.boundingSphere!);
    }
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const p of this.parts) p.mesh.material = p.id === id ? this.selectedMaterial : this.material;
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /** Building (or site feature) hit by a DISPLAYED world ray, nearest first; null if none. */
  pick(ray: Ray): ReconPick | null {
    if (!this.visible || this.parts.length === 0) return null;
    const exag = this.uniforms.uExag.value as number;
    const hRef = this.uniforms.uHRef.value as number;
    // Display → true heights is affine in y (scale 1/exag about hRef): transform the ray instead of
    // the geometry. Order along the ray is preserved, so the nearest true hit is the nearest shown.
    const r = this.raycaster.ray;
    r.origin.set(ray.origin.x, hRef + (ray.origin.y - hRef) / exag, ray.origin.z);
    r.direction.set(ray.direction.x, ray.direction.y / exag, ray.direction.z).normalize();
    this.raycaster.near = 0;
    this.raycaster.far = Infinity;
    let best: { part: Part; hit: Intersection } | null = null;
    for (const p of this.parts) {
      if (!p.mesh.visible) continue; // outside this AOI's terrain
      const g = p.mesh.geometry;
      const shown = g.boundingSphere!;
      g.boundingSphere = p.trueSphere; // Mesh.raycast tests the sphere first
      const hits: Intersection[] = [];
      try {
        p.mesh.raycast(this.raycaster, hits);
      } finally {
        g.boundingSphere = shown;
      }
      for (const h of hits) if (!best || h.distance < best.hit.distance) best = { part: p, hit: h };
    }
    if (!best) return null;
    const pt = best.hit.point;
    const y = displayHeight(pt.y, hRef, exag);
    return {
      id: best.part.id,
      building: this.byId.get(best.part.id) ?? null,
      point: { x: pt.x, y, z: pt.z },
      distance: Math.hypot(pt.x - ray.origin.x, y - ray.origin.y, pt.z - ray.origin.z),
    };
  }

  private build(root: Group, rawName: (o: Object3D) => string | undefined): void {
    root.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    let tris = 0;
    for (const src of meshes) {
      const id = nodeId(src, root, rawName);
      const g = src.geometry;
      prepareGeometry(g, src.matrixWorld, this.confFor(id));
      for (const m of Array.isArray(src.material) ? src.material : [src.material]) m.dispose(); // ignored per contract
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const mesh = new Mesh(g, this.material);
      mesh.name = id;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = RENDER_ORDER_COLOR;
      const prepass = new Mesh(g, this.depthMaterial);
      prepass.name = `${id} (depth)`;
      prepass.matrixAutoUpdate = false;
      prepass.renderOrder = RENDER_ORDER_PREPASS;
      prepass.visible = this.ghost;
      prepass.raycast = () => {};
      // Buildings must lie fully on this AOI's terrain (else they float past its edge, e.g. the
      // Karlslust pavilions south of AOI karlsberg); site features only need to touch it.
      const bb = g.boundingBox!;
      const inside = partShownOnAoi(id, { x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z }, this.extent);
      if (!inside) {
        mesh.visible = false;
        prepass.visible = false;
      }
      this.parts.push({ id, mesh, prepass, trueSphere: g.boundingSphere!.clone() });
      this.add(prepass, mesh);
    }
    this._triangles = Math.round(tris);
    this.boundsKey = '';
    if (this.selectedId) this.select(this.selectedId);
    this.updateMatrixWorld(true);
  }

  /** `_CONF` fallback value for a node (index.json confidence; `site:`/unknown → low). */
  private confFor(id: string): number {
    const b = this.byId.get(id);
    return b ? CONF_CODE[b.confidence] : CONF_CODE.low;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  dispose(): void {
    this.unload();
    this.material.dispose();
    this.selectedMaterial.dispose();
    this.depthMaterial.dispose();
    this.listeners.clear();
  }
}

/**
 * The glTF node name as written (GLTFLoader sanitises `Object3D.name`: `site:wall` → `sitewall`),
 * via the parser's object → node-index associations.
 */
function rawNodeName(parser: GLTFParser): (o: Object3D) => string | undefined {
  const nodes = (parser.json as { nodes?: Array<{ name?: unknown }> }).nodes ?? [];
  return (o) => {
    const idx = parser.associations.get(o)?.nodes;
    const name = idx === undefined ? undefined : nodes[idx]?.name;
    return typeof name === 'string' && name ? name : undefined;
  };
}

/** Nearest ancestor that is a named glTF node (a multi-primitive node is a Group of meshes). */
function nodeId(o: Object3D, root: Object3D, rawName: (o: Object3D) => string | undefined): string {
  for (let n: Object3D | null = o; n && n !== root; n = n.parent) {
    const name = rawName(n) ?? n.name;
    if (name) return name;
  }
  return o.uuid;
}

/**
 * Normalise a loaded geometry to the layer's needs: float positions/normals with any node
 * transform (e.g. from quantization) baked in, `color` (linear RGB) and a non-normalised `_conf`.
 */
export function prepareGeometry(g: BufferGeometry, matrix: Matrix4, confFallback: number): void {
  const pos = g.getAttribute('position');
  const count = pos.count;
  if (!matrix.equals(_identity)) {
    g.setAttribute('position', toFloat(pos, 3));
    const n = g.getAttribute('normal');
    if (n) g.setAttribute('normal', toFloat(n, 3));
    g.applyMatrix4(matrix);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('color')) {
    const c = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) c.set(DEFAULT_LINEAR_COLOR, k * 3);
    g.setAttribute('color', new BufferAttribute(c, 3));
  }
  const conf = g.getAttribute('_conf');
  if (conf) conf.normalized = false; // class ids, not fractions
  else g.setAttribute('_conf', new BufferAttribute(new Uint8Array(count).fill(confFallback), 1));
  g.computeBoundingBox();
  g.boundingSphere = new Sphere();
  g.boundingBox!.getBoundingSphere(g.boundingSphere);
}

/** Copy any (interleaved / normalised / integer) attribute into a plain Float32 one. */
function toFloat(a: BufferGeometry['attributes'][string], itemSize: number): Float32BufferAttribute {
  const out = new Float32Array(a.count * itemSize);
  for (let k = 0; k < a.count; k++) {
    out[k * itemSize] = a.getX(k);
    if (itemSize > 1) out[k * itemSize + 1] = a.getY(k);
    if (itemSize > 2) out[k * itemSize + 2] = a.getZ(k);
  }
  return new Float32BufferAttribute(out, itemSize);
}

function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
  });
}
