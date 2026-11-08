import { Color, DataTexture, FloatType, GLSL3, NearestFilter, RedFormat, ShaderMaterial, UnsignedByteType, Vector2, Vector3, Vector4 } from 'three';
import type { IUniform, Texture } from 'three';
import canopyFragment from './canopy.frag.glsl?raw';
import heightSample from './heightSample.glsl?raw';
import fragmentShader from './terrain.frag.glsl?raw';
import vertexShader from './terrain.vert.glsl?raw';
import { BlendMode, Colormap, ShaderSource } from './relief';

export { Colormap } from './relief';

/** Placeholder textures so samplers are always bound (missing layers are handled via flags). */
export const DUMMY_FLOAT = (() => {
  const t = new DataTexture(new Float32Array([0]), 1, 1, RedFormat, FloatType);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
})();
export const DUMMY_U8 = (() => {
  const t = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
})();

/** Uniforms shared by all terrain chunks — mutate `.value` to change the look of the whole terrain. */
export interface SharedTerrainUniforms {
  [name: string]: IUniform;
  uExag: IUniform<number>;
  uHRef: IUniform<number>;
  uShadeZ: IUniform<number>;
  uSunAz: IUniform<number>;
  uSunEl: IUniform<number>;
  uSunDirs: IUniform<number>;
  /** Base channel: source id (relief.ts ShaderSource), colormap, (lo, hi, gamma), shade. */
  uBaseSrc: IUniform<number>;
  uBaseCmap: IUniform<number>;
  uBaseStretch: IUniform<Vector3>;
  uBaseShade: IUniform<number>;
  uLayerARange: IUniform<Vector2>;
  /** Overlay channel (uOvlSrc = −1 → off). */
  uOvlSrc: IUniform<number>;
  uOvlCmap: IUniform<number>;
  uOvlStretch: IUniform<Vector3>;
  uOvlShade: IUniform<number>;
  uOvlOpacity: IUniform<number>;
  uOvlBlend: IUniform<number>;
  uLayerBRange: IUniform<Vector2>;
  /** 1 = write raw physical values (auto-contrast pass). */
  uValuePass: IUniform<number>;
  /** Decode ranges (min, max) of the live-VAT inputs svf / opns_pos (fixed in v3). */
  uVatSvfRange: IUniform<Vector2>;
  uVatOpnRange: IUniform<Vector2>;
  uFogColor: IUniform<Vector3>;
  uFogDensity: IUniform<number>;
  uLodTint: IUniform<number>;
  uChunkSize: IUniform<number>;
  /** Canopy (forest) surface. */
  uCanopyMin: IUniform<number>;
  uCanopyMax: IUniform<number>;
  uCanopyOpacity: IUniform<number>;
  uCanopySteepCut: IUniform<number>;
  /**
   * Relikt-Blick lens (V2.5, ADR 0035): a third channel mixed over base + overlay with `uLensMix`
   * (0 = off). Source: relief.ts ShaderSource (live, LayerC or ImageC), own colormap/stretch/shade.
   */
  uLensMix: IUniform<number>;
  uLensSrc: IUniform<number>;
  uLensCmap: IUniform<number>;
  uLensStretch: IUniform<Vector3>;
  uLensShade: IUniform<number>;
  uLensTint: IUniform<Vector3>;
  uLayerCRange: IUniform<Vector2>;
  /** Candidate glow (lens): xz world, radius m, strength; first `uGlowCount` entries are used. */
  uGlow: IUniform<Vector4[]>;
  uGlowCount: IUniform<number>;
  /** Bounding circle of the rings (x, z, R; R < 0 = none) for the shader's early-out. */
  uGlowBound: IUniform<Vector3>;
  uGlowColor: IUniform<Vector3>;
  /** Seconds (pulse phase). */
  uGlowTime: IUniform<number>;
  /** Glow fade 0–1 (own channel of the lens transition, independent of the relief mix). */
  uGlowMix: IUniform<number>;
  /** Metres per pixel at 1 m distance (2·tan(fov/2) / drawing-buffer height): minimum glow size. */
  uGlowPx: IUniform<number>;
}

/** Max candidate glows per frame (uniform array size; keep in sync with GLOW_MAX in terrain.frag.glsl). */
export const GLOW_MAX = 24;

/** Per-chunk uniforms. */
export interface ChunkUniforms {
  [name: string]: IUniform;
  uHeight: IUniform<Texture>;
  /** Metres per height pixel (the chunk's level cell size). */
  uCellSize: IUniform<number>;
  /** Last pixel coordinate inside the AOI (vertex clamp for edge chunks). */
  uPxMax: IUniform<Vector2>;
  uLayerA: IUniform<Texture>;
  uHasLayerA: IUniform<number>;
  /** Stand-in source when layer A/B is not available at this level: −1 none, 1 live slope. */
  uLayerAAlt: IUniform<number>;
  uLayerB: IUniform<Texture>;
  uHasLayerB: IUniform<number>;
  uLayerBAlt: IUniform<number>;
  /** Image px per chunk side (without apron) bound in slot A / B (1 when not an image). */
  uImgPxA: IUniform<number>;
  uImgPxB: IUniform<number>;
  /** Lens slot C (V2.5): layer/image texture, flag, stand-in source, image px. */
  uLayerC: IUniform<Texture>;
  uHasLayerC: IUniform<number>;
  uLayerCAlt: IUniform<number>;
  uImgPxC: IUniform<number>;
  /** Per-chunk low-pass (live local relief), same pixel grid as uHeight. */
  uLowpass: IUniform<Texture>;
  uHasLowpass: IUniform<number>;
  uSkirtDepth: IUniform<number>;
  uLodColor: IUniform<Color>;
  /** Quadrants (bit a + 2b) covered by drawn children → discarded (partial parent, S2). */
  uQuadMask: IUniform<number>;
  /** Live VAT inputs (u8 apron textures) + flag (both resident). */
  uVatSvf: IUniform<Texture>;
  uVatOpn: IUniform<Texture>;
  uHasVatIn: IUniform<number>;
}

/** Per-chunk canopy uniforms. */
export interface CanopyChunkUniforms {
  [name: string]: IUniform;
  uHeight: IUniform<Texture>;
  uGround: IUniform<Texture>;
  uSkirtDepth: IUniform<number>;
  uCellSize: IUniform<number>;
  uPxMax: IUniform<Vector2>;
  /** R0.7 building mask (`layers.bldg`, (n+2)² apron texture); canopy is dropped where ≥ 0.5. */
  uBldg: IUniform<Texture>;
  uHasBldg: IUniform<number>;
}

export const FOG_COLOR = new Vector3(0.74, 0.8, 0.86);

export function createSharedUniforms(hRef: number, chunkSize: number): SharedTerrainUniforms {
  const deg = Math.PI / 180;
  return {
    uExag: { value: 1 },
    uHRef: { value: hRef },
    uShadeZ: { value: 1 },
    uSunAz: { value: 315 * deg },
    uSunEl: { value: 35 * deg },
    uSunDirs: { value: 1 },
    uBaseSrc: { value: ShaderSource.Hillshade },
    uBaseCmap: { value: Colormap.Gray },
    uBaseStretch: { value: new Vector3(0, 1, 1) },
    uBaseShade: { value: 0.5 },
    uLayerARange: { value: new Vector2(0, 1) },
    uOvlSrc: { value: ShaderSource.Off },
    uOvlCmap: { value: Colormap.Diverging },
    uOvlStretch: { value: new Vector3(-1, 1, 1) },
    uOvlShade: { value: 0 },
    uOvlOpacity: { value: 0.5 },
    uOvlBlend: { value: BlendMode.Normal },
    uLayerBRange: { value: new Vector2(0, 1) },
    uValuePass: { value: 0 },
    uVatSvfRange: { value: new Vector2(0.6, 1) },
    uVatOpnRange: { value: new Vector2(60, 95) },
    uFogColor: { value: FOG_COLOR.clone() },
    uFogDensity: { value: 1 / 7000 },
    uLodTint: { value: 0 },
    uChunkSize: { value: chunkSize },
    uCanopyMin: { value: 2 },
    uCanopyMax: { value: 35 },
    uCanopyOpacity: { value: 0.6 },
    uCanopySteepCut: { value: 1e6 },
    uLensMix: { value: 0 },
    uLensSrc: { value: ShaderSource.Off },
    uLensCmap: { value: Colormap.Gray },
    uLensStretch: { value: new Vector3(0, 1, 1) },
    uLensShade: { value: 0 },
    uLensTint: { value: new Vector3(1, 1, 1) },
    uLayerCRange: { value: new Vector2(0, 1) },
    uGlow: { value: Array.from({ length: GLOW_MAX }, () => new Vector4()) },
    uGlowCount: { value: 0 },
    uGlowBound: { value: new Vector3(0, 0, -1) },
    uGlowColor: { value: new Vector3(1, 0.62, 0.14) },
    uGlowTime: { value: 0 },
    uGlowMix: { value: 0 },
    uGlowPx: { value: 0.001 },
  };
}

/** One material per chunk; shared uniform objects are referenced, so one program serves all chunks. */
export function createChunkMaterial(shared: SharedTerrainUniforms, chunk: ChunkUniforms): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader: `#define GLOW_MAX ${GLOW_MAX}\n` + heightSample + '\n' + fragmentShader,
    uniforms: { ...shared, ...chunk },
  });
}

/** Canopy material: same vertex displacement (DSM texture as uHeight), canopy fragment shader. */
export function createCanopyMaterial(shared: SharedTerrainUniforms, chunk: CanopyChunkUniforms): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader: heightSample + '\n' + canopyFragment,
    uniforms: { ...shared, ...chunk },
  });
}
