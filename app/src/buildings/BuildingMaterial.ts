import { Color, DoubleSide, GLSL3, ShaderMaterial, Vector2 } from 'three';
import type { IUniform } from 'three';
import type { SharedTerrainUniforms } from '../terrain/TerrainMaterial';

/**
 * Clay material for LoD2 buildings (F11). A ShaderMaterial (not MeshLambertMaterial +
 * onBeforeCompile) so it shares the terrain's uniform OBJECTS for exaggeration, sun and fog and
 * writes display-space colours like the terrain shaders — no scene lights, no colour management.
 *
 * Vertex: y' = hRef + (y − hRef)·exag (positions carry TRUE heights); the normal of the stretched
 * surface is (nx, ny/exag, nz) normalised. Fragment: surface class from `_surface`
 * (0 ground, 1 wall, 2 roof) → albedo; Lambert from the terrain sun + hemisphere ambient; the same
 * squared-exponential fog as `applyFog`; screen-door (4×4 Bayer) fade-out by distance so chunks
 * entering/leaving the streaming radius don't pop.
 */

const vertexShader = /* glsl */ `
uniform float uExag;
uniform float uHRef;
in float _surface;
out vec3 vWorld;
out vec3 vNormal;
flat out int vSurf;

void main() {
  vec3 p = position;
  p.y = uHRef + (p.y - uHRef) * uExag;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * vec3(normal.x, normal.y / max(uExag, 1e-3), normal.z));
  vSurf = int(_surface + 0.5);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const fragmentShader = /* glsl */ `
uniform float uSunAz;
uniform float uSunEl;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uWall;
uniform vec3 uRoof;
uniform vec3 uGround;
uniform vec2 uFade;
in vec3 vWorld;
in vec3 vNormal;
flat in int vSurf;
out vec4 fragColor;

float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float d = length(toCam);
  float keep = 1.0 - smoothstep(uFade.x, uFade.y, d);
  if (keep < 1.0 && bayer4(gl_FragCoord.xy) >= keep) discard;

  vec3 n = normalize(vNormal);
  if (dot(n, toCam) < 0.0) n = -n; // seen from behind (flipped winding, open shells): light the visible side
  float ce = cos(uSunEl);
  vec3 L = vec3(ce * sin(uSunAz), sin(uSunEl), -ce * cos(uSunAz)); // +x east, −z north (as the terrain)
  float diff = max(dot(n, L), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 albedo = vSurf == 2 ? uRoof : (vSurf == 1 ? uWall : uGround);
  vec3 col = albedo * (0.6 * sky + 0.6 * diff) + vec3(0.03);

  float fog = 1.0 - exp(-pow(d * uFogDensity, 2.0));
  fragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 0.85)), 1.0);
}
`;

export const BUILDING_COLORS = {
  wall: new Color(0.84, 0.81, 0.76),
  roof: new Color(0.7, 0.42, 0.34),
  ground: new Color(0.55, 0.55, 0.55),
};

export function createBuildingMaterial(shared: SharedTerrainUniforms, fade: [number, number]): ShaderMaterial {
  // Colours are display-space values for the custom shader (no colour management).
  const c = (k: keyof typeof BUILDING_COLORS) => ({ value: BUILDING_COLORS[k].clone() });
  return new ShaderMaterial({
    name: 'BuildingMaterial',
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      // Shared uniform objects: exaggeration, reference height, sun and haze follow the terrain.
      uExag: shared.uExag,
      uHRef: shared.uHRef,
      uSunAz: shared.uSunAz,
      uSunEl: shared.uSunEl,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uWall: c('wall'),
      uRoof: c('roof'),
      uGround: c('ground'),
      uFade: { value: new Vector2(fade[0], fade[1]) },
    } satisfies Record<string, IUniform>,
    side: DoubleSide,
  });
}
