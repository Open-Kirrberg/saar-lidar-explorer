// Terrain vertex shader (GLSL3). Geometry is in height-image pixel space:
// position.xz = continuous pixel coordinate p (integer = texel centre; the outer ring lies on the
// chunk's cell edges at ±0.5), position.y < 0 marks skirt vertices.
// modelMatrix translates/scales pixel space to world space (x = E − E0, z = −(N − N0);
// scale = the level's cell size).

uniform highp sampler2D uHeight; // R32F, (chunkSize + 2)² incl. 1-cell apron
uniform float uExag;
uniform float uHRef;
uniform float uSkirtDepth;
uniform vec2 uPxMax;             // last pixel coordinate inside the AOI (edge chunks are clamped)

out vec2 vPx;
out vec3 vWorld;

float hV(ivec2 q, ivec2 size) {
  return texelFetch(uHeight, clamp(q, ivec2(0), size - 1), 0).r;
}

void main() {
  vec2 p = min(position.xz, uPxMax);
  ivec2 size = textureSize(uHeight, 0);
  vec2 fl = floor(p);
  vec2 f = p - fl;
  ivec2 b = ivec2(fl);
  float h = mix(mix(hV(b, size), hV(b + ivec2(1, 0), size), f.x),
                mix(hV(b + ivec2(0, 1), size), hV(b + ivec2(1, 1), size), f.x), f.y);
  float y = uHRef + (h - uHRef) * uExag;
  if (position.y < 0.0) y -= uSkirtDepth;
  vec4 wp = modelMatrix * vec4(p.x, y, p.y, 1.0);
#ifdef COVERAGE
  // Catalog mode: outside the owned tiles the (pyramid-filled) overview terrain sinks to hRef, so its
  // plateaus never stand against the sky or occlude real terrain; drawn as plain haze (fragment).
  float cv = textureLod(uCoverage, vec2(wp.x, -wp.z) / uCoverageSize, 0.0).r;
  wp.y = mix(uHRef - (position.y < 0.0 ? uSkirtDepth : 0.0), wp.y, smoothstep(COVERAGE_SINK_LO, COVERAGE_EDGE, cv));
#endif
  vPx = p;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
