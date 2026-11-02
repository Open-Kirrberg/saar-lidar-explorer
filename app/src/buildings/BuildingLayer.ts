import { BufferAttribute, Box3, Group, Matrix4, Mesh, Sphere } from 'three';
import type { BufferGeometry, Camera, ShaderMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SURFACE_ATTRIBUTE, chunkUrl } from '../data/manifest';
import type { BuildingModels } from '../data/manifest';
import type { Terrain } from '../terrain/Terrain';
import { createBuildingMaterial } from './BuildingMaterial';
import { chunkRects, classifySurfaceByNormal, displayHeight, planChunks, rectDistance } from './select';
import type { ChunkRect } from './select';

/**
 * F11: LoD2 building meshes streamed per level-0 chunk by distance (contract "Models").
 * glbs within `loadRadius` of the camera are fetched (≤ `maxInFlight` at once, nearest first);
 * meshes beyond `dropRadius` are disposed (hysteresis band in between). Positions carry true
 * heights; the shared-uniform material applies the exaggeration in the vertex shader. Meshes don't
 * raycast (CPU positions are not exaggerated) — picking stays on `Terrain.raycast`.
 */

export interface BuildingLayerOptions {
  loadRadius: number;
  dropRadius: number;
  /** Distance fade (screen-door) [start, end] in metres from the camera; end < loadRadius. */
  fade: [number, number];
  maxInFlight: number;
  /** Rect growth for distance tests (buildings poke over chunk edges). */
  margin: number;
}

export const DEFAULT_BUILDING_OPTIONS: BuildingLayerOptions = {
  loadRadius: 2000,
  dropRadius: 2600,
  fade: [1500, 1950],
  maxInFlight: 3,
  margin: 60,
};

interface ChunkEntry {
  rect: ChunkRect;
  group: Group;
  meshes: Mesh<BufferGeometry, ShaderMaterial>[];
  boundsKey: string;
  triangles: number;
}

export interface BuildingStats {
  listed: number;
  resident: number;
  loading: number;
  failed: number;
  /** Chunks within the load radius not resident yet. */
  pending: number;
  triangles: number;
}

const _box = new Box3();
const _identity = new Matrix4();

export class BuildingLayer extends Group {
  readonly material: ShaderMaterial;
  private readonly rects: ChunkRect[];
  private readonly rectByKey = new Map<string, ChunkRect>();
  private readonly resident = new Map<string, ChunkEntry>();
  private readonly loading = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly loader = new GLTFLoader();
  private generation = 0;
  private pending = 0;
  private readonly listeners = new Set<() => void>();
  /** Camera x/z of the last update (arrival check for in-flight chunks). */
  private camX = NaN;
  private camZ = NaN;

  constructor(
    private readonly models: BuildingModels,
    private readonly terrain: Terrain,
    private readonly baseUrl: string,
    readonly opts: BuildingLayerOptions = DEFAULT_BUILDING_OPTIONS,
  ) {
    super();
    this.name = 'BuildingLayer';
    this.matrixAutoUpdate = false;
    const m = terrain.manifest;
    this.rects = chunkRects(models.chunks, { chunkSize: m.chunkSize, cellSize: m.cellSize, extentZ: m.size.height * m.cellSize }, opts.margin);
    for (const r of this.rects) this.rectByKey.set(r.key, r);
    this.material = createBuildingMaterial(terrain.uniforms, opts.fade);
  }

  /** Called whenever chunks arrive/leave (panel status). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get stats(): BuildingStats {
    let triangles = 0;
    for (const e of this.resident.values()) triangles += e.triangles;
    return {
      listed: this.rects.length,
      resident: this.resident.size,
      loading: this.loading.size,
      failed: this.failed.size,
      pending: this.pending,
      triangles,
    };
  }

  /** Per frame (before render): stream chunks around the camera, keep bounds in sync with exaggeration. */
  update(camera: Camera): void {
    if (!this.visible) return;
    const cam = camera.position;
    this.camX = cam.x;
    this.camZ = cam.z;
    const plan = planChunks({
      rects: this.rects,
      x: cam.x,
      z: cam.z,
      resident: new Set(this.resident.keys()),
      loading: this.loading,
      failed: this.failed,
      loadRadius: this.opts.loadRadius,
      dropRadius: this.opts.dropRadius,
      maxInFlight: this.opts.maxInFlight,
    });
    const changed = plan.pending !== this.pending || plan.drop.length > 0;
    this.pending = plan.pending;
    for (const key of plan.drop) {
      if (this.resident.has(key)) this.disposeChunk(key);
      // In-flight chunks beyond dropRadius are discarded on arrival (see load()).
    }
    for (const key of plan.load) void this.load(key);
    if (changed) this.emit();

    const u = this.terrain.uniforms;
    const exag = u.uExag.value;
    const hRef = u.uHRef.value;
    const boundsKey = `${exag}|${hRef}`;
    for (const e of this.resident.values()) {
      if (e.boundsKey === boundsKey) continue;
      e.boundsKey = boundsKey;
      for (const mesh of e.meshes) {
        const bb = mesh.geometry.boundingBox!;
        _box.min.set(bb.min.x, displayHeight(bb.min.y, hRef, exag), bb.min.z);
        _box.max.set(bb.max.x, displayHeight(bb.max.y, hRef, exag), bb.max.z);
        _box.getBoundingSphere(mesh.geometry.boundingSphere!);
      }
    }
  }

  /** Hide and free everything (layer off). In-flight fetches are discarded on arrival. */
  clearAll(): void {
    this.generation++;
    for (const key of [...this.resident.keys()]) this.disposeChunk(key);
    this.loading.clear();
    this.pending = 0;
    this.emit();
  }

  private async load(key: string): Promise<void> {
    const rect = this.rectByKey.get(key);
    if (!rect || this.loading.has(key) || this.resident.has(key)) return;
    const gen = this.generation;
    this.loading.add(key);
    let entry: ChunkEntry | null = null;
    try {
      const gltf = await this.loader.loadAsync(chunkUrl(this.baseUrl, this.models.path, rect.i, rect.j));
      entry = this.buildEntry(rect, gltf.scene);
    } catch (err) {
      if (gen === this.generation) {
        this.failed.add(key); // 404 / parse error: hide this chunk's buildings, don't retry
        console.warn(`[buildings] chunk ${key}:`, err instanceof Error ? err.message : err);
      }
    }
    if (gen !== this.generation) {
      if (entry) disposeEntry(entry);
      return; // layer was cleared meanwhile (its `loading` set was reset)
    }
    this.loading.delete(key);
    if (entry) {
      const far = rectDistance(rect, this.camX, this.camZ) > this.opts.dropRadius; // NaN → false
      if (far || !this.visible) disposeEntry(entry);
      else {
        this.resident.set(key, entry);
        this.add(entry.group);
      }
    }
    this.emit();
  }

  private buildEntry(rect: ChunkRect, root: Group): ChunkEntry {
    root.updateMatrixWorld(true);
    const group = new Group();
    group.name = `buildings ${rect.key}`;
    group.matrixAutoUpdate = false;
    const meshes: ChunkEntry['meshes'] = [];
    let triangles = 0;
    root.traverse((o) => {
      const src = o as Mesh;
      if (!src.isMesh) return;
      const g = src.geometry;
      // Contract: nodes carry no transforms; bake one in if a producer adds it anyway.
      if (!src.matrixWorld.equals(_identity)) g.applyMatrix4(src.matrixWorld);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      ensureSurface(g);
      for (const m of Array.isArray(src.material) ? src.material : [src.material]) m.dispose(); // ignored per contract
      g.computeBoundingBox();
      g.boundingSphere = new Sphere();
      g.boundingBox!.getBoundingSphere(g.boundingSphere);
      triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const mesh = new Mesh(g, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.raycast = () => {}; // CPU positions are not exaggerated; picking goes through Terrain.raycast
      mesh.renderOrder = 2;
      meshes.push(mesh);
      group.add(mesh);
    });
    return { rect, group, meshes, boundsKey: '', triangles };
  }

  private disposeChunk(key: string): void {
    const e = this.resident.get(key);
    if (!e) return;
    this.resident.delete(key);
    this.remove(e.group);
    disposeEntry(e);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  dispose(): void {
    this.clearAll();
    this.material.dispose();
    this.listeners.clear();
  }
}

function disposeEntry(e: ChunkEntry): void {
  for (const m of e.meshes) m.geometry.dispose();
  e.meshes.length = 0;
  e.group.clear();
}

/**
 * Make sure the geometry has a non-normalised `_surface` attribute (0 ground, 1 wall, 2 roof).
 * glTF UNSIGNED_BYTE may arrive normalised (→ 2/255 in the shader) — the values are class ids.
 * Missing → classify from the normals.
 */
function ensureSurface(g: BufferGeometry): void {
  const a = g.getAttribute(SURFACE_ATTRIBUTE);
  if (a) {
    a.normalized = false;
    return;
  }
  const n = g.getAttribute('normal');
  const count = g.getAttribute('position').count;
  const flat = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    flat[k * 3] = n.getX(k);
    flat[k * 3 + 1] = n.getY(k);
    flat[k * 3 + 2] = n.getZ(k);
  }
  g.setAttribute(SURFACE_ATTRIBUTE, new BufferAttribute(classifySurfaceByNormal(flat), 1));
}
