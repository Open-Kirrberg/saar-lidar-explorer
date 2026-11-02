import { Color, DoubleSide, GLSL3, ShaderMaterial } from 'three';
import type { IUniform } from 'three';
import type { SharedTerrainUniforms } from '../terrain/TerrainMaterial';
import { CONF_COLORS } from './recon';

/**
 * F19 material for the reconstruction model (contract "Shared datasets"). Same approach as the
 * LoD2 BuildingMaterial: a ShaderMaterial that shares the terrain's uniform OBJECTS (exaggeration,
 * sun, fog) and writes display-space colours.
 *
 * Vertex: the exaggeration is applied in WORLD space (`y' = hRef + (y − hRef)·exag`; the model is
 * only translated horizontally into the AOI), normal (nx, ny/exag, nz). Fragment: albedo from
 * `color` (COLOR_0, linear → sRGB) in mode 0 *Material*, or from `_conf` (0 low, 1 med, 2 high) in
 * mode 1 *Konfidenz*; Lambert from the terrain sun + hemisphere ambient; the terrain's fog;
 * `uOpacity` < 1 = *Geister-Modus* (with a depth pre-pass, see ReconLayer); `uHighlight` tints the
 * selected building.
 */

const vertexShader = /* glsl */ `
uniform float uExag;
uniform float uHRef;
in vec3 color;
in float _conf;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
flat out int vConf;
invariant gl_Position;

void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y = uHRef + (w.y - uHRef) * uExag;
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * vec3(normal.x, normal.y / max(uExag, 1e-3), normal.z));
  vColor = color;
  vConf = int(_conf + 0.5);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const fragmentShader = /* glsl */ `
uniform float uSunAz;
uniform float uSunEl;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform int uMode;
uniform float uOpacity;
uniform float uHighlight;
uniform vec3 uConfLow;
uniform vec3 uConfMed;
uniform vec3 uConfHigh;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
flat in int vConf;
out vec4 fragColor;

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float d = length(toCam);
  vec3 n = normalize(vNormal);
  if (dot(n, toCam) < 0.0) n = -n; // open shells / flipped winding: light the visible side
  float ce = cos(uSunEl);
  vec3 L = vec3(ce * sin(uSunAz), sin(uSunEl), -ce * cos(uSunAz)); // +x east, −z north
  float diff = max(dot(n, L), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 albedo = uMode == 1
    ? (vConf >= 2 ? uConfHigh : (vConf == 1 ? uConfMed : uConfLow))
    : linearToSrgb(vColor);
  vec3 col = albedo * (0.6 * sky + 0.6 * diff) + vec3(0.03);
  col = mix(col, vec3(1.0, 0.93, 0.55), 0.45 * uHighlight);
  float fog = 1.0 - exp(-pow(d * uFogDensity, 2.0));
  fragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 0.85)), uOpacity);
}
`;

const depthFragment = /* glsl */ `
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

export interface ReconUniforms {
  [name: string]: IUniform;
  uMode: IUniform<number>;
  uOpacity: IUniform<number>;
}

function displayColor(hex: number): Color {
  // Display-space values for the custom shader (no colour management) — the raw sRGB components.
  return new Color((hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/** Shared per-layer uniforms (mode, opacity, palette) + the terrain's shared uniform objects. */
export function createReconUniforms(shared: SharedTerrainUniforms): ReconUniforms {
  return {
    uExag: shared.uExag,
    uHRef: shared.uHRef,
    uSunAz: shared.uSunAz,
    uSunEl: shared.uSunEl,
    uFogColor: shared.uFogColor,
    uFogDensity: shared.uFogDensity,
    uMode: { value: 0 },
    uOpacity: { value: 1 },
    uConfLow: { value: displayColor(CONF_COLORS.low) },
    uConfMed: { value: displayColor(CONF_COLORS.med) },
    uConfHigh: { value: displayColor(CONF_COLORS.high) },
  };
}

/** Colour material; `highlight` = the variant used for the selected building. */
export function createReconMaterial(u: ReconUniforms, highlight = false): ShaderMaterial {
  return new ShaderMaterial({
    name: highlight ? 'ReconMaterialSelected' : 'ReconMaterial',
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: { ...u, uHighlight: { value: highlight ? 1 : 0 } },
    side: DoubleSide,
  });
}

/** Depth-only pre-pass for the ghost mode: only the front-most surface gets blended. */
export function createReconDepthMaterial(u: ReconUniforms): ShaderMaterial {
  return new ShaderMaterial({
    name: 'ReconDepthPrepass',
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader: depthFragment,
    uniforms: { uExag: u.uExag, uHRef: u.uHRef },
    side: DoubleSide,
    colorWrite: false,
  });
}
