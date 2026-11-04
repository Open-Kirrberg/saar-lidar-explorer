import {
  Box3,
  Color,
  FloatType,
  Frustum,
  Group,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { BufferGeometry, Camera, Intersection, Ray, Raycaster, WebGLRenderer } from 'three';
import type { DecodePool } from '../data/DecodePool';
import type { GridSpec } from '../data/grid';
import { cellToWorld, heightImageSize } from '../data/grid';
import { assembleRegion, clampOutside, lowpassWindow } from '../data/lowpassRegion';
import type { ImageLayerSource, LayerSource, Manifest, ManifestLevel } from '../data/manifest';
import { chunkUrl } from '../data/manifest';
import { adaptThreshold, clampBudget, DEFAULT_BUDGET, MiB, planEviction } from './budget';
import type { LruEntry } from './budget';
import { HeightQuery, LevelHeights, raycastHeightField } from './HeightQuery';
import { createGridGeometry } from './gridGeometry';
import type { AoiExtent, NodeId } from './levels';
import {
  aoiPixelMax,
  distanceToBox,
  levelGridSpec,
  nodeKey,
  nodeRect,
  pixelSpacingFor,
  pixelSpacings,
  projectionFactor,
  rootNodes,
} from './levels';
import { composeImageApron, opposite, patchImageApron, SIDE_BIT, SIDE_OFFSET, SIDES } from './imageApron';
import { imageTiers, resampleStrip, resizeTarget, screenPxPerMetre, tierFor } from './imageRes';
import type { Side } from './imageApron';
import { APRON_NEIGHBOURS, buildLayerApron } from './layerApron';
import { selectNodes } from './quadtree';
import { BLDG_KEY, TerrainChunk } from './TerrainChunk';
import { createSharedUniforms } from './TerrainMaterial';
import type { SharedTerrainUniforms } from './TerrainMaterial';
import {
  availableModes,
  BlendMode,
  Colormap,
  defaultColormap,
  defaultStretch,
  imageModes,
  isLiveKey,
  LIVE_SOURCES,
  ShaderSource,
} from './relief';
import type { ChannelSettings, ModeEntry, OverlaySettings, Stretch } from './relief';

/** Live (shader-computed) display keys; any other display key is a manifest layer key. */
export const LIVE_MODES = LIVE_SOURCES;
export type LiveModeKey = keyof typeof LIVE_MODES;

/** Store colormap names (legacy `AppState.colormap`); 'auto' = per-mode setting. */
export type ColormapName = 'auto' | 'gray' | 'diverging' | 'viridis';

export type ForestMode = 'off' | 'transparent' | 'full';

export interface ForestSettings {
  mode: ForestMode;
  /** Opacity in 'transparent' mode. */
  opacity: number;
}

export interface LodSettings {
  /** Vertex spacings in metres per mesh LOD (converted to pixels per level; coarse levels clamp to their cell size). */
  spacings: number[];
  /** Upper distance (m) for each level except the last. */
  distances: number[];
}

/** Streaming knobs (F9). Mutable at runtime (window.sle.terrain.streaming). */
export interface StreamingSettings {
  /** Screen-space error (px at a 1080 px high view) above which a level is refined. */
  pixelError: number;
  /** Soft GPU budget for chunk textures in bytes (clamped to < 1.4 GiB). */
  budget: number;
  /** Concurrent fetch/decode/low-pass jobs. */
  maxInFlight: number;
  /** Error multiplier for chunks outside the view (coarser off-screen). */
  offscreenScale: number;
  /** DSM (canopy) is streamed for drawn level-0 chunks closer than this (m). */
  canopyDistance: number;
  /**
   * `rgb` image textures (ortho, historic maps) are decoded per chunk at the smallest tier
   * (P₀, P₀/2, P₀/4 …) giving ≥ imageDetail texels per CSS pixel at the chunk's nearest point
   * (imageRes.ts). 1 = default; Infinity = always native size (pre-perf-pass behaviour).
   */
  imageDetail: number;
}

export interface StreamStats {
  /** Per level: resident chunks / drawn chunks. */
  levels: Array<{ level: number; cellSize: number; resident: number; drawn: number }>;
  /** Estimated GPU MiB of resident chunk textures. */
  gpuMB: number;
  /** … of those the selection keeps (drawn, ancestors, wanted) — what the budget logic compares. */
  keptMB: number;
  /** … of resident `rgb` image textures. */
  imageMB: number;
  /** Budget pressure factor on image detail (1 = by need; < 1 = images downgraded before the mesh coarsens). */
  imageScale: number;
  budgetMB: number;
  /** Jobs waiting / running, and their sum. */
  queue: number;
  inFlight: number;
  pending: number;
  /** Effective refinement threshold (px; > pixelError when the budget forced coarser levels). */
  pixelError: number;
  evicted: number;
  failed: number;
}

export interface TerrainLoadProgress {
  loaded: number;
  total: number;
  failed: number;
}

/** Raw physical values from the value pass (NaN = no data / sky). */
export interface ValueSample {
  base: Float32Array;
  overlay: Float32Array | null;
}

export type ValueScope = 'view' | 'aoi';

/**
 * Relikt-Blick lens channel (V2.5, ADR 0035): what slot C shows. `key` = live key, u8 layer or
 * `rgb` image; colormap/stretch/shade default to the key's channel defaults. The mix itself is the
 * shared uniform `uLensMix` (animated by the lens, no state here).
 */
export interface LensChannel {
  key: string;
  colormap?: Colormap;
  stretch?: Stretch;
  shade?: number;
  /** Colour multiplier (r, g, b), default white. */
  tint?: [number, number, number];
}

const LIVE_SRC: Record<string, number> = {
  'live-hillshade': ShaderSource.Hillshade,
  'live-slope': ShaderSource.Slope,
  'live-lrm': ShaderSource.LocalRelief,
};

/** Stand-in shader source for a layer missing on a coarse level (1 = live slope, −1 = none/hillshade). */
const LAYER_ALT: Record<string, number> = { slope: 1 };

interface Job {
  id: string;
  priority: number;
  run: () => Promise<void>;
}

const _box = new Box3();
const _frustum = new Frustum();
const _m = new Matrix4();
const _cam = new Vector3();
/** Neighbour offsets for the low-pass apron mask. */
const NEIGHBOURS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * The terrain of one AOI as a streamed chunk pyramid (F9). Owns shared uniforms (channels, sun,
 * exaggeration …), quadtree selection over `manifest.levels` (coarsest level first, children
 * replace their parent only when all are ready), a priority job queue on the DecodePool, LRU
 * eviction under a GPU budget, per-level relief layers with fallbacks, per-chunk low-pass for
 * live local relief, the canopy (DSM, level 0 near the camera) and the value pass for automatic
 * contrast. A v1 manifest is a single level: all its chunks are roots (loaded at start, pinned).
 */
export class Terrain extends Group {
  /** Level-0 grid (1 m). */
  readonly grid: GridSpec;
  readonly levels: readonly ManifestLevel[];
  readonly levelGrids: readonly GridSpec[];
  readonly aoi: AoiExtent;
  /** Heights from the finest resident level (`heights.heightAt`). */
  readonly heights: LevelHeights;
  /** DSM heights (level-0 chunks whose canopy is resident). */
  readonly canopyHeights: HeightQuery;
  readonly uniforms: SharedTerrainUniforms;
  /** Resident chunks of all levels, key `${level}/${i}_${j}`. */
  readonly chunks = new Map<string, TerrainChunk>();
  readonly lod: LodSettings;
  readonly streaming: StreamingSettings = {
    pixelError: 1,
    budget: DEFAULT_BUDGET,
    maxInFlight: 6,
    offscreenScale: 0.5,
    canopyDistance: 2000,
    imageDetail: 1,
  };
  /** Holds the canopy meshes (child of the terrain, rendered after it). */
  readonly canopyGroup = new Group();
  readonly forest: ForestSettings = { mode: 'off', opacity: 0.6 };
  private readonly geometries = new Map<number, BufferGeometry>();
  private readonly allowedSpacings: number[];
  private readonly skirtSpacings: number[];
  private display = 'live-hillshade';
  /** Per display key: colormap / stretch / shade the user last chose. */
  private readonly channelMemory = new Map<string, ChannelSettings>();
  private overlay: OverlaySettings;
  /** Lens slot C key (null = no lens layer wanted; textures already resident stay cached). */
  private lensKey: string | null = null;
  /** 0 = canopy as set by `forest`, 1 = hidden by the lens (V2.5). */
  private canopyLensFade = 0;
  private readonly listeners = new Set<() => void>();
  private lowpassRadius = 15;
  /** DTM chunks that failed (not retried until reload). */
  private readonly failed = new Set<string>();
  /** DSM chunks that failed to load (not retried). */
  private readonly canopyFailed = new Set<string>();
  private valueTarget: WebGLRenderTarget | null = null;
  // ---- streaming state
  private pending: Job[] = [];
  /**
   * Jobs a caller awaits (ensureLayer / ensureCanopy): merged back into every schedule() until
   * they ran, so a per-frame queue replacement cannot drop them and hang the waiter.
   */
  private readonly forced = new Map<string, Job>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private waiters: Array<{ pred: () => boolean; resolve: () => void }> = [];
  private drawn: TerrainChunk[] = [];
  private active = new Set<string>();
  private frame = 0;
  private effError = 1;
  /** Budget pressure on image detail (halved/doubled with a cooldown, see update()). */
  private imageScale = 1;
  private imageScaleFrame = 0;
  private keptBytes = 0;
  private evictedCount = 0;
  private readonly nodeCache = new Map<string, { d: number; v: boolean }>();
  stats = { visible: 0, triangles: 0, canopyVisible: 0 };
  /** Anisotropic filtering for `rgb` image textures (set from renderer.capabilities.getMaxAnisotropy()). */
  imageAnisotropy = 8;
  private _renderer: WebGLRenderer | null = null;
  private readonly onContextRestored = () => this.dropImageLayers();

  /** Renderer for GPU-side image apron patches (seam fix); without it image aprons stay clamped. */
  get renderer(): WebGLRenderer | null {
    return this._renderer;
  }

  /**
   * Setting it also listens for `webglcontextrestored`: image textures keep no CPU copy after their
   * first upload (TerrainChunk.addImage), so a restored context would re-upload 1×1 canvases —
   * instead every image layer is dropped and streamed again.
   */
  set renderer(r: WebGLRenderer | null) {
    this._renderer?.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this._renderer = r;
    r?.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  /** Dispose every resident `rgb` image layer on all chunks; the streaming loop fetches them again. */
  dropImageLayers(): number {
    let n = 0;
    for (const c of this.chunks.values()) {
      for (const k of c.layerKeys()) {
        if (!this.isImageKey(k)) continue;
        c.removeLayer(k);
        n++;
      }
    }
    return n;
  }

  constructor(
    readonly manifest: Manifest,
    readonly baseUrl: string,
    private readonly pool: DecodePool,
  ) {
    super();
    this.name = 'Terrain';
    const apron = manifest.height.dtm.apron ?? 1;
    const cs0 = manifest.cellSize ?? 1;
    this.aoi = { width: manifest.size.width * cs0, height: manifest.size.height * cs0 };
    this.levels = manifest.levels?.length ? manifest.levels : [
      {
        level: 0,
        cellSize: cs0,
        chunkSize: manifest.chunkSize,
        size: manifest.size,
        chunks: manifest.chunks,
        height: manifest.height,
        layers: manifest.layers,
        imageLayers: manifest.imageLayers ?? {},
      },
    ];
    this.levelGrids = this.levels.map((lv) => levelGridSpec(lv, lv.height.dtm.apron ?? apron, this.aoi));
    this.grid = this.levelGrids[0];
    this.heights = new LevelHeights(this.levelGrids.map((g, k) => new HeightQuery(g, this.levels[k].chunks.nx, this.levels[k].chunks.ny)));
    this.canopyHeights = new HeightQuery(this.grid, manifest.chunks.nx, manifest.chunks.ny);
    this.uniforms = createSharedUniforms(manifest.heightRange.min, manifest.chunkSize);
    const cs = manifest.chunkSize;
    this.allowedSpacings = pixelSpacings(cs);
    const pick = (want: number[]) => want.filter((s) => cs % s === 0);
    this.lod = { spacings: pick([1, 2, 4, 10, 20]), distances: [180, 600, 1400, 4000] };
    // Skirts must also close seams towards neighbours drawn from up to 4 levels coarser.
    this.skirtSpacings = [...new Set([...this.lod.spacings, 2, 4, 8, 16].filter((s) => s < cs))].sort((a, b) => a - b);
    this.overlay = { key: '', opacity: 0.5, blend: BlendMode.Multiply, ...this.freshChannel('slrm') };
    this.canopyGroup.name = 'Canopy';
    this.canopyGroup.visible = false;
    this.add(this.canopyGroup);
  }

  /** Called whenever display/overlay/forest settings change (UI refresh). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ---- loading / streaming -----------------------------------------------------------------

  /**
   * Load the coarsest level (it covers the whole AOI; for a v1 manifest: all chunks), nearest to
   * (cx, cz) first. Resolves when every root settled; finer levels then stream in `update()`.
   * Failed chunks are reported but do not reject.
   */
  async load(cx: number, cz: number, onProgress?: (p: TerrainLoadProgress) => void): Promise<TerrainLoadProgress> {
    const roots = rootNodes(this.levels);
    const progress: TerrainLoadProgress = { loaded: 0, total: roots.length, failed: 0 };
    const count = () => {
      progress.loaded = roots.filter((r) => this.chunks.has(nodeKey(r.level, r.i, r.j))).length;
      progress.failed = roots.filter((r) => this.failed.has(nodeKey(r.level, r.i, r.j))).length;
    };
    onProgress?.(progress);
    const jobs = roots.map((r) => {
      const rc = nodeRect(this.levels[r.level], r.i, r.j, this.aoi);
      const d = Math.hypot(Math.max(rc.x0 - cx, 0, cx - rc.x1), Math.max(rc.z0 - cz, 0, cz - rc.z1));
      return this.dtmJob(r, d);
    });
    this.schedule(jobs);
    await this.waitFor(() => {
      const before = progress.loaded + progress.failed;
      count();
      if (progress.loaded + progress.failed !== before) onProgress?.(progress);
      return progress.loaded + progress.failed >= progress.total;
    });
    this.emit();
    return progress;
  }

  /** Resolves once `pred()` holds (checked after every job). */
  private waitFor(pred: () => boolean): Promise<void> {
    if (pred()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ pred, resolve }));
  }

  private checkWaiters(): void {
    if (this.waiters.length === 0) return;
    this.waiters = this.waiters.filter((w) => {
      if (!w.pred()) return true;
      w.resolve();
      return false;
    });
  }

  /** Replace the waiting queue (deduplicated, skipping running jobs) and start jobs. */
  private schedule(jobs: Job[]): void {
    const seen = new Set<string>();
    const q: Job[] = [];
    for (const j of this.forced.values()) jobs.push(j);
    for (const j of jobs.sort((a, b) => a.priority - b.priority)) {
      if (seen.has(j.id) || this.inFlight.has(j.id)) continue;
      seen.add(j.id);
      q.push(j);
    }
    this.pending = q;
    this.pump();
  }

  private pump(): void {
    while (this.inFlight.size < this.streaming.maxInFlight && this.pending.length > 0) {
      const job = this.pending.shift()!;
      if (this.inFlight.has(job.id)) continue;
      const p = job
        .run()
        .catch((err: unknown) => console.warn(`[terrain] ${job.id}: ${String(err)}`))
        .finally(() => {
          this.inFlight.delete(job.id);
          this.forced.delete(job.id);
          this.checkWaiters();
          this.pump();
        });
      this.inFlight.set(job.id, p);
    }
  }

  private layerSource(level: number, key: string | null): LayerSource | undefined {
    return key ? this.levels[level]?.layers[key] : undefined;
  }

  /** `rgb` image layer `key` at `level` (F13/F14), if that level carries it. */
  private imageSource(level: number, key: string | null): ImageLayerSource | undefined {
    return key ? this.levels[level]?.imageLayers?.[key] : undefined;
  }

  /** Does `level` carry display layer `key` (u8 or image)? */
  private hasSource(level: number, key: string | null): boolean {
    return !!(this.layerSource(level, key) || this.imageSource(level, key));
  }

  /** Same-level neighbour (di, dj) of `c`'s u8 layer `key`, if resident. */
  private neighbourLayer(c: TerrainChunk, key: string): (di: number, dj: number) => Uint8Array | undefined {
    return (di, dj) => this.chunks.get(nodeKey(c.level, c.i + di, c.j + dj))?.layerData(key);
  }

  /**
   * Install u8 layer `key` on `c` with a 1-texel apron from resident same-level neighbours, then
   * patch the aprons of those neighbours (seam fix, see layerApron.ts).
   */
  private installLayer(c: TerrainChunk, key: string, raw: Uint8Array): void {
    const n = c.grid.chunkSize;
    const { data, mask } = buildLayerApron(raw, n, this.neighbourLayer(c, key));
    c.addLayer(key, raw, data, n + 2, mask);
    for (const [di, dj] of APRON_NEIGHBOURS) {
      const nb = this.chunks.get(nodeKey(c.level, c.i + di, c.j + dj));
      const nraw = nb?.layerData(key);
      if (!nb || !nraw) continue;
      const r = buildLayerApron(nraw, n, this.neighbourLayer(nb, key));
      if (r.mask !== nb.layerApronMask.get(key)) nb.updateLayerApron(key, r.data, r.mask);
    }
  }

  /**
   * Install image layer `key` on `c` with a 1-texel apron from resident same-level neighbours,
   * then write `c`'s edges into those neighbours' aprons on the GPU (seam fix, imageApron.ts).
   */
  private installImage(c: TerrainChunk, key: string, bmp: ImageBitmap, replaced = false): void {
    const nbChunk = (side: Side) => {
      const [di, dj] = SIDE_OFFSET[side];
      return this.chunks.get(nodeKey(c.level, c.i + di, c.j + dj));
    };
    const { canvas, edges, mask } = composeImageApron(bmp, (side) => nbChunk(side)?.imageInfo(key)?.edges);
    bmp.close();
    c.addImage(key, canvas, edges.size, edges, mask, this.imageAnisotropy);
    if (!this.renderer) return;
    for (const side of SIDES) {
      const nb = nbChunk(side);
      const info = nb?.imageInfo(key);
      const tex = nb?.texture(key);
      const far = opposite(side);
      // A resized image (other decode tier) re-patches neighbours whose apron already held its old edge.
      if (!nb || !info || !tex || (info.mask & SIDE_BIT[far] && !replaced)) continue;
      patchImageApron(this.renderer, tex, far, resampleStrip(edges[side], edges.size, info.size), info.size);
      nb.markImageApron(key, SIDE_BIT[far]);
    }
  }

  /**
   * Fetch + decode a colour image (browser colour management on, unlike data layers), downscaled
   * to `size`² when that is below the native `native` px (decode tier, imageRes.ts).
   */
  private async fetchImage(url: string, size = Infinity, native = Infinity): Promise<ImageBitmap> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const blob = await res.blob();
    if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') {
      throw new Error(`Not an image (${blob.type}): ${url}`);
    }
    if (size < native) return createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'medium' });
    return createImageBitmap(blob);
  }

  /** Decode tiers of image `img` (native pixelsPerChunk first). */
  private tiers(img: ImageLayerSource): number[] {
    return imageTiers(img.pixelsPerChunk);
  }

  /** Decode size for image `img` on chunk `c` by the last selection's need. */
  private imageDecodeSize(c: TerrainChunk, img: ImageLayerSource): number {
    return tierFor(this.tiers(img), c.imageNeedPx);
  }

  /**
   * Re-decode resident image `key` of `c` at the tier its need asks for (approach → upgrade, far /
   * budget pressure → downgrade). The old texture stays bound until the new one is installed.
   */
  private imageResizeJob(c: TerrainChunk, key: string, priority: number, pressure: boolean): Job {
    return {
      id: `img:${c.key}:${key}`,
      priority,
      run: async () => {
        const img = this.imageSource(c.level, key);
        const cur = c.imageInfo(key)?.size;
        if (!img || !cur || this.chunks.get(c.key) !== c) return;
        const target = resizeTarget(this.tiers(img), cur, c.imageNeedPx, pressure);
        if (target === null) return;
        try {
          const bmp = await this.fetchImage(chunkUrl(this.baseUrl, img.path, c.i, c.j), target, img.pixelsPerChunk);
          if (this.chunks.get(c.key) === c && c.imageInfo(key)?.size === cur) this.installImage(c, key, bmp, true);
          else bmp.close();
        } catch (err) {
          console.warn(`[terrain] resize ${key} ${c.key}: ${String(err)}`);
        }
      },
    };
  }

  private dtmJob(n: NodeId, priority: number): Job {
    const key = nodeKey(n.level, n.i, n.j);
    return {
      id: `dtm:${key}`,
      priority,
      run: async () => {
        if (this.chunks.has(key) || this.failed.has(key)) return;
        const lv = this.levels[n.level];
        const g = this.levelGrids[n.level];
        try {
          const { data, width } = await this.pool.decodeHeights(chunkUrl(this.baseUrl, lv.height.dtm.path, n.i, n.j));
          const expected = heightImageSize(g);
          if (width !== expected) throw new Error(`${width}px, expected ${expected}`);
          if (this.chunks.has(key)) return;
          this.addChunk(n, data);
        } catch (err) {
          this.failed.add(key);
          console.error(`[terrain] dtm ${key}: ${String(err)}`);
        }
      },
    };
  }

  private addChunk(n: NodeId, data: Float32Array): TerrainChunk {
    const lv = this.levels[n.level];
    const g = this.levelGrids[n.level];
    const chunk = new TerrainChunk(
      n.level,
      n.i,
      n.j,
      data,
      g,
      this.uniforms,
      nodeRect(lv, n.i, n.j, this.aoi),
      aoiPixelMax(lv, n.i, n.j, g.apron, this.aoi),
    );
    chunk.configureSkirts(this.skirtSpacings);
    chunk.lastUsed = this.frame;
    chunk.mesh.visible = false;
    this.bindChunk(chunk);
    this.heights.add(n.level, n.i, n.j, data);
    this.chunks.set(chunk.key, chunk);
    this.add(chunk.mesh);
    return chunk;
  }

  private layerJob(chunk: TerrainChunk, key: string, priority: number): Job {
    return {
      id: `lyr:${chunk.key}:${key}`,
      priority,
      run: async () => {
        if (chunk.hasLayer(key) || this.chunks.get(chunk.key) !== chunk) return;
        const img = this.imageSource(chunk.level, key);
        const src = img ? undefined : this.layerSource(chunk.level, key);
        if (!img && !src) return;
        try {
          if (img) {
            const size = this.imageDecodeSize(chunk, img);
            const bmp = await this.fetchImage(chunkUrl(this.baseUrl, img.path, chunk.i, chunk.j), size, img.pixelsPerChunk);
            if (this.chunks.get(chunk.key) === chunk && !chunk.hasLayer(key)) this.installImage(chunk, key, bmp);
            else bmp.close();
            return;
          }
          const { data, width, height } = await this.pool.decodeU8(chunkUrl(this.baseUrl, src!.path, chunk.i, chunk.j));
          const n = chunk.grid.chunkSize;
          if (width !== n || height !== n) throw new Error(`${width}×${height}px, expected ${n}²`);
          if (this.chunks.get(chunk.key) === chunk) this.installLayer(chunk, key, data);
        } catch (err) {
          chunk.layerFailed.add(key);
          console.warn(`[terrain] layer ${key} ${chunk.key}: ${String(err)}`);
        }
      },
    };
  }

  private dsmJob(chunk: TerrainChunk, priority: number): Job {
    return {
      id: `dsm:${chunk.key}`,
      priority,
      run: async () => {
        const dsm = this.manifest.height.dsm;
        if (!dsm || chunk.canopy || this.chunks.get(chunk.key) !== chunk) return;
        try {
          const { data, width } = await this.pool.decodeHeights(chunkUrl(this.baseUrl, dsm.path, chunk.i, chunk.j));
          if (width !== heightImageSize(this.grid)) throw new Error(`${width}px`);
          if (this.chunks.get(chunk.key) !== chunk || chunk.canopy) return;
          this.canopyHeights.add(chunk.i, chunk.j, data);
          const part = chunk.setCanopy(data);
          part.mesh.material.transparent = this.forest.mode === 'transparent' || this.canopyLensFade > 0;
          part.mesh.visible = false;
          this.canopyGroup.add(part.mesh);
          this.emit();
        } catch (err) {
          this.canopyFailed.add(chunk.key);
          console.warn(`[terrain] dsm ${chunk.key}: ${String(err)}`);
        }
      },
    };
  }

  /** Low-pass radius in pixels of `level` for the current *Relief-Radius*. */
  private lowpassPx(level: number): number {
    return Math.max(0, Math.round(this.lowpassRadius / this.levels[level].cellSize));
  }

  /** Bit k set = neighbour k (NEIGHBOURS) is resident or outside the grid (edge clamp → exact). */
  private neighbourMask(c: TerrainChunk): number {
    const { nx, ny } = this.levels[c.level].chunks;
    const q = this.heights.levels[c.level];
    let m = 0;
    NEIGHBOURS.forEach(([di, dj], k) => {
      const i = c.i + di;
      const j = c.j + dj;
      if (i < 0 || j < 0 || i >= nx || j >= ny || q.has(i, j)) m |= 1 << k;
    });
    return m;
  }

  /** Does chunk `c` need a (re)built low-pass? (radius changed, or a neighbour became resident). */
  private lowpassStale(c: TerrainChunk): boolean {
    if (c.lowpassKey !== String(this.lowpassPx(c.level))) return true;
    return (this.neighbourMask(c) & ~c.lowpassMask) !== 0;
  }

  private lowpassJob(chunk: TerrainChunk, priority: number): Job {
    return {
      id: `lp:${chunk.key}`,
      priority,
      run: async () => {
        if (this.chunks.get(chunk.key) !== chunk || !this.lowpassStale(chunk)) return;
        const k = chunk.level;
        const R = this.lowpassPx(k);
        const g = this.levelGrids[k];
        const side = heightImageSize(g);
        const mask = this.neighbourMask(chunk);
        if (R === 0) {
          chunk.setLowpass(chunk.heights.slice(), '0', mask);
          return;
        }
        const own = chunk.heights;
        const q = this.heights.levels[k];
        const w = lowpassWindow(g, chunk.i, chunk.j, R);
        const fallback = (c: number, r: number): number => {
          const p = cellToWorld(c, r, g);
          const h = this.heights.heightAt(p.x, p.z, k + 1);
          if (!Number.isNaN(h)) return h;
          // No coarser data: clamp into the chunk's own image.
          const px = Math.min(Math.max(c - chunk.i * g.chunkSize + g.apron, 0), side - 1);
          const py = Math.min(Math.max(r - chunk.j * g.chunkSize + g.apron, 0), side - 1);
          return own[py * side + px];
        };
        const region = assembleRegion(g, w.c0, w.r0, w.size, w.size, (i, j) => q.chunk(i, j), fallback);
        const blurred = await this.pool.boxBlur(region.data, w.size, w.size, R, [R, R, side, side]);
        if (this.chunks.get(chunk.key) !== chunk || !this.usesLowpass()) return;
        clampOutside(blurred, side, chunk.i * g.chunkSize - g.apron, chunk.j * g.chunkSize - g.apron, g.width, g.height);
        chunk.setLowpass(blurred, String(R), mask);
      },
    };
  }

  private usesLowpass(): boolean {
    return this.display === 'live-lrm' || this.overlay.key === 'live-lrm';
  }

  private canopyWanted(): boolean {
    return this.hasCanopyData() && this.forest.mode !== 'off';
  }

  /**
   * Layers chunk `c` should have for the current display (available at its level, not failed);
   * with `lens`, also the lens slot C layer (requested, but not required for `isComplete`).
   */
  private neededLayers(c: TerrainChunk, lens = true): string[] {
    const out: string[] = [];
    for (const key of [this.layerSlotA(), this.layerSlotB(), lens ? this.layerSlotC() : null]) {
      if (key && this.hasSource(c.level, key) && !c.layerFailed.has(key) && !out.includes(key)) out.push(key);
    }
    return out;
  }

  private isComplete(c: TerrainChunk): boolean {
    return this.neededLayers(c, false).every((k) => c.hasLayer(k));
  }

  /** Bind display slots on one chunk (with per-level availability + stand-ins). */
  private bindChunk(c: TerrainChunk): void {
    const a = this.layerSlotA();
    const b = this.layerSlotB();
    const altA = a && !this.hasSource(c.level, a) ? (LAYER_ALT[a] ?? -1) : -1;
    const altB = b && !this.hasSource(c.level, b) ? (LAYER_ALT[b] ?? -1) : -1;
    c.bindLayers(a, b, altA, altB);
    const lc = this.layerSlotC();
    c.bindLens(lc, lc && !this.hasSource(c.level, lc) ? (LAYER_ALT[lc] ?? -1) : -1);
  }

  private evict(c: TerrainChunk): void {
    this.remove(c.mesh);
    const cm = c.dropCanopy();
    if (cm) this.canopyGroup.remove(cm);
    this.heights.remove(c.level, c.i, c.j);
    if (c.level === 0) this.canopyHeights.remove(c.i, c.j);
    c.dispose();
    this.chunks.delete(c.key);
    this.evictedCount++;
  }

  /** Estimated GPU bytes of all resident chunk textures. */
  gpuBytes(): number {
    let b = 0;
    for (const c of this.chunks.values()) b += c.gpuBytes();
    return b;
  }

  /** Streaming statistics (also on window.sle.terrainStats()). */
  streamStats(): StreamStats {
    const levels = this.levels.map((lv) => ({ level: lv.level, cellSize: lv.cellSize, resident: 0, drawn: 0 }));
    for (const c of this.chunks.values()) levels[c.level].resident++;
    for (const c of this.drawn) levels[c.level].drawn++;
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      levels,
      gpuMB: r(this.gpuBytes() / MiB),
      keptMB: r(this.keptBytes / MiB),
      imageMB: r([...this.chunks.values()].reduce((a, c) => a + c.imageGpuBytes(), 0) / MiB),
      imageScale: this.imageScale,
      budgetMB: r(clampBudget(this.streaming.budget) / MiB),
      queue: this.pending.length,
      inFlight: this.inFlight.size,
      pending: this.pending.length + this.inFlight.size,
      pixelError: r(this.effError * 100) / 100,
      evicted: this.evictedCount,
      failed: this.failed.size,
    };
  }

  /** Resolves when no streaming job is waiting or running (for tests / verification). */
  idle(): Promise<void> {
    return this.waitFor(() => this.inFlight.size === 0 && this.pending.length === 0);
  }

  private geometry(pixelSpacing: number): BufferGeometry {
    let g = this.geometries.get(pixelSpacing);
    if (!g) {
      g = createGridGeometry(this.grid.chunkSize, pixelSpacing, this.grid.apron);
      this.geometries.set(pixelSpacing, g);
    }
    return g;
  }

  /** Rebuild LOD geometries after changing `lod.spacings`. */
  resetLodGeometries(): void {
    for (const g of this.geometries.values()) g.dispose();
    this.geometries.clear();
    for (const c of this.chunks.values()) {
      c.lod = -1;
      c.configureSkirts(this.skirtSpacings);
    }
  }

  // ---- per-frame ----------------------------------------------------------------------

  /** Displayed bounding box of a node (resident chunk, else its nearest resident ancestor's heights). */
  private nodeBox(n: NodeId, target: Box3): Box3 {
    const key = nodeKey(n.level, n.i, n.j);
    const c = this.chunks.get(key);
    const exag = this.uniforms.uExag.value;
    const hRef = this.uniforms.uHRef.value;
    if (c) return c.bounds(exag, hRef, target);
    let mn = this.manifest.heightRange.min;
    let mx = this.manifest.heightRange.max;
    for (let k = n.level + 1, i = n.i >> 1, j = n.j >> 1; k < this.levels.length; k++, i >>= 1, j >>= 1) {
      const a = this.chunks.get(nodeKey(k, i, j));
      if (a) {
        mn = a.minH;
        mx = a.maxH;
        break;
      }
    }
    const r = nodeRect(this.levels[n.level], n.i, n.j, this.aoi);
    target.min.set(r.x0, hRef + (mn - hRef) * exag - 30, r.z0);
    target.max.set(r.x1, hRef + (mx - hRef) * exag + 1, r.z1);
    return target;
  }

  private nodeInfo(n: NodeId): { d: number; v: boolean } {
    const key = nodeKey(n.level, n.i, n.j);
    let e = this.nodeCache.get(key);
    if (!e) {
      const b = this.nodeBox(n, _box);
      e = {
        d: distanceToBox(_cam.x, _cam.y, _cam.z, b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z),
        v: _frustum.intersectsBox(b),
      };
      this.nodeCache.set(key, e);
    }
    return e;
  }

  private setFrustum(camera: Camera): void {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert(); // render() would do this too late
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m);
    camera.getWorldPosition(_cam);
  }

  /**
   * Per frame, before rendering: quadtree selection (what to draw / load), job queue, LRU
   * eviction under the GPU budget, then culling + mesh LOD of the drawn chunks.
   */
  update(camera: Camera): void {
    this.setFrustum(camera);
    this.frame++;
    this.nodeCache.clear();
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 60;
    const s = this.streaming;
    const sel = selectNodes({
      levels: this.levels,
      projFactor: projectionFactor(fov),
      threshold: this.effError * s.pixelError,
      offscreenScale: s.offscreenScale,
      distance: (n) => this.nodeInfo(n).d,
      inView: (n) => this.nodeInfo(n).v,
      hasData: (n) => this.chunks.has(nodeKey(n.level, n.i, n.j)),
      canReplace: (n) => {
        const c = this.chunks.get(nodeKey(n.level, n.i, n.j));
        return !!c && this.isComplete(c);
      },
      wasActive: (n) => this.active.has(nodeKey(n.level, n.i, n.j)),
    });
    this.active = sel.active;
    this.drawn = [];
    for (const n of sel.draw) {
      const c = this.chunks.get(nodeKey(n.level, n.i, n.j));
      if (c) this.drawn.push(c);
    }
    this.heights.setDisplayed(this.drawn);
    for (const key of sel.keep) {
      const c = this.chunks.get(key);
      if (c) c.lastUsed = this.frame;
    }

    // ---- jobs
    const jobs: Job[] = [];
    const wantLayers = (c: TerrainChunk, prio: number) => {
      for (const k of this.neededLayers(c)) if (!c.hasLayer(k)) jobs.push(this.layerJob(c, k, prio));
    };
    // Image px per chunk side the view needs (decode tier, imageRes.ts): CSS pixels per metre at
    // the chunk's nearest point (1 texel per CSS px = ½ per device px on a 2× screen; independent
    // of the quality preset's pixel-ratio cap), coarser off-screen and under budget pressure.
    const r = this._renderer;
    const viewportPx = (r && r.domElement.height / r.getPixelRatio()) || 1080;
    const imageNeed = (c: TerrainChunk, d: number, v: boolean) => {
      c.imageNeedPx = screenPxPerMetre(viewportPx, fov, d) * (v ? 1 : s.offscreenScale) * s.imageDetail * this.imageScale * c.spanM;
    };
    const pressure = this.imageScale < 1;
    for (const w of sel.want) {
      const key = nodeKey(w.node.level, w.node.i, w.node.j);
      const c = this.chunks.get(key);
      if (!c) {
        if (!this.failed.has(key)) jobs.push(this.dtmJob(w.node, w.priority));
      } else {
        const { d, v } = this.nodeInfo(w.node);
        imageNeed(c, d, v);
        wantLayers(c, w.priority + 0.5);
      }
    }
    const lp = this.usesLowpass();
    const canopy = this.canopyWanted();
    for (const c of this.drawn) {
      const { d, v } = this.nodeInfo({ level: c.level, i: c.i, j: c.j });
      const prio = (v ? 0 : 1e7) + d;
      imageNeed(c, d, v);
      wantLayers(c, prio);
      for (const k of this.neededLayers(c)) {
        const img = this.imageSource(c.level, k);
        const cur = img && c.imageInfo(k)?.size;
        if (cur && resizeTarget(this.tiers(img), cur, c.imageNeedPx, pressure) !== null) jobs.push(this.imageResizeJob(c, k, prio + 0.25, pressure));
      }
      if (lp && this.lowpassStale(c)) jobs.push(this.lowpassJob(c, prio + 1));
      if (canopy && c.level === 0 && !c.canopy && !this.canopyFailed.has(c.key) && d < s.canopyDistance) {
        jobs.push(this.dsmJob(c, prio + 2));
      }
      // R0.7: the building mask travels with the canopy (level 0, same distance).
      if (canopy && c.level === 0 && this.needsBldg(c) && d < s.canopyDistance) jobs.push(this.layerJob(c, BLDG_KEY, prio + 2.5));
    }
    this.schedule(jobs);

    // ---- budget
    const budget = clampBudget(s.budget);
    const top = this.levels.length - 1;
    const entries: LruEntry[] = [];
    let kept = 0;
    let keptImages = 0;
    for (const c of this.chunks.values()) {
      const bytes = c.gpuBytes();
      entries.push({ key: c.key, bytes, lastUsed: c.lastUsed, pinned: c.level === top });
      if (sel.keep.has(c.key) || c.level === top) {
        kept += bytes;
        keptImages += c.imageGpuBytes();
      }
    }
    this.keptBytes = kept;
    for (const key of planEviction(entries, budget, sel.keep)) {
      const c = this.chunks.get(key);
      if (c) this.evict(c);
    }
    if (kept > budget) {
      // Kept (drawn + ancestors) chunks alone exceed the budget: drop what they don't display first.
      const a = this.layerSlotA();
      const b = this.layerSlotB();
      const lc = this.layerSlotC();
      for (const c of this.chunks.values()) {
        for (const k of c.layerKeys()) if (k !== a && k !== b && k !== lc && !(k === BLDG_KEY && c.canopy)) c.removeLayer(k);
      }
    }
    // Over budget: first halve the image detail (one decode tier, min 0.5 = one tier below need)
    // while images are a large share of the kept set, then coarsen the mesh. Recovery in reverse
    // order: geometry back to the base threshold, then images (cooldowns let the resizes land).
    const since = this.frame - this.imageScaleFrame;
    if (kept > budget && this.imageScale > 0.5 && keptImages > 0.25 * kept) {
      if (since > 60) {
        this.imageScale /= 2;
        this.imageScaleFrame = this.frame;
      }
    } else {
      this.effError = adaptThreshold(this.effError, 1, kept, budget);
      if (this.imageScale < 1 && this.effError <= 1 && kept < 0.5 * budget && since > 120) {
        this.imageScale = Math.min(1, this.imageScale * 2);
        this.imageScaleFrame = this.frame;
      }
    }

    this.cull(camera, false);
  }

  /**
   * Frustum culling + mesh LOD + skirts for the drawn chunks (terrain and canopy). `update()` calls
   * it; the value pass calls it alone for its top-down camera.
   */
  cull(camera: Camera, setFrustum = true): void {
    if (setFrustum) this.setFrustum(camera);
    const exag = this.uniforms.uExag.value;
    const hRef = this.uniforms.uHRef.value;
    const { spacings, distances } = this.lod;
    const canopyOn = this.canopyGroup.visible;
    for (const c of this.chunks.values()) {
      c.mesh.visible = false;
      if (c.canopy) c.canopy.mesh.visible = false;
    }
    let visible = 0;
    let tris = 0;
    let canopyVisible = 0;
    for (const c of this.drawn) {
      c.bounds(exag, hRef, _box);
      const inView = _frustum.intersectsBox(_box);
      c.mesh.visible = inView;
      let canopyInView = false;
      if (c.canopy) {
        canopyInView = canopyOn && _frustum.intersectsBox(c.bounds(exag, hRef, _box, true));
        c.canopy.mesh.visible = canopyInView;
      }
      if (!inView && !canopyInView) continue;
      const d = c.bounds(exag, hRef, _box, canopyInView).distanceToPoint(_cam);
      let tier = 0;
      while (tier < distances.length && tier < spacings.length - 1 && d > distances[tier]) tier++;
      const px = pixelSpacingFor(spacings[tier], c.cellSize, this.allowedSpacings);
      c.setLod(px, this.geometry(px), tier);
      c.updateSkirt(exag);
      const t = (c.mesh.geometry.index?.count ?? 0) / 3;
      if (inView) {
        visible++;
        tris += t;
      }
      if (canopyInView) {
        canopyVisible++;
        tris += t;
      }
    }
    this.stats.visible = visible;
    this.stats.triangles = tris;
    this.stats.canopyVisible = canopyVisible;
  }

  // ---- heights ------------------------------------------------------------------------

  /** True terrain height (m ü. NN) at world x/z (bilinear, edge-clamped; NaN if not loaded). */
  heightAt(x: number, z: number): number {
    return this.heights.heightAt(x, z);
  }

  /**
   * Displayed (bare-earth) surface y (with vertical exaggeration) at world x/z, from the level
   * actually drawn there (picking, anchors, collision match the visible mesh).
   */
  surfaceY(x: number, z: number): number {
    const h = this.heights.heightAtDisplayed(x, z);
    if (Number.isNaN(h)) return NaN;
    return this.toDisplayY(h);
  }

  /** True DSM (canopy/roof) height, NaN if the DSM is not loaded. */
  canopyHeightAt(x: number, z: number): number {
    return this.canopyHeights.loadedCount ? this.canopyHeights.heightAt(x, z) : NaN;
  }

  /** Displayed height the drone must stay above: the DTM (flying passes through the canopy, ADR 0020). */
  collisionY(x: number, z: number): number {
    return this.surfaceY(x, z);
  }

  /** Ground provider for DroneController. */
  readonly collisionGround = { surfaceY: (x: number, z: number) => this.collisionY(x, z) };

  toDisplayY(h: number): number {
    const r = this.uniforms.uHRef.value;
    return r + (h - r) * this.uniforms.uExag.value;
  }

  fromDisplayY(y: number): number {
    const r = this.uniforms.uHRef.value;
    return r + (y - r) / this.uniforms.uExag.value;
  }

  /** Intersect a world-space ray with the displayed (bare-earth) terrain. Returns the hit point or null. */
  intersectRay(ray: Ray, maxDist = 20000): Vector3 | null {
    const { origin: o, direction: d } = ray;
    const t = raycastHeightField((x, z) => this.surfaceY(x, z), o.x, o.y, o.z, d.x, d.y, d.z, maxDist);
    return t === null ? null : ray.at(t, new Vector3());
  }

  /** three.js Raycaster support: `raycaster.intersectObject(terrain)` hits the displaced surface. */
  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const point = this.intersectRay(raycaster.ray, raycaster.far);
    if (!point) return;
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({ distance, point, object: this });
  }

  // ---- display modes & layers -----------------------------------------------------------

  /** Should chunk `c` load the R0.7 building mask (manifest has it, not resident/failed)? */
  private needsBldg(c: TerrainChunk): boolean {
    return c.level === 0 && !!this.manifest.layers[BLDG_KEY] && !c.hasLayer(BLDG_KEY) && !c.layerFailed.has(BLDG_KEY);
  }

  /** Manifest layers that are u8 encoded (missing layers are simply absent). */
  availableLayers(): Array<[string, LayerSource]> {
    return Object.entries(this.manifest.layers).filter(([, l]) => l.encoding === 'u8');
  }

  /** The relief switcher entries available for this manifest (in shortcut order). */
  modes(): ModeEntry[] {
    return availableModes(this.manifest.layers);
  }

  /** Image modes ("Bilder", F13/F14): one per level-0 `rgb` layer, no number shortcut. */
  imageModes(): ModeEntry[] {
    return imageModes(this.manifest.imageLayers);
  }

  /** Is `key` an `rgb` image layer (orthophoto, historic map)? */
  isImageKey(key: string): boolean {
    return !!key && !!this.manifest.imageLayers?.[key];
  }

  /** Display label (German) for a key: manifest `label_de`, live label, or the key. */
  labelFor(key: string): string {
    return LIVE_SOURCES[key]?.label ?? this.manifest.layers[key]?.label_de ?? this.manifest.imageLayers?.[key]?.label_de ?? key;
  }

  /** Default display: `vat` if the manifest has it, else live hillshade. */
  defaultDisplay(): string {
    return this.manifest.layers.vat ? 'vat' : 'live-hillshade';
  }

  isValidDisplay(key: string): boolean {
    return isLiveKey(key) || this.manifest.layers[key]?.encoding === 'u8' || this.isImageKey(key);
  }

  getDisplay(): string {
    return this.display;
  }

  private freshChannel(key: string): ChannelSettings {
    const layer = this.manifest.layers[key];
    const colormap = defaultColormap(key, layer);
    return {
      colormap,
      stretch: defaultStretch(key, layer),
      shade: colormap === Colormap.Gray || colormap === Colormap.GrayInv ? 0 : key === 'mask' ? 0 : 0.55,
    };
  }

  /** Remembered (or default) channel settings for display key `key` (live object; call applyChannels after mutating). */
  channel(key: string): ChannelSettings {
    let c = this.channelMemory.get(key);
    if (!c) {
      c = this.freshChannel(key);
      this.channelMemory.set(key, c);
    }
    return c;
  }

  /** Reset `key` to its default colormap / stretch. */
  resetChannel(key: string): void {
    this.channelMemory.set(key, this.freshChannel(key));
    if (key === this.display) this.applyChannels();
  }

  /** Default (manifest-derived) stretch for a key. */
  defaultStretchFor(key: string): Stretch {
    return defaultStretch(key, this.manifest.layers[key]);
  }

  /** Switch the base display (live key or manifest layer key). Unknown keys fall back to hillshade. */
  setDisplay(key: string, colormap: ColormapName = 'auto'): void {
    if (!this.isValidDisplay(key)) key = 'live-hillshade';
    this.display = key;
    if (colormap !== 'auto') {
      const map = { gray: Colormap.Gray, diverging: Colormap.Diverging, viridis: Colormap.Viridis } as const;
      this.channel(key).colormap = map[colormap];
    }
    this.applyChannels();
  }

  getOverlay(): Readonly<OverlaySettings> {
    return this.overlay;
  }

  /**
   * Set overlay source and/or blend parameters. Changing the key restores that key's
   * remembered channel (colormap/stretch) unless given in `patch`.
   */
  setOverlay(patch: Partial<OverlaySettings>): void {
    const next = { ...this.overlay, ...patch };
    if (patch.key !== undefined && patch.key !== this.overlay.key && patch.key) {
      const mem = this.channelMemory.get(`ovl:${patch.key}`) ?? this.freshChannel(patch.key);
      if (patch.colormap === undefined) next.colormap = mem.colormap;
      if (patch.stretch === undefined) next.stretch = { ...mem.stretch };
      if (patch.shade === undefined) next.shade = mem.shade;
    }
    if (next.key && !this.isValidDisplay(next.key)) next.key = '';
    this.overlay = next;
    if (next.key) this.channelMemory.set(`ovl:${next.key}`, { colormap: next.colormap, stretch: { ...next.stretch }, shade: next.shade });
    this.applyChannels();
  }

  private layerSlotA(): string | null {
    return isLiveKey(this.display) ? null : this.display;
  }

  private layerSlotB(): string | null {
    const k = this.overlay.key;
    return k && !isLiveKey(k) ? k : null;
  }

  private layerSlotC(): string | null {
    const k = this.lensKey;
    return k && !isLiveKey(k) ? k : null;
  }

  /**
   * Relikt-Blick lens (V2.5): bind `ch` to slot C (null = no lens layer). Streams the layer for the
   * drawn chunks like the overlay, but finer chunks never wait for it (the shader shows a neutral
   * hillshade until it arrives). Base/overlay settings, store and URL hash are untouched.
   */
  setLens(ch: LensChannel | null): void {
    const u = this.uniforms;
    if (!ch || !this.isValidDisplay(ch.key)) {
      this.lensKey = null;
      u.uLensSrc.value = ShaderSource.Off;
    } else {
      const key = ch.key;
      this.lensKey = key;
      const fresh = this.freshChannel(key);
      u.uLensSrc.value = LIVE_SRC[key] ?? (this.isImageKey(key) ? ShaderSource.ImageC : ShaderSource.LayerC);
      u.uLensCmap.value = ch.colormap ?? fresh.colormap;
      const st = ch.stretch ?? fresh.stretch;
      u.uLensStretch.value.set(st.lo, st.hi, st.gamma);
      u.uLensShade.value = ch.shade ?? fresh.shade;
      u.uLensTint.value.set(...(ch.tint ?? [1, 1, 1]));
      const layer = this.manifest.layers[key];
      if (layer) u.uLayerCRange.value.set(layer.min, layer.max);
    }
    for (const c of this.chunks.values()) this.bindChunk(c);
  }

  /** Current lens slot key (null = none). */
  getLens(): string | null {
    return this.lensKey;
  }

  /**
   * Lens fade of the relief lab's DSM canopy (F5): 0 = as `forest` says, 1 = hidden. In between
   * the canopy is drawn transparent like *Transparent*, with its opacity scaled by 1 − f.
   */
  setCanopyLensFade(f: number): void {
    const v = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0));
    if (v === this.canopyLensFade) return;
    this.canopyLensFade = v;
    this.applyCanopyLook();
  }

  /** Push channel settings into the shared uniforms and bind layer textures (per level). */
  applyChannels(): void {
    const u = this.uniforms;
    const key = this.display;
    const ch = this.channel(key);
    const layer = this.manifest.layers[key];
    u.uBaseSrc.value = LIVE_SRC[key] ?? (this.isImageKey(key) ? ShaderSource.ImageA : ShaderSource.LayerA);
    u.uBaseCmap.value = ch.colormap;
    u.uBaseStretch.value.set(ch.stretch.lo, ch.stretch.hi, ch.stretch.gamma);
    u.uBaseShade.value = ch.shade;
    if (layer) u.uLayerARange.value.set(layer.min, layer.max);

    const o = this.overlay;
    if (o.key) {
      u.uOvlSrc.value = LIVE_SRC[o.key] ?? (this.isImageKey(o.key) ? ShaderSource.ImageB : ShaderSource.LayerB);
      u.uOvlCmap.value = o.colormap;
      u.uOvlStretch.value.set(o.stretch.lo, o.stretch.hi, o.stretch.gamma);
      u.uOvlShade.value = o.shade;
      u.uOvlOpacity.value = o.opacity;
      u.uOvlBlend.value = o.blend;
      const ol = this.manifest.layers[o.key];
      if (ol) u.uLayerBRange.value.set(ol.min, ol.max);
    } else {
      u.uOvlSrc.value = ShaderSource.Off;
    }

    for (const c of this.chunks.values()) this.bindChunk(c);
    // Free the per-chunk low-pass textures while live local relief is not shown.
    if (!this.usesLowpass()) for (const c of this.chunks.values()) if (c.hasLowpass) c.clearLowpass();
    // Layers / low-pass for the drawn chunks are requested by the next update().
    this.emit();
  }

  /**
   * Load layer `key` for the drawn chunks whose level carries it (idempotent). Resolves when those
   * requests settled. Chunks show hillshade (or a stand-in) until their texture arrives.
   */
  async ensureLayer(key: string): Promise<void> {
    const todo = this.drawn.filter((c) => this.hasSource(c.level, key) && !c.hasLayer(key) && !c.layerFailed.has(key));
    if (todo.length === 0) return;
    for (const c of todo) {
      const j = this.layerJob(c, key, 0);
      if (!this.inFlight.has(j.id)) this.forced.set(j.id, j);
    }
    this.schedule([...this.pending]);
    await this.waitFor(() => todo.every((c) => c.hasLayer(key) || c.layerFailed.has(key) || this.chunks.get(c.key) !== c));
  }

  // ---- forest / canopy -----------------------------------------------------------------------

  hasCanopyData(): boolean {
    return !!this.manifest.height.dsm;
  }

  /**
   * Forest display: off / transparent (opacity) / full; and canopy collision. The DSM streams for
   * drawn level-0 chunks within `streaming.canopyDistance` (next `update()`).
   */
  setForest(patch: Partial<ForestSettings>): void {
    Object.assign(this.forest, patch);
    this.applyCanopyLook();
    this.emit();
  }

  /** Canopy visibility / transparency from `forest` and the lens fade (V2.5). */
  private applyCanopyLook(): void {
    const f = this.forest;
    const lf = this.canopyLensFade;
    const on = f.mode !== 'off' && this.hasCanopyData() && lf < 1;
    this.canopyGroup.visible = on;
    const transparent = f.mode === 'transparent' || lf > 0;
    this.uniforms.uCanopyOpacity.value = (f.mode === 'transparent' ? f.opacity : 1) * (1 - lf);
    this.uniforms.uCanopySteepCut.value = transparent ? 3 : 1e6;
    for (const c of this.chunks.values()) {
      const m = c.canopy?.mesh.material;
      if (m && m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
    }
  }

  /**
   * Resolves when every drawn level-0 chunk near the camera has its canopy (or failed). Kept for
   * callers that need the DSM (e.g. verification); streaming loads it anyway.
   */
  ensureCanopy(): Promise<void> {
    if (!this.hasCanopyData()) return Promise.resolve();
    const near = () =>
      this.drawn.filter(
        (c) => c.level === 0 && !this.canopyFailed.has(c.key) && c.bounds(1, 0, _box).distanceToPoint(_cam) < this.streaming.canopyDistance,
      );
    const todo = near().filter((c) => !c.canopy || this.needsBldg(c));
    if (todo.length === 0) return Promise.resolve();
    for (const c of todo) {
      for (const j of [this.dsmJob(c, 0), ...(this.needsBldg(c) ? [this.layerJob(c, BLDG_KEY, 0)] : [])]) {
        if (!this.inFlight.has(j.id)) this.forced.set(j.id, j);
      }
    }
    this.schedule([...this.pending]);
    const bldgDone = (c: TerrainChunk) => !this.manifest.layers[BLDG_KEY] || c.hasLayer(BLDG_KEY) || c.layerFailed.has(BLDG_KEY);
    return this.waitFor(() =>
      todo.every((c) => ((c.canopy || this.canopyFailed.has(c.key)) && bldgDone(c)) || this.chunks.get(c.key) !== c),
    );
  }

  // ---- automatic contrast: value pass ----------------------------------------------------------

  /**
   * Render raw physical values of the base (and overlay) channel into a float target and read
   * them back. scope 'view' uses `camera` (what is on screen); 'aoi' renders the drawn cover of
   * the whole AOI from above. Values without data (sky, layers not loaded) are NaN.
   */
  async sampleValues(renderer: WebGLRenderer, camera: PerspectiveCamera, scope: ValueScope): Promise<ValueSample> {
    if (scope === 'aoi') {
      const a = this.layerSlotA();
      const b = this.layerSlotB();
      await Promise.all([a && this.ensureLayer(a), b && this.ensureLayer(b)]);
    }
    const { width: W, height: H } = this.aoi;
    let w: number;
    let h: number;
    let cam: Camera;
    if (scope === 'view') {
      w = 384;
      h = Math.max(16, Math.round(w / Math.max(camera.aspect, 0.1)));
      cam = camera;
    } else {
      w = h = 1024;
      const ortho = new OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 1e5);
      const top = this.toDisplayY(this.manifest.heightRange.max) + 1000;
      ortho.position.set(W / 2, top, -H / 2);
      ortho.rotation.set(-Math.PI / 2, 0, 0);
      ortho.updateMatrixWorld();
      cam = ortho;
    }
    let rt = this.valueTarget;
    if (!rt || rt.width !== w || rt.height !== h) {
      rt?.dispose();
      rt = new WebGLRenderTarget(w, h, { type: FloatType, format: RGBAFormat, depthBuffer: true });
      this.valueTarget = rt;
    }

    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new Color());
    const prevAlpha = renderer.getClearAlpha();
    const canopyVis = this.canopyGroup.visible;
    this.canopyGroup.visible = false;
    this.uniforms.uValuePass.value = 1;
    this.cull(cam);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    this.uniforms.uValuePass.value = 0;
    this.canopyGroup.visible = canopyVis;
    this.cull(camera);

    const px = new Float32Array(w * h * 4);
    await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h, px);
    const n = w * h;
    const base = new Float32Array(n);
    const overlay = this.overlay.key ? new Float32Array(n) : null;
    for (let k = 0; k < n; k++) {
      base[k] = px[4 * k + 2] > 0.5 ? px[4 * k] : NaN;
      if (overlay) overlay[k] = px[4 * k + 3] > 0.5 ? px[4 * k + 1] : NaN;
    }
    return { base, overlay };
  }

  // ---- live local relief -----------------------------------------------------------------

  getLowpassRadius(): number {
    return this.lowpassRadius;
  }

  /** Set the *Relief-Radius* (m); stale per-chunk low-pass surfaces are rebuilt by update(). */
  setLowpassRadius(r: number): void {
    this.lowpassRadius = Math.max(1, Math.round(r));
  }

  dispose(): void {
    this.renderer = null;
    for (const c of this.chunks.values()) c.dispose();
    for (const g of this.geometries.values()) g.dispose();
    this.valueTarget?.dispose();
    this.chunks.clear();
    this.pending = [];
    this.forced.clear();
  }
}
