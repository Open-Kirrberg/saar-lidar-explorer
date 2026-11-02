import {
  Box3,
  BufferGeometry,
  Frustum,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Points,
  Sphere,
  StaticDrawUsage,
  Vector2,
} from 'three';
import type { PerspectiveCamera, ShaderMaterial, WebGLRenderer } from 'three';
import { pointTileOrigin, pointTileUrl } from '../data/manifest';
import type { ManifestPointClouds, PointCloudArea } from '../data/manifest';
import type { Terrain } from '../terrain/Terrain';
import { DEFAULT_LOD, RETRY, allocatePoints, distanceToBox, distanceToRect, planStreaming, pointSpacing, retryDelayMs, retryDue } from './lod';
import type { LodParams, LodTile, StreamTile } from './lod';
import { createPointMaterial, createPointUniforms } from './PointMaterial';
import type { PointUniforms } from './PointMaterial';
import { SLEP_WORDS, aglFromWord, decodeSlep } from './slep';
import type { SlepTile } from './slep';

/**
 * F16 point clouds: streams `sle-pts-v1` tiles around the camera and draws each as one THREE.Points
 * whose geometry is the raw tile body (interleaved u16, no CPU decode). Per frame (`update`):
 *  - streaming: tiles within `loadRadius` (horizontal) are fetched nearest first, ≤ `maxInFlight`
 *    at a time; tiles beyond `disposeRadius` are aborted / disposed (GPU + CPU); residency is also
 *    capped at `maxResidentPoints` (2 × draw budget, ≥ 2 M), evicting the farthest tiles first;
 *    failed tiles are retried with exponential backoff (`RETRY`: 2 s … 60 s, ≤ 6 tries);
 *  - LOD: visible tiles get a `drawRange` prefix from `allocatePoints` (distance-based wish,
 *    water-filled to the global budget); the per-tile point size follows the drawn spacing.
 * Bounding volumes are set by hand in world space with the displayed (exaggerated) heights.
 */

export interface PointCloudStats {
  resident: number;
  loading: number;
  failed: number;
  /** Points drawn this frame (Σ drawRange of visible tiles, before class/clip filtering). */
  drawn: number;
  /** Points resident on the GPU. */
  residentPoints: number;
  /** GPU bytes of resident tiles (10 B per point; the same again on the CPU while resident). */
  gpuBytes: number;
  /** Failed tiles that gave up (no more retries until the layer is switched off/on or reload). */
  gaveUp: number;
}

interface TileState {
  key: string;
  area: PointCloudArea;
  tx: number;
  ty: number;
  count: number;
  /** World rectangle (x east, z = −north). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  status: 'idle' | 'loading' | 'resident' | 'failed';
  abort?: AbortController;
  tile?: SlepTile;
  /** True height range of the tile's points (m). */
  hMin?: number;
  hMax?: number;
  points?: Points<BufferGeometry, ShaderMaterial>;
  drawn: number;
  /** Bumped on every load/release, so a stale fetch never installs points. */
  gen: number;
  /** Consecutive failed fetches and the earliest next try (performance.now() ms). */
  failures: number;
  retryAt: number;
}

export class PointCloudLayer extends Group {
  readonly uniforms: PointUniforms = createPointUniforms();
  readonly lod: LodParams = { ...DEFAULT_LOD };
  loadRadius = 1300;
  disposeRadius = 1500;
  maxInFlight = 4;
  /** Residency cap = max(this × draw budget, `minResidentPoints`); farthest tiles are evicted first. */
  residentFactor = 2;
  minResidentPoints = 2_000_000;
  readonly stats: PointCloudStats = { resident: 0, loading: 0, failed: 0, drawn: 0, residentPoints: 0, gpuBytes: 0, gaveUp: 0 };

  private readonly tiles: TileState[] = [];
  private readonly byKey = new Map<string, TileState>();
  private readonly listeners = new Set<() => void>();
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly box = new Box3();
  private lastExag = NaN;
  private lastHRef = NaN;

  constructor(
    readonly meta: ManifestPointClouds,
    private readonly terrain: Terrain,
    private readonly origin: { E0: number; N0: number },
    private readonly baseUrl: string,
  ) {
    super();
    this.name = 'PointClouds';
    const ts = meta.tileSize;
    for (const area of meta.areas) {
      for (const [tx, ty, count] of area.tiles) {
        const o = pointTileOrigin(area, ts, tx, ty);
        const key = `${area.id}/${tx}_${ty}`;
        const t: TileState = {
          key,
          area,
          tx,
          ty,
          count,
          minX: o.E - origin.E0,
          maxX: o.E + ts - origin.E0,
          minZ: -(o.N + ts - origin.N0),
          maxZ: -(o.N - origin.N0),
          status: 'idle',
          drawn: 0,
          gen: 0,
          failures: 0,
          retryAt: 0,
        };
        this.tiles.push(t);
        this.byKey.set(key, t);
      }
    }
  }

  /** Points allowed on the GPU (10 B each, plus the same on the CPU while the tile is resident). */
  get maxResidentPoints(): number {
    return Math.max(this.residentFactor * this.lod.budget, this.minResidentPoints);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Per frame (main camera). No-op while hidden. */
  update(camera: PerspectiveCamera, renderer: WebGLRenderer): void {
    if (!this.visible) return;
    const cam = camera.position;

    // --- streaming -----------------------------------------------------------------------------
    const near: StreamTile[] = [];
    const now = performance.now();
    for (const t of this.tiles) {
      const dist = distanceToRect(cam.x, cam.z, t.minX, t.maxX, t.minZ, t.maxZ);
      if (dist > this.disposeRadius && t.status !== 'resident' && t.status !== 'loading') continue;
      const failed = t.status === 'failed' && !retryDue(t.failures, t.retryAt, now);
      near.push({ key: t.key, dist, count: t.count, resident: t.status === 'resident', loading: t.status === 'loading', failed });
    }
    const slots = this.maxInFlight - this.stats.loading;
    const plan = planStreaming(near, this.loadRadius, this.disposeRadius, slots, this.maxResidentPoints);
    let changed = false;
    for (const k of plan.dispose) {
      this.release(this.byKey.get(k)!);
      changed = true;
    }
    for (const k of plan.load) {
      void this.load(this.byKey.get(k)!);
      changed = true;
    }

    // --- bounds (displayed heights) + LOD --------------------------------------------------------
    const exag = this.terrain.uniforms.uExag.value;
    const hRef = this.terrain.uniforms.uHRef.value;
    const boundsDirty = exag !== this.lastExag || hRef !== this.lastHRef;
    this.lastExag = exag;
    this.lastHRef = hRef;
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);

    const resident: TileState[] = [];
    const lodIn: LodTile[] = [];
    for (const t of this.tiles) {
      if (t.status !== 'resident' || !t.points) continue;
      const g = t.points.geometry;
      if (boundsDirty || !g.boundingBox) this.setBounds(t, exag, hRef);
      const b = g.boundingBox!;
      const visible = this.frustum.intersectsBox(b);
      const dist = distanceToBox(cam.x, cam.y, cam.z, { minX: b.min.x, minY: b.min.y, minZ: b.min.z, maxX: b.max.x, maxY: b.max.y, maxZ: b.max.z });
      resident.push(t);
      lodIn.push({ count: t.count, dist, visible });
    }
    const alloc = allocatePoints(lodIn, this.lod);
    let drawn = 0;
    resident.forEach((t, i) => {
      const n = alloc[i];
      t.drawn = n;
      drawn += n;
      const p = t.points!;
      p.visible = n > 0;
      p.geometry.setDrawRange(0, n);
      p.material.uniforms.uSpacing.value = pointSpacing(this.meta.tileSize, n);
    });
    this.stats.drawn = drawn;

    // Pixel scale: drawing-buffer px per metre at 1 m distance (gl_PointSize is in device px).
    const dbH = renderer.getDrawingBufferSize(_v2).y;
    this.uniforms.uPxScale.value = dbH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const pr = renderer.getPixelRatio();
    this.uniforms.uSizeClamp.value.set(1.5 * pr, 14 * pr);
    if (changed) this.emit();
  }

  private setBounds(t: TileState, exag: number, hRef: number): void {
    const g = t.points!.geometry;
    const y = (h: number) => hRef + (h - hRef) * exag;
    this.box.min.set(t.minX, y(t.hMin!), t.minZ);
    this.box.max.set(t.maxX, Math.max(y(t.hMax!), y(t.hMin!) + 0.01), t.maxZ);
    g.boundingBox = (g.boundingBox ?? new Box3()).copy(this.box);
    g.boundingSphere = this.box.getBoundingSphere(g.boundingSphere ?? new Sphere());
  }

  private async load(t: TileState): Promise<void> {
    t.status = 'loading';
    const gen = ++t.gen;
    const abort = new AbortController();
    t.abort = abort;
    this.recount();
    const stale = () => t.gen !== gen;
    try {
      const res = await fetch(pointTileUrl(this.baseUrl, t.area, t.tx, t.ty), { signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (stale()) return; // released meanwhile
      const tile = decodeSlep(buf);
      if (tile.count !== t.count) console.warn(`[pointcloud] ${t.key}: ${tile.count} points, manifest says ${t.count}`);
      let hw = 0;
      for (let k = 0; k < tile.count; k++) {
        const v = tile.words[k * SLEP_WORDS + 2];
        if (v > hw) hw = v;
      }
      t.tile = tile;
      t.count = tile.count;
      t.hMin = tile.hBase;
      t.hMax = tile.hBase + hw / 100;
      t.points = this.buildPoints(t, tile);
      this.setBounds(t, this.terrain.uniforms.uExag.value, this.terrain.uniforms.uHRef.value);
      t.status = 'resident';
      t.failures = 0;
      this.add(t.points);
    } catch (e) {
      if ((e as Error).name === 'AbortError' || stale()) return;
      t.failures++;
      t.retryAt = performance.now() + retryDelayMs(t.failures);
      const more = t.failures < RETRY.maxTries;
      console.warn(`[pointcloud] tile ${t.key} failed (${t.failures}×):`, (e as Error).message, more ? `– retry in ${retryDelayMs(t.failures) / 1000} s` : '– giving up');
      t.status = 'failed';
    } finally {
      if (!stale()) t.abort = undefined;
      this.recount();
      this.emit();
    }
  }

  private buildPoints(t: TileState, tile: SlepTile): Points<BufferGeometry, ShaderMaterial> {
    const g = new BufferGeometry();
    const ib = new InterleavedBuffer(tile.words, SLEP_WORDS).setUsage(StaticDrawUsage);
    g.setAttribute('position', new InterleavedBufferAttribute(ib, 3, 0, false));
    g.setAttribute('aMisc', new InterleavedBufferAttribute(ib, 2, 3, false));
    g.setDrawRange(0, 0);
    const mat = createPointMaterial(this.terrain.uniforms, this.uniforms);
    const o = pointTileOrigin(t.area, this.meta.tileSize, t.tx, t.ty);
    // Tile origin in float64 → local frame; only the small local values reach float32.
    mat.uniforms.uTile.value.set(o.E - this.origin.E0, tile.hBase, -(o.N - this.origin.N0));
    const p = new Points(g, mat);
    p.name = `pts ${t.key}`;
    p.matrixAutoUpdate = false; // identity: the shader places points in world space
    p.raycast = () => {}; // CPU geometry is raw integers; picking uses the terrain
    p.visible = false;
    return p;
  }

  private release(t: TileState): void {
    t.gen++;
    t.abort?.abort();
    t.abort = undefined;
    if (t.points) {
      this.remove(t.points);
      t.points.geometry.dispose();
      t.points.material.dispose();
    }
    t.points = undefined;
    t.tile = undefined;
    t.drawn = 0;
    if (t.status !== 'failed') t.status = 'idle';
    this.recount();
  }

  /** Free everything (layer switched off); fetches restart from the HTTP cache later, failed tiles get fresh tries. */
  clearAll(): void {
    for (const t of this.tiles) {
      this.release(t);
      if (t.status === 'failed') {
        t.status = 'idle';
        t.failures = 0;
        t.retryAt = 0;
      }
    }
    this.stats.drawn = 0;
    this.emit();
  }

  private recount(): void {
    let resident = 0;
    let loading = 0;
    let failed = 0;
    let gaveUp = 0;
    let pts = 0;
    for (const t of this.tiles) {
      if (t.status === 'resident') {
        resident++;
        pts += t.count;
      } else if (t.status === 'loading') loading++;
      else if (t.status === 'failed') {
        failed++;
        if (t.failures >= RETRY.maxTries) gaveUp++;
      }
    }
    Object.assign(this.stats, { resident, loading, failed, gaveUp, residentPoints: pts, gpuBytes: pts * SLEP_WORDS * 2 });
  }

  /** Area whose bbox is nearest to the world point (x, z) (0 inside). */
  nearestArea(x: number, z: number): { area: PointCloudArea; dist: number } | null {
    let best: { area: PointCloudArea; dist: number } | null = null;
    for (const a of this.meta.areas) {
      const [e0, n0, e1, n1] = a.bbox;
      const { E0, N0 } = this.origin;
      const d = distanceToRect(x, z, e0 - E0, e1 - E0, -(n1 - N0), -(n0 - N0));
      if (!best || d < best.dist) best = { area: a, dist: d };
    }
    return best;
  }

  /**
   * Verification: for up to `maxPerTile` records of each resident tile, compare
   *  (a) the stored `agl` with h − terrain.heightAt (true heights) and
   *  (b) ground points (class 2): h − heightAt (alignment with the app's DTM).
   * Returns absolute-deviation percentiles (m).
   */
  groundCheck(maxPerTile = 2000): { tiles: number; aglDiff: Percentiles; groundDev: Percentiles; groundSigned: number } {
    const aglDiff: number[] = [];
    const ground: number[] = [];
    let signed = 0;
    let tiles = 0;
    for (const t of this.tiles) {
      if (!t.tile) continue;
      tiles++;
      const w = t.tile.words;
      const step = Math.max(1, Math.floor(t.tile.count / maxPerTile));
      const x0 = t.minX;
      const z0 = t.maxZ;
      for (let k = 0; k < t.tile.count; k += step) {
        const o = k * SLEP_WORDS;
        const x = x0 + w[o] / 100;
        const z = z0 - w[o + 1] / 100;
        const h = t.tile.hBase + w[o + 2] / 100;
        const dtm = this.terrain.heightAt(x, z);
        if (!Number.isFinite(dtm)) continue;
        aglDiff.push(Math.abs(h - dtm - aglFromWord(w[o + 3]) / 100));
        if ((w[o + 4] & 0xff) === 2) {
          ground.push(Math.abs(h - dtm));
          signed += h - dtm;
        }
      }
    }
    return { tiles, aglDiff: percentiles(aglDiff), groundDev: percentiles(ground), groundSigned: ground.length ? signed / ground.length : NaN };
  }

  dispose(): void {
    this.clearAll();
    this.listeners.clear();
  }
}

export interface Percentiles {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

function percentiles(v: number[]): Percentiles {
  if (!v.length) return { n: 0, p50: NaN, p95: NaN, max: NaN };
  const s = Float64Array.from(v).sort();
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
  return { n: s.length, p50: at(0.5), p95: at(0.95), max: s[s.length - 1] };
}

const _v2 = new Vector2();
