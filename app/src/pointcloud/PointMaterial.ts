import { GLSL3, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import type { IUniform } from 'three';
import type { SharedTerrainUniforms } from '../terrain/TerrainMaterial';
import { MAX_CLASS_SLOTS, OTHER_CLASS_COLOR, classColor } from './style';

/**
 * Point material for `sle-pts-v1` tiles (F16). The tile body is uploaded unchanged as one
 * interleaved Uint16 buffer (stride 5 words), so the attributes arrive as raw integers:
 *   position = (x cm east, y cm north, h cm above hBase) — words 0..2 (three's built-in name, so
 *              drawRange clamping works; bounding volumes are set by the layer, never computed)
 *   aMisc = (agl as u16, cls | intensity << 8)          — words 3..4
 * World position: x = tileX + x/100, z = tileZ − y/100, true h = hBase + h/100, displayed
 * y = hRef + (h − hRef)·exag with the terrain's SHARED uExag/uHRef uniform objects (same formula as
 * every other 3D object). The tile origin (E − E0, hBase, −(N − N0)) is computed in float64 on the
 * CPU and passed per tile (uTile), so raw UTM never reaches float32.
 *
 * Hidden points (class off, or agl above the Röntgen clip) are moved outside the clip volume.
 * Point size: world spacing of the drawn subsample (uSpacing, per tile) projected to pixels,
 * times the user's size factor, clamped to uSizeClamp (px). Round splats; same squared-exponential
 * haze as the terrain.
 */

const vertexShader = /* glsl */ `
uniform float uExag;
uniform float uHRef;
uniform vec3 uTile;
uniform float uSpacing;
uniform float uPxScale;
uniform float uSize;
uniform vec2 uSizeClamp;
uniform float uAglMax;
uniform int uMode;
uniform vec4 uClassColor[${MAX_CLASS_SLOTS}];
uniform vec4 uOtherClass;
uniform vec2 uHeightRange;
uniform vec2 uAglRange;
uniform float uDepthBias;
in vec2 aMisc;
out vec3 vColor;
out float vDist;

vec3 ramp(float t) {
  // 5-stop perceptual ramp (dark blue → teal → green → yellow → light).
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.15, 0.12, 0.42);
  vec3 c1 = vec3(0.12, 0.45, 0.6);
  vec3 c2 = vec3(0.3, 0.68, 0.38);
  vec3 c3 = vec3(0.93, 0.82, 0.3);
  vec3 c4 = vec3(0.99, 0.97, 0.88);
  float s = t * 4.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  return mix(c3, c4, s - 3.0);
}

void main() {
  float agl = (aMisc.x >= 32768.0 ? aMisc.x - 65536.0 : aMisc.x) * 0.01;
  float cls = mod(aMisc.y, 256.0);
  float inten = floor(aMisc.y / 256.0 + 1e-3) / 255.0;
  int ci = int(cls + 0.5);
  vec4 cc = ci < ${MAX_CLASS_SLOTS} ? uClassColor[ci] : uOtherClass;
  if (cc.a < 0.5 || agl > uAglMax) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    vDist = 0.0;
    return;
  }
  float hTrue = uTile.y + position.z * 0.01;
  vec3 w = vec3(uTile.x + position.x * 0.01, uHRef + (hTrue - uHRef) * uExag, uTile.z - position.y * 0.01);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  float d = max(-mv.z, 0.01);
  vDist = length(mv.xyz);
  // Pull toward the camera along the view ray so ground points don't vanish in the DTM surface.
  mv.xyz *= 1.0 - uDepthBias * max(uExag, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSpacing * uSize * uPxScale / d, uSizeClamp.x, uSizeClamp.y);

  if (uMode == 0) vColor = cc.rgb;
  else if (uMode == 1) vColor = ramp((hTrue - uHeightRange.x) / max(uHeightRange.y - uHeightRange.x, 1e-3));
  else if (uMode == 2) vColor = ramp(sqrt(max(agl - uAglRange.x, 0.0) / max(uAglRange.y - uAglRange.x, 1e-3)));
  else vColor = vec3(pow(inten, 0.6)) * vec3(1.0, 0.97, 0.9);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
in vec3 vColor;
in float vDist;
out vec4 fragColor;

void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  vec3 col = vColor * (0.72 + 0.28 * sqrt(1.0 - r2)); // slight sphere shading separates splats
  float fog = 1.0 - exp(-pow(vDist * uFogDensity, 2.0));
  fragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 0.85)), 1.0);
}
`;

/** Uniforms common to all tiles (one object each, referenced by every tile material). */
export interface PointUniforms {
  [name: string]: IUniform;
  uPxScale: IUniform<number>;
  uSize: IUniform<number>;
  uSizeClamp: IUniform<Vector2>;
  uAglMax: IUniform<number>;
  uMode: IUniform<number>;
  uClassColor: IUniform<Vector4[]>;
  uOtherClass: IUniform<Vector4>;
  uHeightRange: IUniform<Vector2>;
  uAglRange: IUniform<Vector2>;
  uDepthBias: IUniform<number>;
}

export function createPointUniforms(): PointUniforms {
  const colors = Array.from({ length: MAX_CLASS_SLOTS }, (_, c) => {
    const [r, g, b] = classColor(c);
    return new Vector4(r, g, b, 1);
  });
  return {
    uPxScale: { value: 800 },
    uSize: { value: 1 },
    uSizeClamp: { value: new Vector2(1.5, 14) },
    uAglMax: { value: 1e6 },
    uMode: { value: 0 },
    uClassColor: { value: colors },
    uOtherClass: { value: new Vector4(...OTHER_CLASS_COLOR, 1) },
    uHeightRange: { value: new Vector2(0, 1) },
    uAglRange: { value: new Vector2(0, 30) },
    uDepthBias: { value: 0.0015 },
  };
}

/** Per-tile material: own uTile/uSpacing, everything else shared (one GL program for all tiles). */
export function createPointMaterial(terrain: SharedTerrainUniforms, shared: PointUniforms): ShaderMaterial {
  return new ShaderMaterial({
    name: 'PointCloudMaterial',
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      uExag: terrain.uExag,
      uHRef: terrain.uHRef,
      uFogColor: terrain.uFogColor,
      uFogDensity: terrain.uFogDensity,
      ...shared,
      uTile: { value: new Vector3() },
      uSpacing: { value: 0.5 },
    },
  });
}
