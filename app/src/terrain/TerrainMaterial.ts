import { Color, DataTexture, FloatType, GLSL3, NearestFilter, RedFormat, ShaderMaterial, UnsignedByteType, Vector2, Vector3 } from 'three';
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
  uFogColor: IUniform<Vector3>;
  uFogDensity: IUniform<number>;
  uLodTint: IUniform<number>;
  uChunkSize: IUniform<number>;
  /** Canopy (forest) surface. */
  uCanopyMin: IUniform<number>;
  uCanopyMax: IUniform<number>;
  uCanopyOpacity: IUniform<number>;
  uCanopySteepCut: IUniform<number>;
}

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
  /** Per-chunk low-pass (live local relief), same pixel grid as uHeight. */
  uLowpass: IUniform<Texture>;
  uHasLowpass: IUniform<number>;
  uSkirtDepth: IUniform<number>;
  uLodColor: IUniform<Color>;
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
    uFogColor: { value: FOG_COLOR.clone() },
    uFogDensity: { value: 1 / 7000 },
    uLodTint: { value: 0 },
    uChunkSize: { value: chunkSize },
    uCanopyMin: { value: 2 },
    uCanopyMax: { value: 35 },
    uCanopyOpacity: { value: 0.6 },
    uCanopySteepCut: { value: 1e6 },
  };
}

/** One material per chunk; shared uniform objects are referenced, so one program serves all chunks. */
export function createChunkMaterial(shared: SharedTerrainUniforms, chunk: ChunkUniforms): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader: heightSample + '\n' + fragmentShader,
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
