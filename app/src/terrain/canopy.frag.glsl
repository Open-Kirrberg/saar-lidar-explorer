// Canopy (DSM) fragment shader (GLSL3). heightSample.glsl is prepended.
// The surface is the DSM; colour = vegetation height (DSM − DTM, per pixel) on a green ramp,
// lit by the sun with per-pixel DSM normals. Fragments lower than uCanopyMin above the ground
// are discarded, so open ground keeps showing the analytic relief underneath.

uniform highp sampler2D uHeight;   // DSM chunk (R32F, with apron)
uniform highp sampler2D uGround;   // DTM chunk (same pixel grid)
uniform float uCellSize;           // 1 (canopy is level 0 only)
uniform float uExag;
uniform float uShadeZ;
uniform float uSunAz;
uniform float uSunEl;
uniform float uCanopyMin;          // m above ground below which the canopy is not drawn
uniform float uCanopyMax;          // m mapped to the darkest green
uniform float uCanopyOpacity;
uniform float uCanopySteepCut;    // gradient magnitude above which fragments are dropped
uniform sampler2D uBldg;           // R0.7 building mask (u8 0/1, (n+2)² with apron), per chunk
uniform float uHasBldg;
uniform float uChunkSize;
uniform vec3 uFogColor;
uniform float uFogDensity;

in vec2 vPx;
in vec3 vWorld;
out vec4 fragColor;

vec3 canopyRamp(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  vec3 a = vec3(0.93, 0.91, 0.72), b = vec3(0.66, 0.80, 0.42), c = vec3(0.30, 0.60, 0.26);
  vec3 d = vec3(0.10, 0.36, 0.17), e = vec3(0.04, 0.20, 0.11);
  if (t < 1.0) return mix(a, b, t);
  if (t < 2.0) return mix(b, c, t - 1.0);
  if (t < 3.0) return mix(c, d, t - 2.0);
  return mix(d, e, t - 3.0);
}

void main() {
  float h;
  vec2 g;
  sampleHeight(uHeight, vPx, h, g);
  g /= uCellSize;
  // R0.7: buildings in the DSM are not canopy — show the ground (relief) there instead.
  if (uHasBldg > 0.5 && texture(uBldg, (vPx + 0.5) / (uChunkSize + 2.0)).r >= 0.5) discard;
  float ground = bilinearHeight(uGround, vPx);
  float chm = h - ground;
  if (chm < uCanopyMin) discard;
  // Transparent mode: drop near-vertical "curtains" between crowns and the ground
  // (mesh walls at crown edges) so the ground stays readable through the canopy.
  if (length(g) > uCanopySteepCut) discard;

  float k = uExag * uShadeZ;
  vec3 n = normalize(vec3(-g.x * k, 1.0, -g.y * k));
  float ce = cos(uSunEl);
  vec3 L = vec3(ce * sin(uSunAz), sin(uSunEl), -ce * cos(uSunAz));
  float diff = max(dot(n, L), 0.0);
  float sky = 0.5 + 0.5 * n.y; // hemisphere ambient
  // Lighter tops on a slightly brighter ramp: tall trees stay readable instead of black.
  vec3 albedo = canopyRamp(0.15 + 0.75 * chm / max(uCanopyMax, 1.0));
  vec3 col = albedo * (0.5 * sky + 0.85 * diff) + vec3(0.02);
  // Crown edges / mesh walls (very steep) are shadowed like the inside of the stand.
  col *= mix(1.0, 0.4, smoothstep(1.5, 4.0, length(g)));

  float a = uCanopyOpacity * smoothstep(uCanopyMin, uCanopyMin + 1.5, chm);
  fragColor = vec4(applyFog(col, vWorld, uFogColor, uFogDensity), a);
}
