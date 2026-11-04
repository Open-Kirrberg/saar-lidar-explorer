/**
 * Terrain for the standalone viewer: the 1 m DTM crop from scripts/prepare-terrain.py (viewer/public/terrain/),
 * as chunked meshes (128 m) with distance LOD (1/2/4/8 m steps) and skirts against cracks, plus a ground-class
 * splat (lawn / meadow / gravel / sand / cobbles / water / forest, and the 1789 land cover: hay meadow, field, vineyard,
 * kitchen garden, fine parterre sand; KB-I09) with world-scale CC0 textures. The land-cover patterns are baked once
 * into a mipmapped albedo texture (landcoverBake.ts, wave-2 review perf); the per-pixel shader keeps the grass
 * detail, the hard surfaces and the near vine rows.
 *
 * Grid: PixelIsArea, cell centre E = west + (col + 0.5), N = north − (row + 0.5) (meta.json).
 * Local frame: x = E − 381000, y = h, z = −(N − 5465000).
 */
import * as THREE from 'three';
import { E0, N0 } from '@model/frame.ts';
import { PLEASURE_GROUND, VINEYARD } from '@model/layout/grammar.ts';
import { DIST_SCALE, FIELD_DIR, GROUND_CLASS, MAX_PARCEL_SEGMENTS, fieldBlockDirs, gridNormal, meanDownslope, noiseLattice, packGround, ringSegments, smoothWeights } from './landcover.ts';
import { FIELD_GLSL, LandBake, VINE_GLSL, WINDROW_MEAN, ZONE_GLSL, ZONE_WARP } from './landcoverBake.ts';
import { type LawnZoneInput, ZONE_SCALE, encodeZone, inRing, lawnZoneField } from './lawnZones.ts';

export interface TerrainMeta {
  grid: { west: number; north: number; east: number; south: number; cell: number; cols: number; rows: number };
  ground: {
    cell: number;
    cols: number;
    rows: number;
    classes: Record<string, { name: string; label_de: string }>;
    /** KB-I96: cells where the tree planners' base ground differs from ground.u8 (landcover.ts plannerBaseGround) */
    plannerBase?: { skip: string[]; runs: [number, number, number, number][] };
  };
  /**
   * ground = summer 1789 (land cover, KB-I09); ground2025 = today's canopy (absent in pre-KB-I09 terrain).
   * The zone package (scripts/export-zone.ts) ships 1789 only: no dtm2025 / ground2025.
   */
  files: { dtm2025?: string; dtm1789: string; ground: string; ground2025?: string };
  /**
   * Absent = float32 little-endian heights and raw ground bytes. The zone package quantises dtm1789
   * (h = offset + v · scale), stores gradient residuals and deflates both files.
   */
  encoding?: { dtm1789?: HeightEncoding; ground?: { compression?: 'deflate' } };
  /** File sizes as stored (zone package): the loading progress when the server sends no Content-Length. */
  bytes?: { dtm1789?: number; ground?: number };
  attribution: string;
  h_range: [number, number];
}

/**
 * uint16 heights: h = offset + v · scale; v = nodata → NaN. `predictor: 'gradient'`: the file holds
 * r = v − (left + up − upLeft) mod 2¹⁶ (outside the grid = 0; scripts/zone/package.ts gradientResidual).
 * `compression: 'deflate'`: the file is a zlib stream (loadTerrain inflates it while it downloads).
 */
export interface HeightEncoding {
  dtype: 'uint16';
  offset: number;
  scale: number;
  nodata: number;
  predictor?: 'gradient';
  compression?: 'deflate';
}

export type TerrainEpoch = '1789' | '2025';

export class TerrainData {
  constructor(
    public meta: TerrainMeta,
    public h1789: Float32Array,
    public h2025: Float32Array,
    public ground1789: Uint8Array,
    public ground2025: Uint8Array = ground1789,
  ) {}
  epoch: TerrainEpoch = '1789';
  get h(): Float32Array {
    return this.epoch === '1789' ? this.h1789 : this.h2025;
  }
  /** Ground classes of the current epoch (1789 land cover or today's canopy). */
  get ground(): Uint8Array {
    return this.epoch === '1789' ? this.ground1789 : this.ground2025;
  }
  /** Bilinear height at local (x, z); NaN outside. */
  sample = (x: number, z: number): number => {
    const g = this.meta.grid;
    const E = x + E0;
    const N = N0 - z;
    const c = (E - g.west) / g.cell - 0.5;
    const r = (g.north - N) / g.cell - 0.5;
    if (c < 0 || r < 0 || c > g.cols - 1 || r > g.rows - 1) return NaN;
    const c0 = Math.min(g.cols - 2, Math.floor(c));
    const r0 = Math.min(g.rows - 2, Math.floor(r));
    const fc = c - c0;
    const fr = r - r0;
    const h = this.h;
    const i = r0 * g.cols + c0;
    const a = h[i] + (h[i + 1] - h[i]) * fc;
    const b = h[i + g.cols] + (h[i + g.cols + 1] - h[i + g.cols]) * fc;
    return a + (b - a) * fr;
  };
  /** Grid cell value (row, col) clamped. */
  at(r: number, c: number): number {
    const g = this.meta.grid;
    r = Math.max(0, Math.min(g.rows - 1, r));
    c = Math.max(0, Math.min(g.cols - 1, c));
    return this.h[r * g.cols + c];
  }
  /** Local x/z of a cell centre. */
  cellX(c: number): number {
    return this.meta.grid.west + (c + 0.5) * this.meta.grid.cell - E0;
  }
  cellZ(r: number): number {
    return -(this.meta.grid.north - (r + 0.5) * this.meta.grid.cell - N0);
  }
}

/**
 * Height grid from its (inflated) file bytes: float32 (no encoding) or uint16 per `enc`, with the gradient predictor
 * undone row by row (`cols` = grid columns); checks the cell count.
 */
export function decodeHeights(buf: ArrayBuffer, cells: number, enc?: HeightEncoding, cols = cells): Float32Array {
  if (!enc) {
    if (buf.byteLength !== cells * 4) throw new Error(`terrain: float32 grid has ${buf.byteLength} B, expected ${cells * 4}`);
    return new Float32Array(buf);
  }
  if (enc.dtype !== 'uint16' || !Number.isFinite(enc.offset) || !(enc.scale > 0) || (enc.predictor !== undefined && enc.predictor !== 'gradient')) {
    throw new Error(`terrain: unsupported height encoding ${JSON.stringify(enc)}`);
  }
  if (buf.byteLength !== cells * 2) throw new Error(`terrain: uint16 grid has ${buf.byteLength} B, expected ${cells * 2}`);
  const v = new Uint16Array(buf);
  if (enc.predictor === 'gradient') {
    if (!(cols > 0) || cells % cols) throw new Error(`terrain: ${cells} cells are not rows of ${cols}`);
    // in place: v[i] = r + left + up − upLeft (mod 2¹⁶ by the Uint16Array store); the left/up cells are already restored
    for (let c = 1; c < cols; c++) v[c] += v[c - 1];
    for (let i0 = cols; i0 < cells; i0 += cols) {
      v[i0] += v[i0 - cols];
      for (let i = i0 + 1, end = i0 + cols; i < end; i++) v[i] += v[i - 1] + v[i - cols] - v[i - cols - 1];
    }
  }
  const h = new Float32Array(cells);
  for (let i = 0; i < cells; i++) h[i] = v[i] === enc.nodata ? NaN : enc.offset + v[i] * enc.scale;
  return h;
}

/** A response body as bytes, counted per network chunk (`onChunk`), inflated on the fly if `deflate`. */
async function readBody(r: Response, deflate: boolean, onChunk: (bytes: number) => void): Promise<ArrayBuffer> {
  if (!r.body) {
    const b = await r.arrayBuffer();
    onChunk(b.byteLength);
    return deflate ? new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer() : b;
  }
  const counted = r.body.pipeThrough(
    new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
      transform(chunk, out) {
        onChunk(chunk.byteLength);
        out.enqueue(chunk);
      },
    }),
  );
  return new Response(deflate ? counted.pipeThrough(new DecompressionStream('deflate')) : counted).arrayBuffer();
}

const mbDe = (b: number): string => (b / 1e6).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Loading-screen step of the terrain download: 0.05 → 0.25 by bytes, German label; null while the size is unknown. */
export function terrainProgress(loaded: number, total: number): { label: string; fraction: number } | null {
  if (!(total > 0)) return null;
  const f = Math.min(1, Math.max(0, loaded / total));
  return { label: `Lade Gelände … ${mbDe(loaded)} von ${mbDe(total)} MB`, fraction: 0.05 + 0.2 * f };
}

export interface LoadTerrainOptions {
  signal?: AbortSignal;
  with2025?: boolean;
  /** Download progress of the grids (after meta.json): bytes so far and in total (meta `bytes` or Content-Length; 0 = unknown). */
  onBytes?: (loaded: number, total: number) => void;
}

/**
 * Terrain of the viewer (viewer/public/terrain/) or of the zone package (<zone>/terrain/). Loads 1789 only unless
 * `with2025` (the 2025 grids then stand in for themselves, else h2025 / ground2025 = the 1789 arrays).
 */
export async function loadTerrain(base = './terrain/', opts: LoadTerrainOptions = {}): Promise<TerrainData> {
  const get = async (file: string): Promise<Response> => {
    const r = await fetch(`${base}${file}`, { signal: opts.signal });
    if (!r.ok) throw new Error(`terrain: ${base}${file} → HTTP ${r.status}`);
    return r;
  };
  const meta = (await (await get('meta.json')).json()) as TerrainMeta;
  const f = meta.files;
  const want2025 = opts.with2025 === true;
  if (want2025 && !f.dtm2025) throw new Error(`terrain: ${base}meta.json has no dtm2025 (zone package = 1789 only)`);
  const known = meta.bytes ?? {};
  let loaded = 0;
  // known sizes count from the start (no jump when a second header arrives); others add their Content-Length
  let total = (known.dtm1789 ?? 0) + (known.ground ?? 0);
  const report = () => opts.onBytes?.(loaded, Math.max(total, loaded));
  const buf = async (file: string | undefined, deflate = false, size?: number): Promise<ArrayBuffer | null> => {
    if (!file) return null;
    const r = await get(file);
    if (size === undefined) total += Number(r.headers.get('content-length')) || 0;
    report();
    return readBody(r, deflate, (n) => {
      loaded += n;
      report();
    });
  };
  const [a, b, c, d] = await Promise.all([
    buf(f.dtm1789, meta.encoding?.dtm1789?.compression === 'deflate', known.dtm1789),
    buf(want2025 ? f.dtm2025 : undefined),
    buf(f.ground, meta.encoding?.ground?.compression === 'deflate', known.ground),
    buf(want2025 ? f.ground2025 : undefined),
  ]);
  const cells = meta.grid.cols * meta.grid.rows;
  const h1789 = decodeHeights(a!, cells, meta.encoding?.dtm1789, meta.grid.cols);
  const g1789 = new Uint8Array(c!);
  return new TerrainData(meta, h1789, b ? decodeHeights(b, cells) : h1789, g1789, d ? new Uint8Array(d) : g1789);
}

/**
 * Ground colours (backlog KB-I14 / KB-I09, research/11 S15 and G19), sRGB albedo of the class average:
 * - gravel (paths, avenues, drives; also under buildings): Buntsandstein grit, pinkish ochre `#B79A84`
 *   [I hue; N d'Argenville for grit courts];
 * - sand (riding court, and the Ehrenhof via `sandCourts`): court sand `#C9B48E` [I; D Le Clerc 1790 shows a bare
 *   light forecourt; look-and-period.md §6 "a light sand court as in Le Clerc"]. Wave-1 review: the Ehrenhof in grit
 *   read as a salmon clay court;
 * - fine parterre sand `#D3BE8A` (ground class 12, feature surface "fine sand") [N d'Argenville; I hue];
 * - cobbles: the catalogue's `ground.cobbles` `#9D8F7D` [I];
 * - July hay meadow (class 11): standing grass `#88A05E` (wave 9: was `#8FA060`, read yellow at 17:30) and cut, drying hay `#B9B07A` in windrows along each
 *   parcel's long axis, at ≤ 10 % value contrast (wave-2 review; the contour-line windrows read as a map)
 *   [I hues, research/11 S15; N mowing practice];
 * - fields (class 8), three-field rotation in July [N Dreifelderwirtschaft]: ripe winter grain gold `#C8B060`
 *   (research/11 S1), summer grain still green-yellow `#A9AA62`, fallow / clover `#8A9757`, cut stubble `#D2C28C` [I];
 *   wave 11 (KB-I84, audit #2: three crop tones in strips from the air): ripe spelt straw gold `#C2A86A` (wave-11
 *   review fix: `#C69D58` turned orange in the Kino grade), oats still blue-green `#86985E`, clover in the fallow deep
 *   green `#5D7A40`, the freshly ploughed fallow brown Buntsandstein soil `#7E6852` (darker and less red than the hoed
 *   vineyard soil) [N crops; I hues]; one crop per Gewann block (landcover.ts fieldCropOf);
 * - vineyard (class 9): vine rows `#7A9C4C` 1.1 m apart down the slope over hoed red-brown Buntsandstein soil `#A0684E`
 *   (PV "red-brown vine rows"); from afar the July area average, ~58 % leaf (landcoverBake.ts VINE_GLSL) [D PV; N/I
 *   research/11 S10]. Wave 3: the leaf `#5E7A34`, then `#6A8A3C` over greyed `#8C6A52` soil, read as a cloud shadow
 *   from the air (area luminance 0.15 against 0.32 for the hay around it); now ≈ 0.21 and warmer [I];
 * - kitchen gardens (class 10): beds 1.4 m with 0.5 m paths in quarters, dark soil `#5E4A3A` [N Sckell; I hues].
 * - meadow / pasture (class 0, July): `#717C4C` mid green with seed heads, patches of drier, seeding grass `#8A8A55`
 *   and lusher grass `#5E7444` in damp hollows, by the water and in the forest's shade [I hues; N research/11 §3.1];
 * - lawn (class 1, Petri's lawn, parterre panels): a scythed meadow-lawn, not a sown turf — "brighter and finer than
 *   the meadow" (research/11 S15) but muted: `#738750` with drier, yellower patches `#7E8A52` [N scythe-mown lawns
 *   of the 1780s; I hues] (wave-3 review: the old lawn read neon);
 * - trodden ground `#8B7D62` (verges of paths and courts, desire paths across the pasture), dusty field tracks
 *   `#A08D6D`, grass balks and headlands `#7D8351` [I hues; N].
 * Tones are tuned against the calibrated light (look owner, KB-I06), not against flat light.
 */
export const GROUND_COLOURS = {
  gravel: '#B79A84',
  sand: '#C9B48E',
  parterreSand: '#D3BE8A',
  cobbles: '#9D8F7D',
  hayGreen: '#88A05E',
  hayStraw: '#B9B07A',
  fieldGold: '#C8B060',
  fieldGreen: '#A9AA62',
  fallow: '#8A9757',
  stubble: '#D2C28C',
  spelt: '#C2A86A',
  oats: '#86985E',
  clover: '#5D7A40',
  plough: '#7E6852',
  vine: '#7A9C4C',
  soil: '#A0684E',
  gardenSoil: '#5E4A3A',
  meadow: '#717C4C',
  meadowDry: '#8A8A55',
  meadowLush: '#5E7444',
  lawn: '#738750',
  lawnDry: '#7E8A52',
  worn: '#8B7D62',
  track: '#A08D6D',
  balk: '#7D8351',
} as const;

function dataTexture(data: Uint8Array, cols: number, rows: number, mips = false): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  // mipmapped where the per-pixel shader samples it over the whole frame (no shimmer, cache-friendly far away)
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mips;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** Unit direction of the longest edge of a ring (the court's long axis) and the ring's vertex centroid. */
export function ringAxis(ring: readonly (readonly [number, number])[]): { dir: [number, number]; centre: [number, number] } {
  let best = 0;
  let dir: [number, number] = [1, 0];
  let cx = 0;
  let cz = 0;
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % n];
    const l = Math.hypot(x1 - x0, z1 - z0);
    if (l > best) {
      best = l;
      dir = [(x1 - x0) / l, (z1 - z0) / l];
    }
    cx += x0;
    cz += z0;
  }
  return { dir, centre: [cx / Math.max(1, n), cz / Math.max(1, n)] };
}

/** KB-I45: half length (m) of a court ring along its axis through `centre` (largest |projection| of a vertex). */
export function courtHalfLength(ring: readonly (readonly [number, number])[], axis: { dir: readonly [number, number]; centre: readonly [number, number] }): number {
  let h = 0;
  for (const [x, z] of ring) h = Math.max(h, Math.abs((x - axis.centre[0]) * axis.dir[0] + (z - axis.centre[1]) * axis.dir[1]));
  return h;
}

/**
 * Macro factor of a hard-surface cell (1 = plain) [I, P12 ground detail]: damp, darker edges along the plinths (the
 * cell next to a building) and a compacted, darker carriage lane along a court's long axis (gate → portal).
 */
export function courtMacro(distToBuildingCells: number, distToLaneM: number): number {
  const damp = distToBuildingCells === 1 ? 0.86 : distToBuildingCells === 2 ? 0.96 : 1;
  const lane = 1 - 0.07 * Math.max(0, 1 - Math.max(0, distToLaneM - 1.5) / 2.5);
  return damp * lane;
}

/**
 * Splat textures of the current epoch's ground classes (see landcover.ts packGround for the channels). The class
 * weights use the blurred-weight encoding (landcover.ts smoothWeights): their 0.5 iso-line is a smooth curve instead
 * of the 2 m raster staircase, and the shaders re-sharpen around it.
 */
function groundTextures(t: TerrainData, sandCourts: readonly (readonly (readonly [number, number])[])[] = [], lawnZones?: LawnZoneInput): Record<'weights' | 'hard' | 'cult' | 'macro' | 'dist', THREE.DataTexture> {
  const g = t.meta.ground;
  const grid = t.meta.grid;
  const cellX = (c: number) => grid.west + (c + 0.5) * g.cell - E0;
  const cellZ = (r: number) => -(grid.north - (r + 0.5) * g.cell - N0);
  const courts = sandCourts.map((ring) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    return { ring, x0, x1, z0, z1, ...ringAxis(ring) };
  });
  const court = (i: number): number | null => {
    if (!courts.length) return null;
    const x = cellX(i % g.cols);
    const z = cellZ(Math.floor(i / g.cols));
    let lane: number | null = null;
    for (const ct of courts) {
      if (x < ct.x0 || x > ct.x1 || z < ct.z0 || z > ct.z1 || !inRing(x, z, ct.ring)) continue;
      // distance to the long axis through the centre
      lane = Math.abs((x - ct.centre[0]) * ct.dir[1] - (z - ct.centre[1]) * ct.dir[0]);
    }
    return lane;
  };
  const p = packGround({ ground: t.ground, cols: g.cols, rows: g.rows, cell: g.cell }, court, courtMacro);
  // wave 10 (garden, audit #1): macro B = the mowing zones of the meadow-lawn (lawnZones.ts; 128 + 8 · signed distance,
  // negative = close-mown); without zones every lawn cell is close-mown (0)
  if (lawnZones) {
    const zf = lawnZoneField({ ground: t.ground, cols: g.cols, rows: g.rows, cell: g.cell, x0: cellX(0), z0: cellZ(0) }, lawnZones);
    for (let i = 0; i < zf.length; i++) p.macro[i * 4 + 2] = encodeZone(zf[i]);
  }
  return {
    weights: dataTexture(smoothWeights(p.weights, g.cols, g.rows, 1, true), g.cols, g.rows, true),
    hard: dataTexture(p.hard, g.cols, g.rows), // only the mix inside hard surfaces: raw is enough
    // mipmapped: the terrain shader reads the field weight per pixel over the whole frame (strip lines)
    cult: dataTexture(smoothWeights(p.cult, g.cols, g.rows, 1, true), g.cols, g.rows, true),
    macro: dataTexture(p.macro, g.cols, g.rows),
    dist: dataTexture(p.dist, g.cols, g.rows),
  };
}

/** Mean linear RGB of an image (16×16 sample), so a texture can carry detail around a documented mean colour. */
function meanLinearRgb(img: CanvasImageSource): THREE.Vector3 {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return new THREE.Vector3(0.5, 0.5, 0.5);
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    const lin = (v: number) => THREE.ColorManagement.colorSpaceToWorking(new THREE.Color(v, v, v), THREE.SRGBColorSpace).r;
    const m = new THREE.Vector3();
    for (let i = 0; i < d.length; i += 4) m.add(new THREE.Vector3(lin(d[i] / 255), lin(d[i + 1] / 255), lin(d[i + 2] / 255)));
    return m.multiplyScalar(4 / d.length).max(new THREE.Vector3(0.02, 0.02, 0.02));
  } catch {
    return new THREE.Vector3(0.5, 0.5, 0.5);
  }
}

export interface TerrainMaterialOptions {
  textureBase?: string;
  /** courts (local [x, z] rings) drawn as court sand with raking, wheel tracks and edge wear (the Ehrenhof) */
  sandCourts?: [number, number][][];
  /** palace-grid +u axis as a local [x, z] unit vector (field strips, kitchen-garden beds); default az 80.5° */
  gridU?: [number, number];
  /** renderer for the one-off land-cover bake (without it the land cover shows as plain meadow) */
  renderer?: THREE.WebGLRenderer;
  /** bake texel (m); 1 by default */
  bakeCell?: number;
  /**
   * vineyard outlines (local [x, z] rings of the catalogue `landcover` areas with cover 'vineyard'): the bake draws the
   * staked-out parcel edge from them instead of the blurred class raster (wave-3 review fix)
   */
  vineyards?: [number, number][][];
  /** wave 10: mowing zones of the meadow-lawn (HG-01): close-mown pleasure ground vs aftermath meadow (lawnZones.ts) */
  lawnZones?: LawnZoneInput;
}

let noiseTex: THREE.DataTexture | null = null;
/** Shared value-noise lattice for the splat shader (landcover.ts noiseLattice), mipmapped, repeating. */
function noiseTexture(): THREE.DataTexture {
  if (!noiseTex) {
    noiseTex = new THREE.DataTexture(noiseLattice(256, 1789), 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
    noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
    noiseTex.magFilter = THREE.LinearFilter;
    noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
    noiseTex.generateMipmaps = true;
    noiseTex.colorSpace = THREE.NoColorSpace;
    noiseTex.needsUpdate = true;
  }
  return noiseTex;
}

/** Terrain material: MeshStandardMaterial with a splat patch (world-UV textures, ground classes). */
export function terrainMaterial(t: TerrainData, opts: TerrainMaterialOptions = {}): THREE.MeshStandardMaterial {
  const loader = new THREE.TextureLoader();
  const load = (set: string, srgb = true, onLoad?: (t: THREE.Texture) => void, anisotropy = 8) => {
    const x = loader.load(`${opts.textureBase ?? './textures/'}${set}/diff.jpg`, onLoad);
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    x.anisotropy = anisotropy;
    return x;
  };
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  m.name = 'terrain';
  const g = t.meta.ground;
  const gt = groundTextures(t, opts.sandCourts ?? [], opts.lawnZones);
  const courtAxis = opts.sandCourts?.length ? ringAxis(opts.sandCourts[0]) : { dir: [1, 0] as [number, number], centre: [0, 0] as [number, number] };
  // KB-I45 (wave 8): the axis points from the gate (W) to the portal (E), and the half length places the coaches'
  // turning ground in front of the portal
  if (courtAxis.dir[0] < 0) courtAxis.dir = [-courtAxis.dir[0], -courtAxis.dir[1]];
  const courtHalf = courtHalfLength(opts.sandCourts?.[0] ?? [], courtAxis);
  const linear = (hex: string) => {
    const c = new THREE.Color(hex);
    return new THREE.Vector3(c.r, c.g, c.b);
  };
  const gravelMean = { value: new THREE.Vector3(0.5, 0.5, 0.5) };
  const grassMean = { value: new THREE.Vector3(0.12, 0.16, 0.06) };
  let bake: LandBake | null = null;
  const rebake = () => {
    if (bake && opts.renderer) bake.render(opts.renderer);
  };
  const gu = opts.gridU ?? [0.98629, -0.16505];
  const vineDir = meanDownslope({ ground: t.ground1789, cols: g.cols, rows: g.rows, cell: g.cell, west: t.meta.grid.west, north: t.meta.grid.north }, GROUND_CLASS.vineyard, (x, z) => {
    const e = t.epoch;
    t.epoch = '1789';
    const h = t.sample(x, z);
    t.epoch = e;
    return h;
  }, E0, N0) ?? [1, 0];
  const C = GROUND_COLOURS;
  const vineSeg = vineSegments(opts.vineyards ?? []);
  const uniforms = {
    tWeights: { value: gt.weights },
    tHard: { value: gt.hard },
    tCult: { value: gt.cult },
    tMacro: { value: gt.macro },
    tDist: { value: gt.dist },
    uDistScale: { value: 255 / DIST_SCALE },
    tGrass: {
      value: load('grass', true, (x) => {
        grassMean.value.copy(meanLinearRgb(x.image as CanvasImageSource));
        rebake(); // the meadow and lawn tones are baked relative to the grass texture's mean
      }, 4), // anisotropy 4: two taps per pixel over most of the frame (wave-2 review perf)
    },
    // two gravel taps per pixel (repeat breakup): anisotropy 4 keeps grazing courts sharp enough at half the fetches
    tGravel: { value: load('gravel', true, (x) => (gravelMean.value = meanLinearRgb(x.image as CanvasImageSource)), 4) },
    tNoise: { value: noiseTexture() },
    uGravelMean: gravelMean,
    uGrassMean: grassMean,
    uGravelCol: { value: linear(C.gravel) },
    uSandCol: { value: linear(C.sand) },
    uParterreCol: { value: linear(C.parterreSand) },
    uCobbleCol: { value: linear(C.cobbles) },
    uHayGreen: { value: linear(C.hayGreen) },
    uHayStraw: { value: linear(C.hayStraw) },
    uFieldGold: { value: linear(C.fieldGold) },
    uFieldGreen: { value: linear(C.fieldGreen) },
    uFallow: { value: linear(C.fallow) },
    uStubble: { value: linear(C.stubble) },
    uSpelt: { value: linear(C.spelt) },
    uOats: { value: linear(C.oats) },
    uClover: { value: linear(C.clover) },
    uPlough: { value: linear(C.plough) },
    // wave 11 (KB-I84): the strips of each field block run along its contour (landcover.ts fieldBlockDirs)
    tFieldDir: { value: fieldDirTexture(t, gu) },
    uVine: { value: linear(C.vine) },
    uSoil: { value: linear(C.soil) },
    uGardenSoil: { value: linear(C.gardenSoil) },
    uMeadow: { value: linear(C.meadow) },
    uMeadowDry: { value: linear(C.meadowDry) },
    uMeadowLush: { value: linear(C.meadowLush) },
    uLawn: { value: linear(C.lawn) },
    uLawnDry: { value: linear(C.lawnDry) },
    uWorn: { value: linear(C.worn) },
    uTrack: { value: linear(C.track) },
    uBalk: { value: linear(C.balk) },
    uGroundOrigin: { value: new THREE.Vector2(t.meta.grid.west - E0, -(t.meta.grid.north - N0)) },
    uGroundSize: { value: new THREE.Vector2(g.cols * g.cell, g.rows * g.cell) },
    uShowClasses: { value: 1 },
    /** wave 11: m per pixel along a grid axis below which the Gewann lines are drawn (A/B: 0 = none) */
    uFieldGate: { value: 6 },
    // raking and wheel tracks run along the court's long axis (gate → portal)
    uCourtDir: { value: new THREE.Vector2(courtAxis.dir[0], courtAxis.dir[1]) },
    uCourtC: { value: new THREE.Vector2(courtAxis.centre[0], courtAxis.centre[1]) },
    uCourtHalf: { value: courtHalf },
    uGridU: { value: new THREE.Vector2(gu[0], gu[1]) },
    // vineyard rows run down the slope: the stripe coordinate runs across it (along the contour)
    uVineAcross: { value: new THREE.Vector2(-vineDir[1], vineDir[0]) },
    uVineSeg: { value: vineSeg.list },
    uVineSegN: { value: vineSeg.n },
    /**
     * KB-I35 (wave 7): distance (m) within which the 3D vine plants stand (viewer/src/vines.ts sets it; 0 = none): there
     * the painted leaf wall turns into the shaded, hoed ground under the plants
     */
    uVinePlants: { value: 0 },
    tLand: { value: neutralLand() as THREE.Texture },
  };
  if (opts.renderer) {
    bake = new LandBake(uniforms, opts.renderer, opts.bakeCell ?? 1);
    uniforms.tLand.value = bake.target.texture;
    rebake();
  }
  m.userData.uniforms = uniforms;
  m.userData.bake = bake;
  /** Re-render the land-cover bake (after changing uShowClasses or a colour uniform). */
  m.userData.rebake = rebake;
  /** Swap the splat textures after an epoch change (1789 land cover ↔ today's canopy). */
  m.userData.refreshGround = () => {
    const nt = groundTextures(t, opts.sandCourts ?? [], opts.lawnZones);
    for (const k of ['weights', 'hard', 'cult', 'macro', 'dist'] as const) {
      const u = uniforms[`t${k[0].toUpperCase()}${k.slice(1)}` as 'tWeights' | 'tHard' | 'tCult' | 'tMacro' | 'tDist'];
      u.value.dispose();
      u.value = nt[k];
    }
    rebake();
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosT;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${SPLAT_COMMON}`).replace('#include <map_fragment>', SPLAT_MAP);
  };
  m.customProgramCacheKey = () => 'terrain-splat-14';
  return m;
}

/** Contour direction per field block (landcover.ts fieldBlockDirs) as a nearest-sampled FIELD_DIR² texture, 1789 heights. */
function fieldDirTexture(t: TerrainData, gu: readonly [number, number]): THREE.DataTexture {
  const g = t.meta.ground;
  const e = t.epoch;
  t.epoch = '1789';
  const dirs = fieldBlockDirs({ ground: t.ground1789, cols: g.cols, rows: g.rows, cell: g.cell, west: t.meta.grid.west, north: t.meta.grid.north }, (x, z) => t.sample(x, z), gu, E0, N0);
  t.epoch = e;
  const tex = new THREE.DataTexture(dirs, FIELD_DIR, FIELD_DIR, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Vineyard outline as a fixed-size vec4 uniform array (landcover.ts ringSegments); n = 0 falls back to the raster. */
function vineSegments(rings: [number, number][][]): { list: THREE.Vector4[]; n: number } {
  const segs = ringSegments(rings);
  if (rings.length && !segs) console.warn(`[terrain] vineyard outline has more than ${MAX_PARCEL_SEGMENTS} edges: class raster used`);
  const list = Array.from({ length: MAX_PARCEL_SEGMENTS }, () => new THREE.Vector4());
  const n = segs ? segs.length / 4 : 0;
  for (let i = 0; i < n; i++) list[i].fromArray(segs!, i * 4);
  return { list, n };
}

/** 1 × 1 stand-in for the land bake (no renderer): meadow-ish albedo, no cultivated weight. */
function neutralLand(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([88, 112, 60, 0]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

const SPLAT_COMMON = /* glsl */ `
varying vec3 vWorldPosT;
uniform sampler2D tWeights; uniform sampler2D tHard; uniform sampler2D tMacro; uniform sampler2D tLand;
uniform sampler2D tGrass; uniform sampler2D tGravel;
uniform vec3 uGravelMean; uniform vec3 uGrassMean;
uniform vec3 uGravelCol; uniform vec3 uSandCol; uniform vec3 uParterreCol; uniform vec3 uCobbleCol;
uniform vec3 uVine; uniform vec3 uSoil;
uniform vec2 uGroundOrigin; uniform vec2 uGroundSize; uniform float uShowClasses; uniform float uFieldGate;
uniform vec2 uCourtDir; uniform vec2 uCourtC; uniform float uCourtHalf; uniform vec2 uVineAcross;
uniform vec4 uVineSeg[${MAX_PARCEL_SEGMENTS}]; uniform int uVineSegN; uniform float uVinePlants;
#define VINE_FADE ${VINEYARD.fade.toFixed(1)}
// KB-I35 (wave 7): distance (m) to the vineyard outline and its closest point (as landcoverBake.ts vineSd; negative
// inside, even-odd rule)
float vineSdT(vec2 p, out vec2 cp){
  float d2 = 1e12;
  bool inside = false;
  cp = p;
  for (int i = 0; i < ${MAX_PARCEL_SEGMENTS}; i++) {
    if (i >= uVineSegN) break;
    vec4 sg = uVineSeg[i];
    vec2 e = sg.zw - sg.xy;
    vec2 w = p - sg.xy;
    vec2 q = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
    if (dot(q, q) < d2) { d2 = dot(q, q); cp = p - q; }
    if ((sg.y > p.y) != (sg.w > p.y) && p.x < e.x * (p.y - sg.y) / e.y + sg.x) inside = !inside;
  }
  return (inside ? -1.0 : 1.0) * sqrt(d2);
}
uniform sampler2D tCult; uniform vec2 uGridU; uniform vec3 uBalk;
// value noise from a 256² random lattice texture: the smoothstep is folded into the coordinate, so one bilinear
// (mipmapped) fetch replaces four ALU hashes (KB-I10: the hash version cost ~10 ms per retina aerial frame)
uniform sampler2D tNoise;
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); return texture2D(tNoise, (i + f*f*(3.0-2.0*f) + 0.5) / 256.0).r; }
// the same at mip 0 (as the bake samples it): the field-strip warp must match the bake exactly
float vnoise0(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); return textureLod(tNoise, (i + f*f*(3.0-2.0*f) + 0.5) / 256.0, 0.0).r; }
// 1 near, 0 where a pattern of this coordinate would alias (fwidth of the coordinate per pixel between a and b)
float aaFade(float coord, float a, float b){ return 1.0 - smoothstep(a, b, fwidth(coord)); }
${VINE_GLSL}
${FIELD_GLSL}
float zn(vec2 p){ return vnoise0(p); }
${ZONE_GLSL}
// the dither moves the edge by at most ±2.1 m (+0.5 m smoothstep) plus the one-sided aerial warp (ZONE_WARP): cells
// farther from it skip the noise fetches
float lawnMeadow(float b, vec2 xz){
  float sd = (b * 255.0 - 128.0) / ${ZONE_SCALE.toFixed(1)};
  if (sd > 2.7 + ${ZONE_WARP[1].toFixed(2)} || sd < -2.7 - ${ZONE_WARP[0].toFixed(2)}) return step(0.0, sd);
  return lawnMeadowAt(b, xz, vnoise(xz / 1.6 + 23.0), vnoise(xz / 7.0 + 5.0));
}
`;

/**
 * Per-pixel splat. Cost notes (wave-3 ground review): one land-bake fetch, one class-weight fetch (mipmapped), and
 * grass detail only where it resolves: the 2 m grass tap within ~150 m of the camera, the 23 m tap within ~700 m;
 * beyond that the bake carries all variation (an aerial frame mostly takes no grass taps). The hard-surface weight
 * is the blurred-weight encoding re-sharpened at 0.5 with a pixel-footprint width, frayed by the grass grain near the
 * camera (turf creeping into the gravel) instead of a 2 m staircase.
 */
const SPLAT_MAP = /* glsl */ `{
  vec2 xz = vWorldPosT.xz;
  vec2 guv = (xz - uGroundOrigin) / uGroundSize;
  float camD = distance(vWorldPosT, cameraPosition);
  // screen derivatives taken in uniform control flow (the strip lines below run in a branch)
  vec2 dxzX = dFdx(xz);
  vec2 dxzY = dFdy(xz);
  // land cover baked once (landcoverBake.ts): sqrt-encoded linear albedo, A = 0.5 cultivated + 1.0 vineyard
  vec4 lc = texture2D(tLand, guv);
  float vineW = clamp(lc.a * 2.0 - 1.0, 0.0, 1.0);
  // class weights (blurred 2 m raster: G field, B vineyard), fetched once for the cultivated pixels with the gradients
  // of the uniform control flow (the field lines below and the vineyard edge band use it)
  vec4 cultT = vec4(0.0);
  if (lc.a > 0.005) cultT = textureGrad(tCult, guv, dxzX / uGroundSize, dxzY / uGroundSize);
  // KB-I35 (wave 7): crisp vineyard edge. The bake draws the staked outline sharp at 1 m texels, but its mip filter
  // smears it over ~10 m at grazing views (pose 11). In the smeared band each side's colour is fetched from beyond the
  // filter footprint on that side of the exact outline (2 fetches, edge pixels only) and the two meet within a pixel.
  // Wave-7 review fix: also in the class raster's edge band (B between 0.02 and 0.98, ±4 m), so the 1.6 m grass
  // headland inside the outline gives way to the rows once a pixel spans more than ~0.1 m (no dashed pale line and no
  // 1 m texel staircase at the parcel edge from afar), and each side is fetched at the pixel's own depth when it lies
  // deeper than the reach
  if (uVineSegN > 0 && ((vineW > 0.002 && vineW < 0.998) || (cultT.b > 0.02 && cultT.b < 0.98))) {
    vec2 cp;
    float sd = vineSdT(xz, cp);
    float fpx = max(length(dxzX), length(dxzY)); // m per pixel
    float reach = 1.5 + 3.0 * fpx;
    if (abs(sd) < reach + 4.0) {
      vec2 outN = (xz - cp) / max(abs(sd), 1e-3) * sign(sd);
      // explicit gradients (the pixel's own footprint): the implicit ones of these per-pixel coordinates jump across
      // the quad where cp changes segment and picked a coarse mip, which drew a dashed pale line inside the outline
      vec2 gX = dxzX / uGroundSize;
      vec2 gY = dxzY / uGroundSize;
      vec4 lcIn = textureGrad(tLand, (cp - outN * max(reach, -sd) - uGroundOrigin) / uGroundSize, gX, gY);
      vec4 lcOut = textureGrad(tLand, (cp + outN * max(reach, sd) - uGroundOrigin) / uGroundSize, gX, gY);
      // KB-I73: beyond the 3D vines the staked edge softens into a 3-5 m feathered, wobbling headland seam (no ruled
      // decal edge from the air); near the camera it stays within a pixel
      float fe = uVinePlants > 0.0 ? smoothstep(uVinePlants, uVinePlants + 60.0, camD) : 1.0;
      // (the seam sits ~2 m inside the outline: the meadow beyond it takes no cultivated fetch)
      float sdw = sd + fe * (2.0 + (vnoise(xz / 7.0 + 3.3) - 0.5) * 2.4);
      float fw = 0.5 * fpx + 0.05 + 2.0 * fe;
      lc = mix(lcIn, lcOut, smoothstep(-fw, fw, sdw));
      vineW = clamp(lc.a * 2.0 - 1.0, 0.0, 1.0);
    }
  }
  vec3 land = lc.rgb * lc.rgb;
  float cultW = clamp(lc.a * 2.0, 0.0, 1.0);
  // grass texture as detail around 1 (its mean is the bake's colour): half chroma on lawn and meadow (wave-3: less
  // neon), luminance grain only on the cultivated classes; faded out where the bake alone resolves the ground
  vec3 det = vec3(1.0);
  float grain = 1.0;
  vec4 wts = texture2D(tWeights, guv);
  // wave 10 (garden, audit #1): the meadow-lawn's aftermath meadow (macro B, lawnZones.ts) beyond the close-mown
  // pleasure ground, with a ragged scythe edge (the same dither as the bake's, landcoverBake.ts ZONE_GLSL)
  float gmz = 0.0;
  if (wts.r > 0.01 && camD < 700.0) gmz = lawnMeadow(texture2D(tMacro, guv).b, xz);
  float lawnZ = clamp(wts.r * 1.6 - 0.3, 0.0, 1.0) * (1.0 - gmz);
  if (camD < 700.0) {
    vec3 gFar = texture2D(tGrass, xz / 23.0).rgb;
    vec3 gr = gFar;
    float nearW = 1.0 - smoothstep(110.0, 150.0, camD);
    if (nearW > 0.0) {
      // two decorrelated near taps (2 m, and 2.9 m rotated 37°): no visible 2 m photo repeat, and single straw
      // scratches of the photo texture lose half their contrast (wave-3 review fix, KB-I45: "tiled photo texture")
      vec3 g2 = mix(texture2D(tGrass, xz / 2.0).rgb, texture2D(tGrass, mat2(0.8, -0.6, 0.6, 0.8) * xz / 2.9 + 0.31).rgb, 0.5);
      gr = mix(gFar, mix(g2, gFar, 0.5), nearW);
    }
    det = mix(gr / uGrassMean, vec3(1.0), smoothstep(450.0, 700.0, camD));
    // wave 8 (audit: the near ground read as a straw-strewn hayfield): the pale blade scratches of the photo texture
    // are the bright tail of its luminance, so that tail is compressed (meadow to 40 %, the mown pleasure-ground lawn
    // to 20 % with less grain overall and a cooler tint), and the lawn gets a fine, isotropic mottling instead [N
    // scythed and rolled lawns of the 1780s, research/11 §4; I amounts]
    float lawnW = lawnZ * (1.0 - smoothstep(0.02, 0.2, lc.a));
    float dl = dot(det, vec3(0.2126, 0.7152, 0.0722));
    // wave-8 review fix (44 / 46 / 47 still read as straw-strewn hay): the pale tail is compressed to 22 % on meadow
    // and hay too; the tonal life it carried comes back as regrowth patches below
    float tail = mix(0.22, 0.2, lawnW);
    det *= (dl > 1.0 ? 1.0 + (dl - 1.0) * tail : dl) / max(dl, 1e-3);
    float lawnNear = lawnW * (1.0 - smoothstep(60.0, 150.0, camD));
    det = mix(det, mix(vec3(1.0), det, 0.6) * vec3(0.975, 1.01, 0.985) * (0.96 + 0.08 * vnoise(xz * 2.7 + 5.0)), lawnNear);
    // wave-8 review fix (16 / 17 / 18 / 33: the lawn bordered on billiard cloth at the frame bottom; 46 / 47 still
    // straw-strewn): a fine, isotropic grain within ~30 m, three octaves (14, 6 and 2.7 cm) on the lawn (short turf),
    // plus a 32 cm octave on meadow and hay (longer grass), each faded before it aliases, with a slight hue split
    // (sunlit blade tips yellow-green, the shaded base blue-green) [N scythed and rolled turf; I amounts]
    // (the pixel footprint comes from the derivatives of the uniform control flow; mip-0 fetches inside the branch)
    float fpL = max(length(dxzX), length(dxzY));
    // meadow and hay near the camera: the photo's blade scratches at half contrast, the procedural grain below instead
    float nearM = (1.0 - lawnW) * (1.0 - smoothstep(25.0, 60.0, camD));
    det = mix(det, mix(vec3(1.0), det, 0.5), nearM);
    if (camD < 32.0) {
      vec2 r1 = mat2(0.8, -0.6, 0.6, 0.8) * xz;
      vec2 r2 = mat2(-0.28, 0.96, -0.96, -0.28) * xz;
      float t1 = (vnoise0(xz * 7.1 + 1.3) - 0.5) * (1.0 - smoothstep(0.25, 0.6, fpL * 7.1));
      float t2 = (vnoise0(r1 * 16.3 + 4.1) - 0.5) * (1.0 - smoothstep(0.25, 0.6, fpL * 16.3));
      float t3 = (vnoise0(r2 * 37.0 + 7.7) - 0.5) * (1.0 - smoothstep(0.25, 0.6, fpL * 37.0));
      // meadow and hay: coarser and stronger (longer grass, seed heads), the same three octaves on the lawn
      float t0 = (vnoise0(r2 * 3.1 + 2.9) - 0.5) * (1.0 - smoothstep(0.25, 0.6, fpL * 3.1));
      float tg = 0.2 * t1 + 0.17 * t2 + 0.15 * t3 + (1.0 - lawnW) * (0.08 * t1 + 0.18 * t0);
      vec3 tint = tg > 0.0 ? mix(vec3(1.0), vec3(1.04, 1.02, 0.9), tg * 4.0) : mix(vec3(1.0), vec3(0.94, 1.0, 1.02), -tg * 4.0);
      det *= mix(vec3(1.0), (1.0 + tg) * tint, 1.0 - smoothstep(20.0, 32.0, camD));
    }
    grain = dot(det, vec3(0.2126, 0.7152, 0.0722));
  }
  // cultivated land: luminance grain at 0.8 (wave-3 review fix: the standing hay near the camera read as mown turf)
  vec3 col = land * mix(mix(det, vec3(grain), 0.5), vec3(mix(1.0, grain, 0.8)), cultW);
  // wave-8 review fix (39 / 44 / 46 read flat, felt-like): meadow and hay get mid-frequency tonal life within ~150 m,
  // patches of darker, greener regrowth (Grummet, 2-6 m) and paler seeding tufts (1-2 m), instead of the straw
  // scratches of the photo texture [N July meadows mown in turns; I amounts]. Not on lawn, fields, vines or hard ground
  if (camD < 160.0) {
    float mw = (1.0 - lawnZ) * (1.0 - smoothstep(0.3, 0.6, cultT.g)) * (1.0 - vineW) * (1.0 - smoothstep(0.3, 0.6, wts.g)) * (1.0 - smoothstep(0.3, 0.6, wts.b)) * (1.0 - smoothstep(110.0, 160.0, camD)) * uShowClasses;
    if (mw > 0.01) {
      float rg = smoothstep(0.52, 0.78, vnoise(xz / 2.3 + 13.1) * 0.6 + vnoise(xz / 6.1 + 3.3) * 0.4);
      float tuft = smoothstep(0.62, 0.85, vnoise(xz / 1.1 + 41.7)) * (1.0 - rg);
      col *= mix(vec3(1.0), mix(vec3(1.0), vec3(0.84, 0.93, 0.8), rg) * mix(vec3(1.0), vec3(1.07, 1.04, 0.93), tuft), mw);
    }
  }
  // wave 10 (garden, audit #1): the scythed aftermath parcels near the camera: straw windrows and swath steps over the
  // bake's mean (aftermathSwath, the same frame as the bake). Wave-10 review fix (02 / 62: the swaths read as ride-on
  // mower stripes from the air): the bake carries only their mean; here they are drawn at full strength while a swath
  // pair (3.4 m) spans ≥ 6 px across and fade to the mean by 3 px (the pixel footprint across the swaths), and in any
  // case between 60 and 110 m: from the air a scythed parcel reads as one paler tone (hand-raked windrows are too
  // low and too uneven to stripe a park seen from 100 m up)
  if (gmz > 0.01 && camD < 110.0) {
    vec2 gVs = vec2(-uGridU.y, uGridU.x);
    float fpA = abs(dot(dxzX, gVs)) + abs(dot(dxzY, gVs));
    float sP = 2.0 * ${PLEASURE_GROUND.swath.toFixed(2)};
    float ns = gmz * (1.0 - smoothstep(sP / 6.0, sP / 3.0, fpA)) * (1.0 - smoothstep(60.0, 110.0, camD)) * uShowClasses;
    // standing seeding grass within the grass-card disc (grassBlades.ts, ≤ 22 m): the ground between the cards is the
    // shaded depth of the sward, darker than the bake's area mean, which the sunlit cards bring back [I]
    float standN = gmz * (1.0 - smoothstep(14.0, 22.0, camD)) * uShowClasses;
    if (ns > 0.01 || standN > 0.01) {
      Swath S = aftermathSwath(xz, uGridU);
      float stP = S.st < 0.45 ? 1.0 : (S.st < 0.8 ? 1.0 - smoothstep(0.6, 1.6, S.edge) : 0.0);
      col *= 1.0 - 0.16 * standN * stP;
      float cutP = step(0.45, S.st) * step(S.st, 0.8) * smoothstep(0.6, 1.6, S.edge);
      // straw windrow (pale, warm) against the cut, greener stubble; alternate swaths ±2.5 % (the cut direction)
      vec3 straw = vec3(1.16, 1.1, 0.86);
      vec3 sw = mix(vec3(1.0 + 0.025 * S.alt), straw, 0.75 * S.wr) / mix(vec3(1.0), straw, 0.75 * ${WINDROW_MEAN.toFixed(2)});
      col *= mix(vec3(1.0), sw, ns * cutP);
    }
  }
  // Gewann strips (wave-3 review fix): balk and furrow lines per pixel, at least ~1 px wide, so the strip pattern
  // holds from 450 m up; they fade where a strip is narrower than ~6-12 px (the bake's crop steps carry it there,
  // no moiré) and end at the headland. Only on field pixels (the cultivated weight of the bake gates the fetch).
  // KB-I59: lines vanish where a strip (≤ 24 m) spans < 6 px, i.e. at ≥ 4 m per pixel across it; the across
  // direction is one of the two grid axes, so far pixels skip the field frame and the tCult fetch exactly
  float fpU = abs(dot(dxzX, uGridU)) + abs(dot(dxzY, uGridU));
  float fpV = abs(dot(dxzX, vec2(-uGridU.y, uGridU.x))) + abs(dot(dxzY, vec2(-uGridU.y, uGridU.x)));
  // wave 11: the strips may run at any angle (contour), so the gate (uFieldGate, 6 m) is looser than the 4 m across a
  // grid axis
  if (cultW > 0.01 && min(fpU, fpV) < uFieldGate) {
    float fW = smoothstep(0.28, 0.72, cultT.g) * uShowClasses;
    if (fW > 0.01) {
      FieldFrame F = fieldFrame(xz, uGridU, vec2(vnoise0(xz / 160.0), vnoise0(xz / 160.0 + 7.3)));
      float fp = max(abs(dot(dxzX, F.acrossDir)) + abs(dot(dxzY, F.acrossDir)), 1e-4); // m per pixel across the strips
      float bd = min(F.fa, F.sw - F.fa);
      float balk = fieldHasBalk(F);
      float hwl = mix(0.22, 0.42, balk); // furrow 0.45 m, grass balk (Rain) 0.85 m [N; I]
      float hwE = max(hwl, 0.6 * fp);
      float ln = 1.0 - smoothstep(hwE - 0.5 * fp, hwE + 0.5 * fp, bd);
      ln *= (1.0 - smoothstep(F.sw / 12.0, F.sw / 6.0, fp)) * mix(1.0, hwl / hwE, 0.4);
      float eb = min(min(F.fb.x, FIELD_B.x - F.fb.x), min(F.fb.y, FIELD_B.y - F.fb.y));
      ln *= smoothstep(2.0, 3.4, eb) * fW; // ends at the 4-6 m headland (landcoverBake.ts)
      vec3 lineC = balk > 0.5 ? uBalk * (0.88 + 0.12 * grain) : col * 0.74;
      col = mix(col, lineC, ln * 0.85);
    }
  }
  // vine rows 1.1 m apart down the slope: analytic near the camera, faded into the baked July average by the pixel
  // footprint (KB-I59, pose 11 moiré): the footprint comes from the derivatives taken above in uniform control flow
  // (the old fwidth / mipmapped noise inside this branch was undefined there), the leaf edges are box-filtered to it,
  // the 1 m plant swelling and the 0.32 m leaf clusters fade before they alias, and the rows themselves are gone at
  // 4 px per row (the edge-filtered pattern is nearly a sine there, so the hand-over to the bake does not shimmer)
  if (vineW > 0.002 && camD < 400.0) {
    float q = dot(xz, uVineAcross) / 1.1;
    vec2 alongDir = vec2(-uVineAcross.y, uVineAcross.x);
    float along = dot(xz, alongDir);
    float pr = abs(dot(dxzX, uVineAcross)) + abs(dot(dxzY, uVineAcross)); // m per pixel across the rows
    float pa = abs(dot(dxzX, alongDir)) + abs(dot(dxzY, alongDir)); // m per pixel along them
    float clump = mix(0.5, vnoise0(vec2(along * 3.1, floor(q) * 7.13)), 1.0 - smoothstep(0.05, 0.12, pa));
    // KB-I35 (wave 7): where the 3D vines stand (vines.ts, within uVinePlants m), the painted leaf wall becomes the
    // shaded, hoed ground under them (the plants carry the leaf); it returns as the plants shrink away, and in part
    // from ~30 m on, where the thin plants cover less than their leaf wall would (sub-pixel coverage) [I]
    float p3 = uVinePlants > 0.0 ? (1.0 - smoothstep(uVinePlants - VINE_FADE, uVinePlants, camD)) * (1.0 - 0.45 * smoothstep(30.0, 110.0, camD)) : 0.0;
    vec3 rows = vineRows(xz, uVineAcross, mix(uVine, uSoil * vec3(0.5, 0.52, 0.5), 0.8 * p3), uSoil, clump, 1.0 - smoothstep(0.08, 0.2, pa), pr);
    rows = mix(rows, vinePathCol(uSoil), vinePath(xz, uVineAcross));
    float f = (1.0 - smoothstep(0.1, 0.25, pr / 1.1)) * vineW * (1.0 - smoothstep(300.0, 400.0, camD));
    col = mix(col, rows * mix(1.0, grain, 0.5), f);
  }
  // KB-I73 (wave-8 review fix: the far parcel read as a flat dark decal): where the analytic rows above have faded, the
  // rows go on as a box-filtered stripe (the leaf walls' share of each pixel along the across-row axis, same phase as
  // the rows and the 3D stakes), faded out before 2 px per row, so the parcel reads as rows over red-brown soil from
  // the air instead of a flat tone [D PV "red-brown vine rows"; I]
  if (vineW > 0.002 && camD < 900.0) {
    float pr1 = (abs(dot(dxzX, uVineAcross)) + abs(dot(dxzY, uVineAcross))) / 1.1; // pixel footprint in rows
    float fs = smoothstep(0.1, 0.25, pr1) * (1.0 - smoothstep(0.32, 0.5, pr1)) * vineW * uShowClasses;
    if (fs > 0.002) {
      float q = dot(xz, uVineAcross) / 1.1;
      const float DUTY = 0.58; // leaf share of the row pitch (VINE_GLSL area average)
      // integral of the leaf indicator (leaf centred on fract = 0.5) from 0 to x
      #define VINE_LEAF_INT(x) (floor(x) * DUTY + clamp(fract(x) - (0.5 - 0.5 * DUTY), 0.0, DUTY))
      float lw = (VINE_LEAF_INT(q + 0.5 * pr1) - VINE_LEAF_INT(q - 0.5 * pr1)) / max(pr1, 1e-3);
      vec3 sc = mix(vineSoil(uSoil), vineLeaf(uVine) * 0.92, lw) / mix(vineSoil(uSoil), vineLeaf(uVine) * 0.92, DUTY);
      col *= mix(vec3(1.0), sc, 0.85 * fs);
    }
  }
  // wave-7 review fix (11, 41): beyond the 3D plants (and in their fade band) the painted parcel takes their far look:
  // the leaf columns hide the soil between the rows at oblique views (VINE_GLSL vineCover), shaded as the 3D plants
  // render (vineCanopy). A tint on the area mean, so the painted rows and the grain keep their modulation; top-down
  // views (cover = the area average) are unchanged
  if (vineW > 0.002) {
    float sinT = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
    vec2 vh = cameraPosition.xz - xz;
    float acrossC = abs(dot(vh, uVineAcross)) / max(length(vh), 1e-3);
    float far3 = uVinePlants > 0.0 ? smoothstep(uVinePlants - VINE_FADE, uVinePlants, camD) : 1.0;
    float kc = clamp((vineCover(sinT, acrossC) - 0.583) / 0.417, 0.0, 1.0) * far3 * vineW;
    // KB-I73 (wave-8 review fix: still a dark decal in 01 / 08 / 11 / 48 / 52): the measured canopy albedo of the 3D
    // plants holds only in the 3D range (at 70 %: the painted band alone read as a cloud shadow at 11); from the middle
    // of the plants' fade band to 40 m beyond the 3D range it cross-fades to the far look: from above,
    // the sunlit leaf tops and the sunlit, dry hoed soil between the rows dominate (the shaded flanks the 3D plants show
    // at the hand-over hide behind them), so the parcel reads red-brown and about as light as the hay around it
    // (≈ 0.27 linear luminance against 0.28-0.30 for the July hay; KB-I73 acceptance ±10 %) [D PV "red-brown vine
    // rows"; I shares]. Without 3D plants (uVinePlants 0) the far look holds everywhere
    float farV = uVinePlants > 0.0 ? smoothstep(uVinePlants - 0.5 * VINE_FADE, uVinePlants + 40.0, camD) : 1.0;
    kc *= 0.7 * (1.0 - farV);
    vec3 vAvg = vineAverage(uVine, uSoil);
    col *= mix(vec3(1.0), vineCanopy(uVine) / vAvg, kc);
    col *= mix(vec3(1.0), mix(vAvg, vineSoil(uSoil), 0.3) * 1.46 / vAvg, farV * vineW);
  }
  // hard surfaces: blurred weight re-sharpened at 0.5 (width = the pixel footprint, at least ~0.4 m)
  float wg = wts.g * uShowClasses;
  float e = clamp(fwidth(wg) * 1.2, 0.07, 0.5);
  float hw = smoothstep(0.5 - e, 0.5 + e, wg + (grain - 1.0) * 0.6 * (0.5 - e));
  col *= 1.0 - hw;
  // hard surfaces are a few % of the crop: fetch their textures only there (coherent branch)
  if (hw > 0.002) {
    // gravel texture normalised to its mean: the documented colour is the average, the texture only adds grain
    vec3 grit0 = texture2D(tGravel, xz / 2.0).rgb / uGravelMean;
    // a second, rotated and scaled tap breaks the 2 m texture repeat (no periodic banding at grazing angles)
    vec3 grit1 = texture2D(tGravel, mat2(0.8, -0.6, 0.6, 0.8) * xz / 3.3 + 0.37).rgb / uGravelMean;
    vec3 grainH = mix(grit0, grit1, 0.5);
    vec4 hard = texture2D(tHard, guv);
    vec4 mac = texture2D(tMacro, guv);
    float mottle = 0.94 + 0.12 * vnoise(xz / 5.0);
    vec3 grit = mix(vec3(1.0), grainH, 0.8) * uGravelCol * mottle;
    vec3 cob = grainH * uCobbleCol;
    vec3 fine = mix(vec3(1.0), grainH, 0.35) * uParterreCol * (0.96 + 0.08 * vnoise(xz / 3.0));
    vec3 sandC = vec3(0.0);
    if (hard.b > 0.002) {
      // court sand: fine raked sand; irregular streaks along the rake direction (no periodic bands), several
      // pairs of wheel tracks along the court axis (gate → portal), worn and damp edges at the plinths [I]
      vec2 rel = xz - uCourtC;
      vec2 rp = vec2(dot(rel, vec2(-uCourtDir.y, uCourtDir.x)), dot(rel, uCourtDir)); // across, along
      // raking: short, irregular tine marks (2-4 m long, wandering) that fade before they alias
      float tine = vnoise(vec2(rp.x * 6.0 + 2.0 * vnoise(rp * 0.4), rp.y * 0.45)) - 0.5;
      float rake = 1.0 + 0.045 * tine * aaFade(rp.x * 6.0, 0.12, 0.45) * smoothstep(0.25, 0.6, vnoise(xz / 6.0 + 4.0));
      // broad patchiness: damp / dry, freshly sanded / trodden (isotropic, 3-15 m)
      float patchy = 0.91 + 0.1 * vnoise(xz / 3.3) + 0.08 * vnoise(xz / 14.0);
      // KB-I45 (wave 8): wear that reads at eye level (03, 09, 14) but stays period and soft, no tram lines. The
      // coaches drive on the cobbled axis lane, so the sand shows what happens beside it [I]:
      //  - two wandering, broken wheel-track bands either side of the causeway (coaches passing and pulling over), each
      //    a pair of 0.5 m packed bands at the 1.48 m gauge, smoother, darker and warmer-grey than the loose sand;
      //  - the turning ground in front of the portal, where the coaches swing round to the perron: a broad packed
      //    sweep (an annulus round a point 11 m W of the portal end), strongest on its outer (gate) side;
      //  - a trodden band beside the causeway (people and horses stepping off it), broken by noise;
      //  - at the wall feet a damp, darker splash strip (2 m cells, bilinear) with moss at the plinth, then pale, dry
      //    drifted dust a little farther out.
      // a broad, calm band of packed sand either side of the causeway (4.5 m off the axis, ~4 m wide), patchy by isotropic
      // 5-9 m noise. Wave 9 (garden, audit #1): the wandering bands with their gauge pair and the long along-axis
      // streaks read as spokes converging on the portal at eye level (03, 09) and as wavy pairs from the air, so the
      // wander is down to ±0.5 m, the gauge pair is gone, all breakup is isotropic and the packed tone is 40 % softer
      float wob = (vnoise(vec2(rp.y * 0.03, 2.3)) - 0.5) * 1.0;
      vec2 lanes = vec2(4.6, -4.9) + wob;
      vec2 la = abs(rp.x - lanes);
      vec2 band = 1.0 - smoothstep(vec2(1.2), vec2(3.2), la + 1.2 * (vec2(vnoise(xz / 4.3), vnoise(xz / 4.7 + 3.0)) - 0.5));
      vec2 on = vec2(smoothstep(0.3, 0.6, vnoise(xz / 8.5 + 5.0)), smoothstep(0.3, 0.6, vnoise(xz / 7.9 + 10.0)));
      float tracks = 0.75 * dot(on, band * (0.6 + 0.3 * vnoise(xz / 3.1 + 7.0)));
      vec2 tc = vec2(0.0, uCourtHalf - 12.0);
      vec2 dr = (rp - tc) * vec2(1.0, 0.8);
      float rr = length(dr);
      float rq = (rr - 8.5) / 4.2;
      float sweep = max(exp(-rq * rq), 0.45 * (1.0 - smoothstep(6.0, 9.0, rr))) * (0.6 + 0.4 * smoothstep(-2.0, 6.0, tc.y - rp.y)) * (0.6 + 0.4 * vnoise(xz / 3.7 + 1.3));
      float trod = (1.0 - smoothstep(2.0, 6.5, abs(rp.x) + 2.5 * (vnoise(xz / 4.1 + 3.7) - 0.5))) * (0.45 + 0.55 * vnoise(xz / 2.3));
      // wave 10 (garden, audit #6: the court floor read as one flat plane): the court is a working surface, raked in
      // sections on different days and trodden in between, so broad 10-30 m patches of fresh, lighter raked sand (crisper
      // tine marks) alternate with darker, smoother trodden sand; the turning sweep in front of the perron and the packed
      // bands beside the causeway are firmer than before [I amounts; N raked court sand, research/07 §3.2]
      float rk = smoothstep(0.38, 0.62, vnoise(xz / 23.0 + 61.0) * 0.7 + vnoise(xz / 8.5 + 67.0) * 0.3);
      rake = 1.0 + (rake - 1.0) * (0.6 + 0.9 * rk);
      patchy *= mix(0.93, 1.05, rk);
      sweep *= 1.25;
      float comp = clamp(max(max(min(tracks * 1.15, 1.0), 0.8 * sweep), 0.5 * trod) + 0.4 * (1.0 - rk) * (0.5 + 0.5 * vnoise(xz / 4.9 + 71.0)), 0.0, 1.0);
      float near = mac.g;
      float splash = smoothstep(0.5, 0.95, near + 0.15 * (vnoise(xz * 0.8 + 2.0) - 0.5));
      float dust = smoothstep(0.2, 0.55, near) * (1.0 - splash) * (0.5 + 0.5 * vnoise(xz * 0.7 + 9.1));
      vec3 sandBase = mix(vec3(1.0), grainH, 0.55 * (1.0 - 0.7 * comp) * (1.0 - 0.5 * dust)) * uSandCol * patchy * mix(rake, 1.0, comp);
      sandBase *= mix(vec3(1.0), vec3(0.86, 0.845, 0.81), comp);
      sandBase *= mix(vec3(1.0), vec3(1.07, 1.06, 1.03), dust);
      float moss = smoothstep(0.9, 1.0, near) * smoothstep(0.35, 0.7, vnoise(xz * 1.3 + 4.0));
      vec3 dampC = mix(sandBase * vec3(0.7, 0.71, 0.66), sandBase * vec3(0.55, 0.62, 0.45), 0.6 * moss);
      sandC = mix(sandBase, dampC, splash * (0.65 + 0.35 * vnoise(xz * 0.9)));
    }
    float hs = max(hard.r + hard.g + hard.b + hard.a, 1e-3);
    // macro factor (R / 2): damp plinth edges, compacted carriage lane
    col += (grit * hard.r + cob * hard.g + sandC * hard.b + fine * hard.a) / hs * (mac.r * 2.0) * hw;
  }
  diffuseColor.rgb *= col;
}`;

const CHUNK = 128;
/** Grid step (cells) and block size (cells, a multiple of the step) of the terrain depth pre-pass (KB-I59 review). */
export const PREPASS_STEP = 8;
export const PREPASS_BLOCK = 512;
/** Extra lowering of the pre-pass surface (m) below the colour terrain, against depth ties on flat ground. */
export const PREPASS_DROP = 0.1;

/** Grid indices 0, step, 2·step, … and always the last index n − 1. */
export function envelopeAxis(n: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += step) out.push(i);
  out.push(n - 1);
  return out;
}

/**
 * Lower bound of the colour terrain on a coarse sub-grid (KB-I59 wave-4 review, depth pre-pass). The coarse mesh uses
 * TerrainMesh's triangulation (diagonal from (col + step, row) to (col, row + step)), whose diagonals are unions of the
 * fine diagonals, so every triangle of a LOD mesh with a step dividing `step` lies inside one coarse triangle, where
 * both are linear. The coarse surface is therefore below every such LOD mesh iff it is below the fine samples. Each
 * vertex keeps its own height lowered by the largest chord excess (coarse plane − sample) of the triangles around it:
 * exact on crests and convex slopes (which are what hides things), lowered only in hollows. Cells cut short by the grid
 * edge (whose diagonal does not line up) cap their corners at the cell minimum. `drop` lowers everything further.
 * Non-finite samples are ignored. Returns heights row-major over `rowsIdx` × `colsIdx`.
 */
export function minEnvelope(h: ArrayLike<number>, cols: number, rows: number, step: number, drop = 0): { rowsIdx: number[]; colsIdx: number[]; z: Float32Array } {
  const rowsIdx = envelopeAxis(rows, step);
  const colsIdx = envelopeAxis(cols, step);
  const nr = rowsIdx.length;
  const nc = colsIdx.length;
  const excess = new Float32Array(nr * nc); // ≥ 0
  const cap = new Float32Array(nr * nc).fill(Infinity);
  for (let i = 0; i < nr - 1; i++) {
    const r0 = rowsIdx[i];
    const r1 = rowsIdx[i + 1];
    for (let j = 0; j < nc - 1; j++) {
      const c0 = colsIdx[j];
      const c1 = colsIdx[j + 1];
      const ia = i * nc + j;
      const ib = ia + 1;
      const ic = ia + nc;
      const ie = ic + 1;
      const ha = h[r0 * cols + c0];
      const hb = h[r0 * cols + c1];
      const hc = h[r1 * cols + c0];
      const he = h[r1 * cols + c1];
      if (r1 - r0 !== step || c1 - c0 !== step || !(Number.isFinite(ha) && Number.isFinite(hb) && Number.isFinite(hc) && Number.isFinite(he))) {
        let m = Infinity;
        for (let r = r0; r <= r1; r++)
          for (let c = c0; c <= c1; c++) {
            const v = h[r * cols + c];
            if (v < m) m = v; // NaN compares false
          }
        for (const k of [ia, ib, ic, ie]) cap[k] = Math.min(cap[k], m);
        continue;
      }
      let e1 = 0;
      let e2 = 0;
      for (let r = r0; r <= r1; r++) {
        const v = (r - r0) / step;
        for (let c = c0; c <= c1; c++) {
          const hs = h[r * cols + c];
          if (!Number.isFinite(hs)) continue;
          const u = (c - c0) / step;
          if (u + v <= 1) e1 = Math.max(e1, ha + (hb - ha) * u + (hc - ha) * v - hs);
          if (u + v >= 1) e2 = Math.max(e2, he + (hc - he) * (1 - u) + (hb - he) * (1 - v) - hs);
        }
      }
      excess[ia] = Math.max(excess[ia], e1);
      excess[ib] = Math.max(excess[ib], e1, e2);
      excess[ic] = Math.max(excess[ic], e1, e2);
      excess[ie] = Math.max(excess[ie], e2);
    }
  }
  const z = new Float32Array(nr * nc);
  for (let i = 0; i < nr; i++)
    for (let j = 0; j < nc; j++) {
      const k = i * nc + j;
      const hv = h[rowsIdx[i] * cols + colsIdx[j]];
      const v = Math.min(Number.isFinite(hv) ? hv - excess[k] : Infinity, cap[k]);
      // float32 rounding of the stored heights: keep a hair below
      z[k] = Number.isFinite(v) ? v - drop - 1e-3 : 0;
    }
  return { rowsIdx, colsIdx, z };
}

/** Chunked LOD terrain. Call update(camera) every frame. */
export class TerrainMesh {
  group = new THREE.Group();
  private chunks: { r0: number; c0: number; mesh: THREE.Mesh | null; step: number; centre: THREE.Vector3; cache: Map<number, THREE.BufferGeometry> }[] = [];
  triangles = 0;
  /**
   * Depth-only pre-pass (KB-I59): with the colour pass drawn after the trees and buildings, the terrain must still hide
   * what stands behind a hill before it is shaded. Wave-4 review (CPU): not a second copy of every 128 m chunk
   * (+80–120 draw calls and ~360 more scene objects) but a static lower bound of the DTM on an 8 m grid
   * (`minEnvelope`, exact on crests) in 512 m blocks, drawn first (render order −1) and pushed back by a polygon
   * offset. It lies below every LOD of the colour terrain, so from a camera above the ground the colour pass
   * (LessEqual) always passes it; it is hidden while the camera is below the ground (buried rooms), where it could
   * cover the floor.
   */
  readonly depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  readonly depthGroup = new THREE.Group();
  constructor(
    public data: TerrainData,
    public material: THREE.Material,
    /** render order of the chunk meshes (KB-I59: after the other opaque objects) */
    public renderOrder = 0,
    /** add the depth-only pre-pass (only useful with a render order after the occluders) */
    public prepass = false,
    /** grid step of the pre-pass envelope (cells) */
    public prepassStep = PREPASS_STEP,
  ) {
    this.group.name = 'terrain';
    // static: no per-frame matrix compose for the ~360 chunk meshes (wave-4 review, CPU)
    this.group.matrixAutoUpdate = false;
    this.depthGroup.name = 'terrain-depth';
    this.depthGroup.matrixAutoUpdate = false;
    this.group.add(this.depthGroup);
    const g = data.meta.grid;
    for (let r0 = 0; r0 < g.rows - 1; r0 += CHUNK) {
      for (let c0 = 0; c0 < g.cols - 1; c0 += CHUNK) {
        const cx = data.cellX(Math.min(g.cols - 1, c0 + CHUNK / 2));
        const cz = data.cellZ(Math.min(g.rows - 1, r0 + CHUNK / 2));
        const ch = data.at(Math.min(g.rows - 1, r0 + CHUNK / 2), Math.min(g.cols - 1, c0 + CHUNK / 2));
        this.chunks.push({ r0, c0, mesh: null, step: 0, centre: new THREE.Vector3(cx, ch, cz), cache: new Map() });
      }
    }
    if (prepass) this.buildDepth();
  }

  /** (Re)build the pre-pass blocks from the current epoch's heights. */
  private buildDepth(): void {
    for (const m of this.depthGroup.children as THREE.Mesh[]) m.geometry.dispose();
    this.depthGroup.clear();
    const d = this.data;
    const g = d.meta.grid;
    const env = minEnvelope(d.h, g.cols, g.rows, this.prepassStep, PREPASS_DROP);
    const nc = env.colsIdx.length;
    const per = Math.max(1, Math.round(PREPASS_BLOCK / this.prepassStep));
    for (let i0 = 0; i0 < env.rowsIdx.length - 1; i0 += per) {
      for (let j0 = 0; j0 < nc - 1; j0 += per) {
        const i1 = Math.min(env.rowsIdx.length - 1, i0 + per);
        const j1 = Math.min(nc - 1, j0 + per);
        const bw = j1 - j0 + 1;
        const pos = new Float32Array((i1 - i0 + 1) * bw * 3);
        let k = 0;
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++) {
            pos[k++] = d.cellX(env.colsIdx[j]);
            pos[k++] = env.z[i * nc + j];
            pos[k++] = d.cellZ(env.rowsIdx[i]);
          }
        const idx: number[] = [];
        for (let i = 0; i < i1 - i0; i++)
          for (let j = 0; j < j1 - j0; j++) {
            const a = i * bw + j;
            idx.push(a, a + bw, a + 1, a + 1, a + bw, a + bw + 1);
          }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, this.depthMaterial);
        m.renderOrder = -1;
        m.name = `terrain-depth/${env.rowsIdx[i0]}_${env.colsIdx[j0]}`;
        m.matrixAutoUpdate = false;
        m.raycast = () => {}; // the colour mesh is the one to hit
        this.depthGroup.add(m);
      }
    }
    this.group.updateMatrixWorld(true);
  }

  private geometry(r0: number, c0: number, step: number): THREE.BufferGeometry {
    const d = this.data;
    const g = d.meta.grid;
    const r1 = Math.min(g.rows - 1, r0 + CHUNK);
    const c1 = Math.min(g.cols - 1, c0 + CHUNK);
    const rowsIdx: number[] = [];
    for (let r = r0; r < r1; r += step) rowsIdx.push(r);
    rowsIdx.push(r1);
    const colsIdx: number[] = [];
    for (let c = c0; c < c1; c += step) colsIdx.push(c);
    colsIdx.push(c1);
    const nr = rowsIdx.length;
    const nc = colsIdx.length;
    const skirt = 2 * nr + 2 * nc;
    const pos = new Float32Array((nr * nc + skirt) * 3);
    const nrm = new Float32Array((nr * nc + skirt) * 3);
    const h = d.h;
    let k = 0;
    for (const r of rowsIdx) for (const c of colsIdx) {
      // normals from the height field (central differences over the LOD step), not per chunk: shared border
      // vertices of neighbouring chunks and LOD levels shade identically (wave-2 review: dark chunk seams)
      const n = gridNormal(h, g.cols, g.rows, g.cell, r, c, step);
      nrm[k] = n[0];
      pos[k++] = d.cellX(c);
      nrm[k] = n[1];
      pos[k++] = d.at(r, c);
      nrm[k] = n[2];
      pos[k++] = d.cellZ(r);
    }
    const idx: number[] = [];
    for (let i = 0; i < nr - 1; i++)
      for (let j = 0; j < nc - 1; j++) {
        const a = i * nc + j;
        const b = a + 1;
        const c = a + nc;
        const e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    // skirts: duplicate border vertices 4 m lower
    let v = nr * nc;
    const border = (list: number[]) => {
      const start = v;
      for (const bi of list) {
        pos[v * 3] = pos[bi * 3];
        pos[v * 3 + 1] = pos[bi * 3 + 1] - 4 * step;
        pos[v * 3 + 2] = pos[bi * 3 + 2];
        // skirts take the normal of their top vertex: a crack between LOD levels shows terrain-coloured, not dark
        nrm[v * 3] = nrm[bi * 3];
        nrm[v * 3 + 1] = nrm[bi * 3 + 1];
        nrm[v * 3 + 2] = nrm[bi * 3 + 2];
        v++;
      }
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i];
        const b = list[i + 1];
        const a2 = start + i;
        const b2 = start + i + 1;
        idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2); // both windings (cheap; skirts are tiny)
      }
    };
    border(Array.from({ length: nc }, (_, j) => j));
    border(Array.from({ length: nc }, (_, j) => (nr - 1) * nc + j));
    border(Array.from({ length: nr }, (_, i) => i * nc));
    border(Array.from({ length: nr }, (_, i) => i * nc + nc - 1));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  /** Pick the LOD step per chunk by distance from the camera. */
  update(camera: THREE.Camera, detail = 1): void {
    const p = camera.position;
    let tris = 0;
    for (const ch of this.chunks) {
      const dx = Math.max(0, Math.abs(p.x - ch.centre.x) - CHUNK / 2);
      const dz = Math.max(0, Math.abs(p.z - ch.centre.z) - CHUNK / 2);
      const dist = Math.hypot(dx, dz, (p.y - ch.centre.y) * 0.5) / detail;
      const step = dist < 180 ? 1 : dist < 450 ? 2 : dist < 1000 ? 4 : 8;
      if (step !== ch.step || !ch.mesh) {
        let geo = ch.cache.get(step);
        if (!geo) {
          geo = this.geometry(ch.r0, ch.c0, step);
          ch.cache.set(step, geo);
        }
        if (!ch.mesh) {
          ch.mesh = new THREE.Mesh(geo, this.material);
          ch.mesh.receiveShadow = true;
          // drawn after the trees and buildings standing on it (KB-I59; atmosphere.ts RENDER_ORDER)
          ch.mesh.renderOrder = this.renderOrder;
          ch.mesh.name = `terrain/${ch.r0}_${ch.c0}`;
          ch.mesh.userData = { part: 'terrain' };
          ch.mesh.matrixAutoUpdate = false;
          this.group.add(ch.mesh);
          ch.mesh.updateMatrixWorld();
        } else {
          ch.mesh.geometry = geo;
        }
        ch.step = step;
      }
      tris += (ch.mesh.geometry.index?.count ?? 0) / 3;
    }
    this.triangles = tris;
    // the envelope argument needs the camera above the ground (0.3 m: bilinear vs triangulated 1 m cells)
    if (this.prepass) {
      const gh = this.data.sample(p.x, p.z);
      this.depthGroup.visible = !(p.y < gh + 0.3);
    }
  }

  /** Drop cached geometry (after switching epoch). */
  rebuild(): void {
    for (const ch of this.chunks) {
      for (const g of ch.cache.values()) g.dispose();
      ch.cache.clear();
      ch.step = 0;
    }
    if (this.prepass) this.buildDepth();
  }
}
