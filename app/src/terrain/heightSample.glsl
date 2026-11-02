// Shared height-texture helpers (prepended to terrain.frag / canopy.frag).
// Bilinear height + bilinearly interpolated central-difference gradient from a R32F height
// image with a 1-cell apron, so relief detail is independent of mesh density.

float hT(highp sampler2D tex, ivec2 q, ivec2 size) {
  return texelFetch(tex, clamp(q, ivec2(0), size - 1), 0).r;
}

// Bilinear height + gradient (dh/dx, dh/dz) at continuous pixel coordinate p.
void sampleHeight(highp sampler2D tex, vec2 p, out float h, out vec2 g) {
  ivec2 size = textureSize(tex, 0);
  vec2 fl = floor(p);
  vec2 f = p - fl;
  ivec2 b = ivec2(fl);
  // 12-texel neighbourhood (4×4 without corners); naming tXY with X,Y ∈ 0..3 ↔ offset (X−1, Y−1).
  float t10 = hT(tex, b + ivec2(0, -1), size), t20 = hT(tex, b + ivec2(1, -1), size);
  float t01 = hT(tex, b + ivec2(-1, 0), size), t11 = hT(tex, b, size);
  float t21 = hT(tex, b + ivec2(1, 0), size), t31 = hT(tex, b + ivec2(2, 0), size);
  float t02 = hT(tex, b + ivec2(-1, 1), size), t12 = hT(tex, b + ivec2(0, 1), size);
  float t22 = hT(tex, b + ivec2(1, 1), size), t32 = hT(tex, b + ivec2(2, 1), size);
  float t13 = hT(tex, b + ivec2(0, 2), size), t23 = hT(tex, b + ivec2(1, 2), size);
  h = mix(mix(t11, t21, f.x), mix(t12, t22, f.x), f.y);
  // At the far apron edge (texel b+2 missing) fall back to a one-sided difference;
  // clamped fetches would otherwise halve the gradient and draw a seam line.
  // Same at the near edge (texel b−1 missing; mesh edges lie half a texel outside the owned cells).
  float ex = b.x + 2 <= size.x - 1 ? 0.5 : 1.0;
  float ey = b.y + 2 <= size.y - 1 ? 0.5 : 1.0;
  float wx = b.x >= 1 ? 0.5 : 1.0;
  float wy = b.y >= 1 ? 0.5 : 1.0;
  vec2 g11 = vec2(wx * (t21 - (b.x >= 1 ? t01 : t11)), wy * (t12 - (b.y >= 1 ? t10 : t11)));
  vec2 g21 = vec2(ex * (t31 - t11), wy * (t22 - (b.y >= 1 ? t20 : t21)));
  vec2 g12 = vec2(wx * (t22 - (b.x >= 1 ? t02 : t12)), ey * (t13 - t11));
  vec2 g22 = vec2(ex * (t32 - t12), ey * (t23 - t21));
  g = mix(mix(g11, g21, f.x), mix(g12, g22, f.x), f.y);
}

// Bilinear height only (4 fetches).
float bilinearHeight(highp sampler2D tex, vec2 p) {
  ivec2 size = textureSize(tex, 0);
  vec2 fl = floor(p);
  vec2 f = p - fl;
  ivec2 b = ivec2(fl);
  float a = hT(tex, b, size);
  float c = hT(tex, b + ivec2(1, 0), size);
  float d = hT(tex, b + ivec2(0, 1), size);
  float e = hT(tex, b + ivec2(1, 1), size);
  return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
}

float hillshadeDirs(vec3 n, float az0, float el, int dirs) {
  dirs = max(dirs, 1);
  float s = 0.0;
  float ce = cos(el);
  float se = sin(el);
  for (int k = 0; k < 16; k++) {
    if (k >= dirs) break;
    float az = az0 + float(k) * 6.28318530718 / float(dirs);
    vec3 L = vec3(ce * sin(az), se, -ce * cos(az)); // +x east, −z north
    s += max(dot(n, L), 0.0);
  }
  return s / float(dirs);
}

vec3 applyFog(vec3 col, vec3 world, vec3 fogColor, float density) {
  float d = length(world - cameraPosition);
  float fog = 1.0 - exp(-pow(d * density, 2.0));
  return mix(col, fogColor, clamp(fog, 0.0, 0.85));
}
