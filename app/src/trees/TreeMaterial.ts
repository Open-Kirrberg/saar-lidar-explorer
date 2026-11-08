import { Color, FrontSide, GLSL3, ShaderMaterial, Vector2, Vector4 } from 'three';
import type { IUniform } from 'three';
import type { SharedTerrainUniforms } from '../terrain/TerrainMaterial';
import { CROWN_SCALE_MAX } from './lod';
import type { LodBand, TreeLodParams } from './lod';
import { profileUniform } from './treeShapes';
import type { TreeShape } from './treeShapes';

/**
 * V2.4 tree material: one ShaderMaterial per LOD mesh (near / mid / far), sharing the terrain's
 * uniform OBJECTS for exaggeration, sun and haze (display-space colours, no scene lights).
 *
 * Vertex: anchor = (x, hRef + (g − hRef)·exag, z) from the instance row only; the tree itself is
 * not exaggerated. Per tree: distance d → existence weight `vis` (density/rank, lod.ts
 * `treeVisibility`) and this mesh's band weights → a dither interval [wIn, min(wOut, vis)).
 * Empty interval → the instance is collapsed off-screen (no fragments). Fragment: t = IGN(pixel) +
 * per-tree offset; keep wIn ≤ t < min(wOut, vis) — the neighbouring LOD keeps the complement, so
 * the cross-fade has no gap and no double cover. TS twins: lod.ts (`lodKeeps`, `treeVisibility`).
 */

const vertexShader = /* glsl */ `
#define SEQ __SEQ__
uniform float uExag;
uniform float uHRef;
uniform float uTime;
uniform float uWind;
uniform float uLensFade;
uniform float uBottomToGround;
uniform vec2 uProf[3 * SEQ];
uniform vec4 uBands;   // inner start/end, outer start/end
uniform vec4 uLod;     // full, max, fade, sink per metre of distance
uniform float uLump[3]; // per kind: unknown, conifer, broadleaf
uniform vec3 uColU;
uniform vec3 uColC;
uniform vec3 uColB;
uniform vec3 uColTrunk;
in float aBand;
in vec4 iA;            // x, g (true ground), z, h
in vec4 iB;            // r, rank, seed, kind (+4 = fill)
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
flat out vec3 vKeep;   // wIn, hi = min(wOut, vis), seed

float falloff(float d) { return d <= uLod.x ? 1.0 : (uLod.x / d) * (uLod.x / d); }
float density(float d) { return falloff(d) * (1.0 - smoothstep(0.85 * uLod.y, uLod.y, d)); }

void main() {
  // modelMatrix is identity in single-AOI mode; in catalog mode (S2) it carries the place's offset
  // from the session origin (translation only, session-local metres, never raw UTM).
  vec3 anchor = vec3(iA.x, uHRef + (iA.y - uHRef) * uExag, iA.z) + modelMatrix[3].xyz;
  float d = distance(cameraPosition, anchor);
  float thr = density(d) * (1.0 + uLod.z);
  float vis = clamp((thr - iB.y) / uLod.z, 0.0, 1.0) * (1.0 - uLensFade);
  float wIn = 1.0 - smoothstep(uBands.x, uBands.y, d);
  float wOut = 1.0 - smoothstep(uBands.z, uBands.w, d);
  float hi = min(wOut, vis);
  vKeep = vec3(wIn, hi, iB.z);
  if (wIn >= hi) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: whole instance culled
    vWorld = anchor; vNormal = vec3(0.0, 1.0, 0.0); vColor = vec3(0.0);
    return;
  }

  int kind = int(iB.w + 0.5) & 3;
  if (kind > 2) kind = 0;
  float seed = iB.z;
  float h = iA.w;
  // Crown scale 1/√falloff (≤ CROWN_SCALE_MAX): thinned far forest keeps its canopy cover.
  float r = iB.x * (0.9 + 0.2 * fract(seed * 17.0)) * min(${CROWN_SCALE_MAX.toFixed(2)}, inversesqrt(falloff(d)));
  float a = seed * 6.2831853;
  float ca = cos(a), sa = sin(a);
  vec2 dir = vec2(position.x * ca - position.z * sa, position.x * sa + position.z * ca);
  float seq = position.y;
  float sink = 0.5 + uLod.w * d; // trunks reach below the ground: coarse far terrain never shows a gap
  vec3 p;
  vec3 n;
  float hf;
  vec3 col;
  if (seq < -0.5) {
    float tr = clamp(0.05 * iB.x + 0.008 * h, 0.1, 0.5);
    float y = seq < -1.5 ? uProf[kind * SEQ].x * h + 0.3 : -sink;
    p = vec3(dir.x * tr, y, dir.y * tr);
    n = vec3(dir.x, 0.0, dir.y);
    hf = 0.0;
    col = uColTrunk;
  } else {
    int k = int(seq + 0.5);
    int b = int(aBand + 0.5);
    vec2 P = uProf[kind * SEQ + k];
    vec2 P0 = uProf[kind * SEQ + b];
    vec2 P1 = uProf[kind * SEQ + b + 1];
    float lump = (k > 0 && k < SEQ - 1) ? 1.0 + uLump[kind] * sin(dot(position.xz, vec2(2.3, 1.7)) * 1.9 + float(k) * 2.1 + seed * 40.0) : 1.0;
    float y = P.x * h;
    if (k == 0 && uBottomToGround > 0.5) y = -sink;
    p = vec3(dir.x * P.y * r * lump, y, dir.y * P.y * r * lump);
    float dh = (P1.x - P0.x) * h;
    float dr = (P1.y - P0.y) * r;
    n = vec3(dir.x * dh, -dr, dir.y * dh);
    hf = P.x;
    col = kind == 1 ? uColC : (kind == 2 ? uColB : uColU);
    col *= 0.85 + 0.3 * fract(seed * 29.0);
    col *= mix(0.62, 1.0, clamp(hf * 1.4 - 0.15, 0.0, 1.0)); // darker crown base (fake occlusion)
    // Low wind: crown sways ≤ 1.2 % of h at the top, same formula in every LOD.
    float sway = uWind * 0.012 * h * hf * hf * sin(uTime * 1.3 + a + (iA.x + iA.z) * 0.02);
    p.xz += vec2(0.8, 0.6) * sway;
  }
  vec3 w = anchor + p;
  vWorld = w;
  vNormal = n;
  vColor = col;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uSunAz;
uniform float uSunEl;
uniform vec3 uFogColor;
uniform float uFogDensity;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
flat in vec3 vKeep;
out vec4 fragColor;

// Interleaved gradient noise (Jimenez 2014): fine, stable screen-space dither.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  float t = fract(ign(gl_FragCoord.xy) + vKeep.z * 7.31);
  if (t < vKeep.x || t >= vKeep.y) discard;
  vec3 n = normalize(vNormal);
  vec3 toCam = cameraPosition - vWorld;
  if (dot(n, toCam) < 0.0) n = -n;
  float ce = cos(uSunEl);
  vec3 L = vec3(ce * sin(uSunAz), sin(uSunEl), -ce * cos(uSunAz)); // +x east, −z north
  float diff = max((dot(n, L) + 0.3) / 1.3, 0.0); // wrapped: foliage scatters light
  float sky = 0.55 + 0.45 * n.y;
  vec3 col = vColor * (0.5 * sky + 0.75 * diff) + vec3(0.01);
  float d = length(toCam);
  float fog = 1.0 - exp(-pow(d * uFogDensity, 2.0));
  fragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 0.85)), 1.0);
}
`;

/** Display-space albedo per kind (custom shader, no colour management). */
export const TREE_COLORS = {
  unknown: new Color(0.26, 0.37, 0.17),
  conifer: new Color(0.14, 0.25, 0.13),
  broadleaf: new Color(0.34, 0.45, 0.19),
  trunk: new Color(0.32, 0.26, 0.2),
};

export interface TreeUniforms {
  [name: string]: IUniform;
  uTime: IUniform<number>;
  uWind: IUniform<number>;
  uLensFade: IUniform<number>;
  uLod: IUniform<Vector4>;
}

/** Uniforms shared by every tree material (one object per layer). */
export function createTreeUniforms(): TreeUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: 1 },
    uLensFade: { value: 0 },
    uLod: { value: new Vector4(900, 3000, 0.08, 0.0012) }, // sink 0.5 m + 1.2 mm/m: measured g − displayed DTM ≤ 2.1 m beyond 1.5 km
  };
}

export function setLodUniform(u: TreeUniforms, p: TreeLodParams): void {
  u.uLod.value.set(p.full, p.max, p.fade, u.uLod.value.w);
}

/** Band → (inner start/end, outer start/end); open ends become no-ops in the shader. */
export function bandVector(b: LodBand, target = new Vector4()): Vector4 {
  const inner = b.inner ?? [-2, -1];
  const outer = b.outer ?? [1e9, 2e9];
  return target.set(inner[0], inner[1], outer[0], outer[1]);
}

export function createTreeMaterial(
  shared: SharedTerrainUniforms,
  tree: TreeUniforms,
  shape: TreeShape,
  band: LodBand,
  name: string,
): ShaderMaterial {
  const seq = shape.profiles[0].length;
  const c = (col: Color) => ({ value: col.clone() });
  return new ShaderMaterial({
    name,
    glslVersion: GLSL3,
    vertexShader: vertexShader.replace('__SEQ__', String(seq)),
    fragmentShader,
    uniforms: {
      uExag: shared.uExag,
      uHRef: shared.uHRef,
      uSunAz: shared.uSunAz,
      uSunEl: shared.uSunEl,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uTime: tree.uTime,
      uWind: tree.uWind,
      uLensFade: tree.uLensFade,
      uLod: tree.uLod,
      uBands: { value: bandVector(band) },
      uBottomToGround: { value: shape.bottomToGround ? 1 : 0 },
      uProf: { value: profileUniform(shape).map(([a, b]) => new Vector2(a, b)) },
      uLump: { value: [0.14, 0.05, 0.14] },
      uColU: c(TREE_COLORS.unknown),
      uColC: c(TREE_COLORS.conifer),
      uColB: c(TREE_COLORS.broadleaf),
      uColTrunk: c(TREE_COLORS.trunk),
    } satisfies Record<string, IUniform>,
    side: FrontSide,
  });
}
