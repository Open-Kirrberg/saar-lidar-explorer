import {
  Box3,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  RedFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
} from 'three';
import type { ShaderMaterial } from 'three';
import type { ImageEdges } from './imageApron';
import type { GridSpec } from '../data/grid';
import { cellSizeOf, heightImageSize, heightPixelOrigin } from '../data/grid';
import { chunkGpuBytes, imageGpuBytes } from './budget';
import { maxEdgeDeviation, terrainSkirtDepth } from './skirts';
import { createCanopyMaterial, createChunkMaterial, DUMMY_FLOAT, DUMMY_U8 } from './TerrainMaterial';
import type { CanopyChunkUniforms, ChunkUniforms, SharedTerrainUniforms } from './TerrainMaterial';

/** Manifest key of the R0.7 building mask (u8, level 0). */
export const BLDG_KEY = 'bldg';

/** Shared empty geometry until the first setLod() (avoids one throw-away geometry per chunk). */
const NO_GEOMETRY = new BufferGeometry();

const LOD_COLORS = [0xffb0b0, 0xb0ffb0, 0xb0c8ff, 0xfff0a0, 0xe0b0ff, 0xa0f0f0].map((c) => new Color(c));
/** Tint per pyramid level (debug "LOD-Farben" on coarse levels). */
const LEVEL_COLORS = [0xffffff, 0x9fd0ff, 0xffd27f, 0xd9a0ff, 0x8fe0a0, 0xff9f9f].map((c) => new Color(c));

function heightTexture(data: Float32Array, side: number): DataTexture {
  const tex = new DataTexture(data, side, side, RedFormat, FloatType);
  tex.internalFormat = 'R32F';
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

function minMax(a: Float32Array): [number, number] {
  let mn = Infinity;
  let mx = -Infinity;
  for (let k = 0; k < a.length; k++) {
    const h = a[k];
    if (h < mn) mn = h;
    if (h > mx) mx = h;
  }
  return [mn, mx];
}

/** The DSM (canopy) surface of one chunk; shares LOD geometry with the terrain mesh. */
export class CanopyPart {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly texture: DataTexture;
  readonly uniforms: CanopyChunkUniforms;
  readonly minH: number;
  readonly maxH: number;

  constructor(dsm: Float32Array, side: number, owner: TerrainChunk, shared: SharedTerrainUniforms) {
    [this.minH, this.maxH] = minMax(dsm);
    this.texture = heightTexture(dsm, side);
    this.uniforms = {
      uHeight: { value: this.texture },
      uGround: { value: owner.heightTexture },
      uSkirtDepth: { value: 0 },
      uCellSize: owner.uniforms.uCellSize,
      uPxMax: owner.uniforms.uPxMax,
      uBldg: { value: DUMMY_U8 },
      uHasBldg: { value: 0 },
    };
    this.mesh = new Mesh(owner.mesh.geometry, createCanopyMaterial(shared, this.uniforms));
    this.mesh.position.copy(owner.mesh.position);
    this.mesh.scale.copy(owner.mesh.scale);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.renderOrder = 1;
    this.mesh.name = owner.mesh.name.replace('chunk', 'canopy');
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.material.dispose();
  }
}

/** World-space AOI rectangle a chunk is clamped to. */
export interface ChunkRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * One chunk of one pyramid level (500 cells; 500 m at level 0, 500·2^k m at level k): height
 * texture, layer textures (base + overlay slot), LOD-switchable mesh, optional canopy (level 0)
 * and optional per-chunk low-pass (live local relief).
 */
export class TerrainChunk {
  readonly key: string;
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly heightTexture: DataTexture;
  readonly minH: number;
  readonly maxH: number;
  readonly uniforms: ChunkUniforms;
  readonly cellSize: number;
  canopy: CanopyPart | null = null;
  /** Current vertex spacing in pixels (−1 = none yet). */
  lod = -1;
  /** Max deviation (true m) of the mesh edges from the full-res edge over all spacings (see skirts.ts). */
  edgeDev = 0;
  /** Coarsest vertex spacing (metres) this chunk can be drawn at (for the culling margin). */
  private maxSpacingM = 10;
  private spacingM = 1;
  /** u8 layers as (n+2)² apron textures (see layerApron.ts) and `rgb` image textures. */
  private readonly layerTextures = new Map<string, Texture>();
  /** Raw n×n u8 data per u8 layer (neighbours' aprons are built from it). */
  private readonly layerRaw = new Map<string, Uint8Array>();
  /** GPU bytes per resident `rgb` image layer. */
  private readonly imageBytes = new Map<string, number>();
  /** Per image layer: P (px per chunk side, without apron), edge strips, apron neighbour mask (SIDE_BIT). */
  private readonly images = new Map<string, { size: number; edges: ImageEdges; mask: number }>();
  /** Neighbour mask the u8 layer's apron was built with (bit k = APRON_NEIGHBOURS[k]). */
  readonly layerApronMask = new Map<string, number>();
  /** Layers that failed to load for this chunk (not retried). */
  readonly layerFailed = new Set<string>();
  private slotA: string | null = null;
  private slotB: string | null = null;
  /** Lens slot C (V2.5 Relikt-Blick). */
  private slotC: string | null = null;
  private lowpassTex: DataTexture | null = null;
  /** Radius key the current low-pass was built for ('' = none). */
  lowpassKey = '';
  /** Neighbours (bit k = neighbour k of 8, or outside the grid) that were resident when it was built. */
  lowpassMask = 0;
  /** Selection frame this chunk was last needed (LRU). */
  lastUsed = 0;

  constructor(
    readonly level: number,
    readonly i: number,
    readonly j: number,
    heights: Float32Array,
    readonly grid: GridSpec,
    private readonly shared: SharedTerrainUniforms,
    readonly rect: ChunkRect,
    pxMax: { x: number; y: number },
  ) {
    this.key = `${level}/${i}_${j}`;
    this.cellSize = cellSizeOf(grid);
    const side = heightImageSize(grid);
    [this.minH, this.maxH] = minMax(heights);
    this.heightTexture = heightTexture(heights, side);

    this.uniforms = {
      uHeight: { value: this.heightTexture },
      uCellSize: { value: this.cellSize },
      uPxMax: { value: new Vector2(pxMax.x, pxMax.y) },
      uLayerA: { value: DUMMY_U8 },
      uHasLayerA: { value: 0 },
      uLayerAAlt: { value: -1 },
      uLayerB: { value: DUMMY_U8 },
      uHasLayerB: { value: 0 },
      uLayerBAlt: { value: -1 },
      uImgPxA: { value: 1 },
      uImgPxB: { value: 1 },
      uLayerC: { value: DUMMY_U8 },
      uHasLayerC: { value: 0 },
      uLayerCAlt: { value: -1 },
      uImgPxC: { value: 1 },
      uLowpass: { value: DUMMY_FLOAT },
      uHasLowpass: { value: 0 },
      uSkirtDepth: { value: 10 },
      uLodColor: { value: new Color(1, 1, 1) },
    };
    const material = createChunkMaterial(shared, this.uniforms);
    // Geometry is assigned by setLod(); start with an empty placeholder.
    this.mesh = new Mesh(NO_GEOMETRY, material);
    const o = heightPixelOrigin(i, j, grid);
    this.mesh.position.set(o.x, 0, o.z);
    this.mesh.scale.set(this.cellSize, 1, this.cellSize);
    this.mesh.frustumCulled = false; // Terrain culls per chunk with displaced bounds.
    this.mesh.raycast = () => {}; // CPU geometry is undisplaced; Terrain.raycast handles picking.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.mesh.name = `chunk_${level}_${i}_${j}`;
  }

  /** Raw height image (with apron). */
  get heights(): Float32Array {
    return this.heightTexture.image.data as Float32Array;
  }

  /**
   * (Re)compute the edge deviation for the given vertex spacings in **pixels** (call after changing
   * them). Include the spacings of coarser levels (2, 4, 8 … px) so that skirts also close the
   * seams towards neighbours drawn from a coarser level.
   */
  configureSkirts(pixelSpacings: readonly number[]): void {
    const side = heightImageSize(this.grid);
    this.edgeDev = maxEdgeDeviation(this.heights, side, this.grid.apron, this.grid.chunkSize, pixelSpacings);
    this.maxSpacingM = Math.max(1, ...pixelSpacings) * this.cellSize;
  }

  /** Terrain skirt depth (displayed m) at the current LOD for exaggeration `exag`. Canopy skirts stay short. */
  updateSkirt(exag: number): void {
    this.uniforms.uSkirtDepth.value = terrainSkirtDepth(this.spacingM, exag, this.edgeDev);
  }

  /** Switch the mesh to `geometry` with vertex spacing `pixelSpacing` (index into the LOD tint colours: `tint`). */
  setLod(pixelSpacing: number, geometry: BufferGeometry, tint = 0): void {
    if (pixelSpacing === this.lod) return;
    this.lod = pixelSpacing;
    this.mesh.geometry = geometry;
    this.spacingM = pixelSpacing * this.cellSize;
    this.uniforms.uSkirtDepth.value = terrainSkirtDepth(this.spacingM, 1, this.edgeDev); // Terrain.update scales by exag
    const c = this.uniforms.uLodColor.value;
    c.copy(LOD_COLORS[tint % LOD_COLORS.length]);
    if (this.level > 0) c.multiply(LEVEL_COLORS[this.level % LEVEL_COLORS.length]);
    if (this.canopy) {
      this.canopy.mesh.geometry = geometry;
      // Short skirts: canopy gaps at LOD seams are less visible than long dark curtains.
      this.canopy.uniforms.uSkirtDepth.value = this.spacingM;
    }
  }

  /** Attach the DSM surface (canopy, level 0 only). */
  setCanopy(dsm: Float32Array): CanopyPart {
    this.canopy?.dispose();
    this.canopy = new CanopyPart(dsm, heightImageSize(this.grid), this, this.shared);
    this.canopy.mesh.geometry = this.mesh.geometry;
    this.bindBuildingMask();
    return this.canopy;
  }

  /** Detach and dispose the canopy (returns its mesh so the caller can remove it from the scene). */
  dropCanopy(): Mesh | null {
    const c = this.canopy;
    if (!c) return null;
    c.dispose();
    this.canopy = null;
    return c.mesh;
  }

  /** World-space bounds for vertical exaggeration `exag` about `hRef`. */
  bounds(exag: number, hRef: number, target = new Box3(), canopy = false): Box3 {
    const mn = canopy && this.canopy ? this.canopy.minH : this.minH;
    const mx = canopy && this.canopy ? this.canopy.maxH : this.maxH;
    // Margin below the lowest displayed point: the (exaggeration-scaled) terrain skirt at the
    // coarsest LOD, or the short canopy skirt.
    const margin = canopy && this.canopy ? 30 : Math.max(30, terrainSkirtDepth(this.maxSpacingM, exag, this.edgeDev) + 1);
    const y0 = hRef + (mn - hRef) * exag - margin;
    const y1 = hRef + (mx - hRef) * exag + 1;
    const r = this.rect;
    target.min.set(r.x0, y0, r.z0);
    target.max.set(r.x1, y1, r.z1);
    return target;
  }

  hasLayer(key: string): boolean {
    return this.layerTextures.has(key);
  }

  /** Keys of resident layer textures. */
  layerKeys(): string[] {
    return [...this.layerTextures.keys()];
  }

  /** Raw n×n u8 data of a loaded u8 layer (neighbour aprons, CPU statistics), or undefined. */
  layerData(key: string): Uint8Array | undefined {
    return this.layerRaw.get(key);
  }

  /** Is `key` a resident `rgb` image layer? */
  isImage(key: string): boolean {
    return this.imageBytes.has(key);
  }

  /**
   * Install u8 layer `key`: `raw` = the n×n chunk image, `apron` = its (n+2)² apron image
   * (layerApron.ts) with side `side`, built with neighbour mask `mask`.
   */
  addLayer(key: string, raw: Uint8Array, apron: Uint8Array, side: number, mask = 0): void {
    const tex = new DataTexture(apron, side, side, RedFormat, UnsignedByteType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.removeLayer(key, false);
    this.layerTextures.set(key, tex);
    this.layerRaw.set(key, raw);
    this.layerApronMask.set(key, mask);
    this.afterLayerChange(key);
  }

  /** Replace the apron image of u8 layer `key` (a neighbour arrived); same side as before. */
  updateLayerApron(key: string, apron: Uint8Array, mask: number): void {
    const t = this.layerTextures.get(key) as DataTexture | undefined;
    if (!t || !this.layerRaw.has(key)) return;
    t.image.data = apron;
    t.needsUpdate = true;
    this.layerApronMask.set(key, mask);
  }

  /** Edges / size / apron mask of resident image layer `key`. */
  imageInfo(key: string): { size: number; edges: ImageEdges; mask: number } | undefined {
    return this.images.get(key);
  }

  /** The GPU texture of layer `key` (for apron patches). */
  texture(key: string): Texture | undefined {
    return this.layerTextures.get(key);
  }

  /**
   * Install `rgb` image layer `key` (F13/F14) from its (P+2)² apron canvas (imageApron.ts): sRGB
   * colour texture (sampled as linear by the GPU, converted back in the shader), mipmaps +
   * anisotropy because it is seen obliquely, row 0 = north (no flip). The canvas is released after
   * the upload; later apron patches go straight to the GPU texture. Never set `needsUpdate` on it
   * again: after a WebGL context loss Terrain drops and re-streams image layers instead.
   */
  addImage(key: string, canvas: OffscreenCanvas, size: number, edges: ImageEdges, mask: number, anisotropy = 1): void {
    const tex = new Texture(canvas as unknown as HTMLCanvasElement);
    tex.colorSpace = SRGBColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    tex.anisotropy = anisotropy;
    tex.onUpdate = () => {
      // Uploaded (mipmaps are built on the GPU): the CPU copy is no longer needed.
      canvas.width = canvas.height = 1;
      tex.onUpdate = null;
    };
    tex.needsUpdate = true;
    this.removeLayer(key, false);
    this.layerTextures.set(key, tex);
    this.imageBytes.set(key, imageGpuBytes(size + 2));
    this.images.set(key, { size, edges, mask });
    this.afterLayerChange(key);
  }

  /** Record that apron side(s) `bits` of image `key` now hold neighbour data. */
  markImageApron(key: string, bits: number): void {
    const im = this.images.get(key);
    if (im) im.mask |= bits;
  }

  /** Dispose layer `key` (memory pressure / not displayed). */
  removeLayer(key: string, rebind = true): void {
    const t = this.layerTextures.get(key);
    if (!t) return;
    t.dispose();
    this.layerTextures.delete(key);
    this.layerRaw.delete(key);
    this.imageBytes.delete(key);
    this.images.delete(key);
    this.layerApronMask.delete(key);
    if (rebind) this.afterLayerChange(key);
  }

  private afterLayerChange(key: string): void {
    if (this.slotA === key || this.slotB === key) this.bindLayers(this.slotA, this.slotB);
    if (this.slotC === key) this.bindLens(key);
    if (key === BLDG_KEY) this.bindBuildingMask();
  }

  /** R0.7: hand the `bldg` mask (if resident) to the canopy shader, which drops canopy over buildings. */
  private bindBuildingMask(): void {
    if (!this.canopy) return;
    const t = this.layerTextures.get(BLDG_KEY);
    this.canopy.uniforms.uBldg.value = t ?? DUMMY_U8;
    this.canopy.uniforms.uHasBldg.value = t ? 1 : 0;
  }

  /**
   * Bind layer textures for the base (slot A) and overlay (slot B) channels.
   * Missing textures set uHasLayer* = 0 → the shader falls back to hillshade / no overlay, or to
   * the stand-in source `altA`/`altB` (1 = live slope) on levels without that layer.
   */
  bindLayers(a: string | null, b: string | null, altA = this.uniforms.uLayerAAlt.value, altB = this.uniforms.uLayerBAlt.value): void {
    this.slotA = a;
    this.slotB = b;
    const ta = a ? this.layerTextures.get(a) : undefined;
    const tb = b ? this.layerTextures.get(b) : undefined;
    this.uniforms.uLayerA.value = ta ?? DUMMY_U8;
    this.uniforms.uHasLayerA.value = ta ? 1 : 0;
    this.uniforms.uLayerB.value = tb ?? DUMMY_U8;
    this.uniforms.uHasLayerB.value = tb ? 1 : 0;
    this.uniforms.uLayerAAlt.value = altA;
    this.uniforms.uLayerBAlt.value = altB;
    this.uniforms.uImgPxA.value = (a && this.images.get(a)?.size) || 1;
    this.uniforms.uImgPxB.value = (b && this.images.get(b)?.size) || 1;
  }

  /** Bind the lens slot C (V2.5); a missing texture → uHasLayerC = 0 (shader: stand-in or hillshade). */
  bindLens(c: string | null, altC = this.uniforms.uLayerCAlt.value): void {
    this.slotC = c;
    const tc = c ? this.layerTextures.get(c) : undefined;
    this.uniforms.uLayerC.value = tc ?? DUMMY_U8;
    this.uniforms.uHasLayerC.value = tc ? 1 : 0;
    this.uniforms.uLayerCAlt.value = altC;
    this.uniforms.uImgPxC.value = (c && this.images.get(c)?.size) || 1;
  }

  /** Back-compat: bind only the base layer. */
  showLayer(key: string | null): void {
    this.bindLayers(key, this.slotB);
  }

  get hasLowpass(): boolean {
    return this.lowpassTex !== null;
  }

  /** Install the low-pass surface (height-image grid, side²) built for `key`. */
  setLowpass(data: Float32Array, key: string, mask = 0): void {
    const side = heightImageSize(this.grid);
    if (data.length !== side * side) throw new Error(`lowpass ${this.key}: ${data.length} samples, expected ${side * side}`);
    if (!this.lowpassTex) {
      this.lowpassTex = heightTexture(data, side);
    } else {
      this.lowpassTex.image.data = data;
      this.lowpassTex.needsUpdate = true;
    }
    this.lowpassKey = key;
    this.lowpassMask = mask;
    this.uniforms.uLowpass.value = this.lowpassTex;
    this.uniforms.uHasLowpass.value = 1;
  }

  clearLowpass(): void {
    this.lowpassTex?.dispose();
    this.lowpassTex = null;
    this.lowpassKey = '';
    this.lowpassMask = 0;
    this.uniforms.uLowpass.value = DUMMY_FLOAT;
    this.uniforms.uHasLowpass.value = 0;
  }

  /** Estimated GPU bytes of this chunk's textures. */
  gpuBytes(): number {
    const side = heightImageSize(this.grid);
    let extra = 0;
    for (const b of this.imageBytes.values()) extra += b;
    return chunkGpuBytes({
      heightSide: side,
      layerSide: this.grid.chunkSize + 2,
      layers: this.layerRaw.size,
      canopy: this.canopy !== null,
      lowpass: this.lowpassTex !== null,
      extraBytes: extra,
    });
  }

  dispose(): void {
    this.heightTexture.dispose();
    for (const t of this.layerTextures.values()) t.dispose();
    this.layerTextures.clear();
    this.layerRaw.clear();
    this.imageBytes.clear();
    this.images.clear();
    this.layerApronMask.clear();
    this.lowpassTex?.dispose();
    this.lowpassTex = null;
    this.mesh.material.dispose();
    this.canopy?.dispose();
    this.canopy = null;
  }
}
