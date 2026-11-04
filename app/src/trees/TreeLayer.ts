import {
  BufferAttribute,
  Group,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Sphere,
  Vector3,
} from 'three';
import type { Camera, ShaderMaterial } from 'three';
import { chunkRects, planChunks, rectDistance } from '../buildings/select';
import type { ChunkRect } from '../buildings/select';
import { chunkUrl } from '../data/manifest';
import type { Manifest } from '../data/manifest';
import type { SharedTerrainUniforms } from '../terrain/TerrainMaterial';
import {
  CROWN_SCALE_MAX,
  TREE_LODS,
  bandRange,
  boxDistance,
  boxFarDistance,
  displayY,
  lodBand,
  lodParams,
  prefixCount,
  rankThreshold,
  treeDensity,
} from './lod';
import type { TreeLod, TreeLodParams } from './lod';
import { bandVector, createTreeMaterial, createTreeUniforms, setLodUniform } from './TreeMaterial';
import type { TreeUniforms } from './TreeMaterial';
import { TREE_SHAPES, latheArrays } from './treeShapes';
import type { LatheArrays } from './treeShapes';
import { TREE_STRIDE, buildInstanceRows, decodeTrees, gatherRows, rowBounds, treeChunkRef } from './treeData';
import type { ManifestTrees, RowBounds } from './treeData';

/**
 * V2.4: CHM trees streamed per level-0 chunk (`trees/{i}_{j}.bin`, contract "Trees").
 *
 * - Streaming: the same pure distance planner as the LoD2 buildings (`planChunks`: nearest first,
 *   ≤ maxInFlight, hysteresis band, failed chunks never retried). Files are ≤ 37 kB, GPU rows
 *   32 B/tree, so they stay outside the terrain's texture budget (reported in `stats`).
 * - Drawing: per resident chunk a **mid** and a **far** instanced mesh over the chunk's rows,
 *   `instanceCount` = rank prefix for the chunk's nearest point (records are fmix32-ordered); one
 *   **near** mesh over rows gathered within the near radius. Every mesh reads identical rows, the
 *   shader picks/cross-fades per tree (TreeMaterial.ts, lod.ts).
 * - Quality: the vegetation radius follows `terrain.streaming.canopyDistance` (quality presets).
 */

export interface TreeTerrain {
  readonly manifest: Manifest;
  readonly baseUrl: string;
  readonly uniforms: SharedTerrainUniforms;
  readonly streaming: { canopyDistance: number };
}

export interface TreeStats {
  listed: number;
  resident: number;
  loading: number;
  failed: number;
  pending: number;
  /** Trees in resident chunks. */
  trees: number;
  /** Instances submitted this frame per mesh kind (before the per-tree shader cull). */
  instances: Record<TreeLod, number>;
  /** Draw calls submitted this frame (before three's frustum culling). */
  meshes: number;
  /** Triangles submitted (instances × shape triangles). */
  triangles: number;
  gpuBytes: number;
  params: TreeLodParams;
}

interface ChunkEntry {
  rect: ChunkRect;
  rows: Float32Array;
  rank: Float32Array;
  bounds: RowBounds;
  buffer: InstancedInterleavedBuffer;
  mid: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  far: Mesh<InstancedBufferGeometry, ShaderMaterial>;
}

const LOAD_MARGIN = 150;
const GATHER_STEP = 12;
const _sphereCenter = new Vector3();

export class TreeLayer extends Group {
  readonly treeUniforms: TreeUniforms;
  readonly materials: Record<TreeLod, ShaderMaterial>;
  private readonly lathes: Record<TreeLod, LatheArrays>;
  private readonly rects: ChunkRect[];
  private readonly rectByKey = new Map<string, ChunkRect>();
  private readonly resident = new Map<string, ChunkEntry>();
  private readonly loading = new Set<string>();
  private readonly failed = new Set<string>();
  private generation = 0;
  private pending = 0;
  private camX = NaN;
  private camZ = NaN;
  private params: TreeLodParams;
  private vegetation = NaN;
  private readonly listeners = new Set<() => void>();
  // near mesh (gathered rows)
  private nearRows: Float32Array = new Float32Array(4096 * TREE_STRIDE);
  private nearCount = 0;
  private nearMesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private nearX = NaN;
  private nearZ = NaN;
  private nearDirty = true;
  private frameStats = { instances: { near: 0, mid: 0, far: 0 } as Record<TreeLod, number>, meshes: 0, triangles: 0 };

  constructor(
    readonly trees: ManifestTrees,
    private readonly terrain: TreeTerrain,
    readonly maxInFlight = 4,
  ) {
    super();
    this.name = 'TreeLayer';
    this.matrixAutoUpdate = false;
    const m = terrain.manifest;
    this.rects = chunkRects(
      trees.chunks.map(([i, j]) => [i, j] as const),
      { chunkSize: m.chunkSize, cellSize: m.cellSize, extentZ: m.size.height * m.cellSize },
      15, // crowns reach over the chunk edge
    );
    for (const r of this.rects) this.rectByKey.set(r.key, r);
    this.params = lodParams(terrain.streaming.canopyDistance);
    this.treeUniforms = createTreeUniforms();
    setLodUniform(this.treeUniforms, this.params);
    this.lathes = {
      near: latheArrays(TREE_SHAPES.near.sides, TREE_SHAPES.near.profiles[0].length, TREE_SHAPES.near.trunkSides),
      mid: latheArrays(TREE_SHAPES.mid.sides, TREE_SHAPES.mid.profiles[0].length, TREE_SHAPES.mid.trunkSides),
      far: latheArrays(TREE_SHAPES.far.sides, TREE_SHAPES.far.profiles[0].length, TREE_SHAPES.far.trunkSides),
    };
    const mat = (lod: TreeLod) => createTreeMaterial(terrain.uniforms, this.treeUniforms, TREE_SHAPES[lod], lodBand(lod, this.params), `TreeMaterial.${lod}`);
    this.materials = { near: mat('near'), mid: mat('mid'), far: mat('far') };
    this.nearMesh = this.makeMesh('near', new InstancedInterleavedBuffer(this.nearRows, TREE_STRIDE, 1));
    this.nearMesh.frustumCulled = false; // always around the camera
    this.nearMesh.visible = false;
    this.nearMesh.name = 'trees near';
    this.add(this.nearMesh);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get lodParams(): TreeLodParams {
    return this.params;
  }

  stats(): TreeStats {
    let trees = 0;
    for (const e of this.resident.values()) trees += e.rank.length;
    return {
      listed: this.rects.length,
      resident: this.resident.size,
      loading: this.loading.size,
      failed: this.failed.size,
      pending: this.pending,
      trees,
      instances: { ...this.frameStats.instances },
      meshes: this.frameStats.meshes,
      triangles: this.frameStats.triangles,
      gpuBytes: (trees + this.nearRows.length / TREE_STRIDE) * TREE_STRIDE * 4,
      params: this.params,
    };
  }

  /** Per frame (before render): stream, then per-chunk instance counts and visibility. */
  update(camera: Camera, dt: number): void {
    this.treeUniforms.uTime.value = (this.treeUniforms.uTime.value + dt) % 3600;
    if (!this.visible) return;
    this.syncQuality();
    const cam = camera.position;
    this.camX = cam.x;
    this.camZ = cam.z;
    const p = this.params;
    const plan = planChunks({
      rects: this.rects,
      x: cam.x,
      z: cam.z,
      resident: new Set(this.resident.keys()),
      loading: this.loading,
      failed: this.failed,
      loadRadius: p.max + LOAD_MARGIN,
      dropRadius: p.max * 1.25 + 300,
      maxInFlight: this.maxInFlight,
    });
    const changed = plan.pending !== this.pending || plan.drop.length > 0;
    this.pending = plan.pending;
    for (const key of plan.drop) if (this.resident.has(key)) this.disposeChunk(key);
    for (const key of plan.load) void this.load(key);
    if (changed) this.emit();

    const u = this.terrain.uniforms;
    const exag = u.uExag.value;
    const hRef = u.uHRef.value;
    const sink = 1 + this.treeUniforms.uLod.value.w * p.max;
    const midR = bandRange(lodBand('mid', p), p);
    const farR = bandRange(lodBand('far', p), p);
    const st = this.frameStats;
    st.instances.mid = st.instances.far = 0;
    st.meshes = 0;
    let tris = 0;
    for (const e of this.resident.values()) {
      const b = e.bounds;
      const reach = b.rMax * 1.1 * CROWN_SCALE_MAX + 1; // seed scale, far crown scale, wind
      const box = {
        xMin: b.xMin - reach,
        xMax: b.xMax + reach,
        yMin: displayY(b.gMin, hRef, exag) - sink,
        yMax: displayY(b.gMax, hRef, exag) + b.hMax,
        zMin: b.zMin - reach,
        zMax: b.zMax + reach,
      };
      const dMin = boxDistance(cam.x, cam.y, cam.z, box);
      const dMax = boxFarDistance(cam.x, cam.y, cam.z, box);
      const n = prefixCount(e.rank, rankThreshold(treeDensity(dMin, p), p));
      e.mid.visible = n > 0 && dMin < midR[1] && dMax > midR[0];
      e.far.visible = n > 0 && dMin < farR[1] && dMax > farR[0];
      e.mid.geometry.instanceCount = e.far.geometry.instanceCount = n;
      // Culling sphere in displayed coordinates (exaggeration changes move it).
      _sphereCenter.set((box.xMin + box.xMax) / 2, (box.yMin + box.yMax) / 2, (box.zMin + box.zMax) / 2);
      const radius = Math.hypot(box.xMax - box.xMin, box.yMax - box.yMin, box.zMax - box.zMin) / 2;
      for (const mesh of [e.mid, e.far]) {
        mesh.geometry.boundingSphere!.set(_sphereCenter, radius);
        if (!mesh.visible) continue;
        st.meshes++;
        const lod = mesh === e.mid ? 'mid' : 'far';
        st.instances[lod] += n;
        tris += n * this.lathes[lod].triangles;
      }
    }
    this.updateNear(cam.x, cam.z);
    st.instances.near = this.nearCount;
    if (this.nearCount > 0) {
      st.meshes++;
      tris += this.nearCount * this.lathes.near.triangles;
    }
    st.triangles = tris;
  }

  /** Free everything (layer off for good). In-flight fetches are discarded on arrival. */
  clearAll(): void {
    this.generation++;
    for (const key of [...this.resident.keys()]) this.disposeChunk(key);
    this.loading.clear();
    this.pending = 0;
    this.nearCount = 0;
    this.nearMesh.geometry.instanceCount = 0;
    this.nearDirty = true;
    this.emit();
  }

  dispose(): void {
    this.clearAll();
    this.nearMesh.geometry.dispose();
    for (const lod of TREE_LODS) this.materials[lod].dispose();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------------------------

  /** Quality preset → LOD distances (vegetation radius = terrain canopyDistance). */
  private syncQuality(): void {
    const veg = this.terrain.streaming.canopyDistance;
    if (veg === this.vegetation) return;
    this.vegetation = veg;
    this.params = lodParams(veg);
    setLodUniform(this.treeUniforms, this.params);
    for (const lod of TREE_LODS) bandVector(lodBand(lod, this.params), this.materials[lod].uniforms.uBands.value);
    this.nearDirty = true;
  }

  private makeMesh(lod: TreeLod, buffer: InstancedInterleavedBuffer): Mesh<InstancedBufferGeometry, ShaderMaterial> {
    const l = this.lathes[lod];
    const g = new InstancedBufferGeometry();
    // Own small copies of the shape attributes per geometry: disposing one geometry frees its GL
    // buffers, and shared attribute objects would leave other VAOs pointing at deleted buffers.
    g.setIndex(new BufferAttribute(l.index, 1));
    g.setAttribute('position', new BufferAttribute(l.position, 3));
    g.setAttribute('aBand', new BufferAttribute(l.band, 1));
    g.setAttribute('iA', new InterleavedBufferAttribute(buffer, 4, 0));
    g.setAttribute('iB', new InterleavedBufferAttribute(buffer, 4, 4));
    g.instanceCount = 0;
    g.boundingSphere = new Sphere(new Vector3(), 1);
    const mesh = new Mesh(g, this.materials[lod]);
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {}; // picking stays on Terrain.raycast
    mesh.renderOrder = 1;
    return mesh;
  }

  private updateNear(cx: number, cz: number): void {
    const p = this.params;
    const moved = Math.hypot(cx - this.nearX, cz - this.nearZ);
    if (!this.nearDirty && moved < GATHER_STEP) return;
    this.nearDirty = false;
    this.nearX = cx;
    this.nearZ = cz;
    const radius = p.near[1] + GATHER_STEP + 2;
    const sources: Float32Array[] = [];
    for (const e of this.resident.values()) if (rectDistance(e.rect, cx, cz) <= radius) sources.push(e.rows);
    const before = this.nearRows;
    const res = gatherRows(sources, cx, cz, radius, this.nearRows);
    this.nearCount = res.count;
    if (res.rows !== before) {
      // Grew: new buffer + geometry (the old one is disposed with its own attribute copies).
      this.nearRows = res.rows;
      const old = this.nearMesh;
      this.nearMesh = this.makeMesh('near', new InstancedInterleavedBuffer(this.nearRows, TREE_STRIDE, 1));
      this.nearMesh.frustumCulled = false;
      this.nearMesh.name = 'trees near';
      this.remove(old);
      old.geometry.dispose();
      this.add(this.nearMesh);
    } else {
      const ib = (this.nearMesh.geometry.getAttribute('iA') as InterleavedBufferAttribute).data as InstancedInterleavedBuffer;
      ib.clearUpdateRanges();
      ib.addUpdateRange(0, Math.max(1, res.count) * TREE_STRIDE);
      ib.needsUpdate = true;
    }
    this.nearMesh.geometry.instanceCount = res.count;
    this.nearMesh.visible = res.count > 0;
  }

  private async load(key: string): Promise<void> {
    const rect = this.rectByKey.get(key);
    if (!rect || this.loading.has(key) || this.resident.has(key)) return;
    const gen = this.generation;
    this.loading.add(key);
    let entry: ChunkEntry | null = null;
    try {
      const m = this.terrain.manifest;
      const res = await fetch(chunkUrl(this.terrain.baseUrl, this.trees.path, rect.i, rect.j));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const decoded = decodeTrees(await res.arrayBuffer(), treeChunkRef(m, rect.i, rect.j));
      if (gen === this.generation) entry = this.buildEntry(rect, decoded.rank, buildInstanceRows(decoded, m.origin));
    } catch (err) {
      if (gen === this.generation) {
        this.failed.add(key); // 404 / bad header: skip this chunk, never retried (contract tolerance)
        console.warn(`[trees] chunk ${key}:`, err instanceof Error ? err.message : err);
      }
    }
    if (gen !== this.generation) {
      if (entry) disposeEntry(entry);
      return;
    }
    this.loading.delete(key);
    if (entry) {
      const far = rectDistance(rect, this.camX, this.camZ) > this.params.max * 1.25 + 300; // NaN → false
      if (far) disposeEntry(entry);
      else {
        this.resident.set(key, entry);
        this.add(entry.mid, entry.far);
        this.nearDirty = true;
      }
    }
    this.emit();
  }

  private buildEntry(rect: ChunkRect, rank: Float32Array, rows: Float32Array): ChunkEntry {
    const buffer = new InstancedInterleavedBuffer(rows, TREE_STRIDE, 1);
    const mid = this.makeMesh('mid', buffer);
    const far = this.makeMesh('far', buffer);
    mid.name = `trees mid ${rect.key}`;
    far.name = `trees far ${rect.key}`;
    mid.visible = far.visible = false;
    return { rect, rows, rank, bounds: rowBounds(rows), buffer, mid, far };
  }

  private disposeChunk(key: string): void {
    const e = this.resident.get(key);
    if (!e) return;
    this.resident.delete(key);
    this.remove(e.mid, e.far);
    disposeEntry(e);
    this.nearDirty = true;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Mid and far share the instance buffer: dispose both together (no VAO keeps a freed buffer). */
function disposeEntry(e: ChunkEntry): void {
  e.mid.geometry.dispose();
  e.far.geometry.dispose();
}
