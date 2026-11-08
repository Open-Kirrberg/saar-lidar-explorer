// Terrain fragment shader (GLSL3). heightSample.glsl is prepended.
// A *base* channel and an optional *overlay* channel each turn a source (live hillshade, live
// slope, live local relief or a u8 manifest layer) into a physical value, stretch it
// (lo, hi, gamma) and colour it; the overlay is blended over the base with a blend mode.
// An `rgb` image layer (F13/F14: orthophoto, historic map) is a colour source instead: it skips
// value/stretch/colormap and is blended like any other channel colour.
// uValuePass = 1 writes the raw physical values instead (R = base, G = overlay, A = valid)
// for percentile contrast stretching.
// The Relikt-Blick lens (V2.5, ADR 0035) is a third channel (slot C) mixed over the result with
// uLensMix, plus a glow around up to GLOW_MAX candidates; it never touches base/overlay.

uniform highp sampler2D uHeight;   // per chunk, R32F
uniform float uChunkSize;
uniform float uCellSize;           // per chunk: metres per height pixel (level cell size)

uniform sampler2D uLayerA;         // per chunk: R8 u8 layer with 1-texel apron ((n+2)²), or an sRGB image (no apron)
uniform float uHasLayerA;
uniform vec2 uLayerARange;         // manifest min / max for decoding
uniform int uLayerAAlt;            // per chunk: source when layer A is not available at this level (−1 none)
uniform sampler2D uLayerB;         // per chunk, overlay layer
uniform float uHasLayerB;
uniform vec2 uLayerBRange;
uniform int uLayerBAlt;
uniform float uImgPxA;             // per chunk: image px per chunk side (P) in slot A / B; images carry a
uniform float uImgPxB;             // 1-texel apron ((P+2)²) from their neighbours (seam fix)
uniform sampler2D uLayerC;         // per chunk: lens slot C (u8 layer with apron, or an sRGB image)
uniform float uHasLayerC;
uniform int uLayerCAlt;
uniform float uImgPxC;
uniform vec2 uLayerCRange;

uniform float uLensMix;            // 0 = lens off … 1 = lens channel only
uniform int uLensSrc;              // −1 off, 0/1 live, 7 layer C, 8 image C
uniform int uLensCmap;
uniform vec3 uLensStretch;
uniform float uLensShade;
uniform vec3 uLensTint;            // multiplies the lens colour (warm paper tint)
uniform vec4 uGlow[GLOW_MAX];      // candidate glow: world x, z, radius m, strength
uniform int uGlowCount;
uniform vec3 uGlowBound;           // x, z, R: each ring centre + 3 × radius lies within R of (x, z)
uniform vec3 uGlowColor;
uniform float uGlowTime;
uniform float uGlowMix;            // glow fade 0–1 (lens transition)
uniform float uGlowPx;             // metres per pixel at 1 m distance

uniform highp sampler2D uLowpass;  // per chunk: box-blurred heights on the height-image grid (R32F)
uniform float uHasLowpass;

uniform int uBaseSrc;              // 0 hillshade, 1 slope, 2 local relief, 3 layer A, 5 image A
uniform int uBaseCmap;             // see relief.ts Colormap
uniform vec3 uBaseStretch;         // lo, hi, gamma
uniform float uBaseShade;          // hillshade modulation on colour maps

uniform int uOvlSrc;               // −1 off, 0–2 live, 4 layer B, 6 image B
uniform int uOvlCmap;
uniform vec3 uOvlStretch;
uniform float uOvlShade;
uniform float uOvlOpacity;
uniform int uOvlBlend;             // see relief.ts BlendMode

uniform int uValuePass;

// S2 (contract "Derived relief modes"): live VAT `rvt-vat-combined-v1` from svf + opns_pos.
uniform sampler2D uVatSvf;         // per chunk: svf u8 with 1-texel apron
uniform sampler2D uVatOpn;         // per chunk: opns_pos u8 with 1-texel apron
uniform float uHasVatIn;           // 1 = both inputs resident
uniform vec2 uVatSvfRange;
uniform vec2 uVatOpnRange;
uniform int uQuadMask;             // per chunk: quadrants drawn by finer children (partial parent) → discard

uniform float uExag;
uniform float uShadeZ;             // extra z-factor for shading only
uniform float uSunAz;              // radians, clockwise from north
uniform float uSunEl;              // radians
uniform int uSunDirs;              // 1 = single light, >1 = multi-directional
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uLodColor;
uniform float uLodTint;

in vec2 vPx;
in vec3 vWorld;
out vec4 fragColor;

float lowpassAt(vec2 px) {
  ivec2 size = textureSize(uLowpass, 0);
  vec2 c = clamp(px, vec2(0.0), vec2(size - 1));
  vec2 fl = floor(c);
  vec2 f = c - fl;
  ivec2 b = ivec2(fl);
  ivec2 m = size - 1;
  float a = texelFetch(uLowpass, b, 0).r;
  float bx = texelFetch(uLowpass, min(b + ivec2(1, 0), m), 0).r;
  float cy = texelFetch(uLowpass, min(b + ivec2(0, 1), m), 0).r;
  float d = texelFetch(uLowpass, min(b + ivec2(1, 1), m), 0).r;
  return mix(mix(a, bx, f.x), mix(cy, d, f.x), f.y);
}

vec3 viridis(float t) {
  t = clamp(t, 0.0, 1.0);
  const vec3 c0 = vec3(0.2777273272234177, 0.005407344544966578, 0.3340998053353061);
  const vec3 c1 = vec3(0.1050930431085774, 1.404613529898575, 1.384590162594685);
  const vec3 c2 = vec3(-0.3308618287255563, 0.214847559468213, 0.09509516302823659);
  const vec3 c3 = vec3(-4.634230498983486, -5.799100973351585, -19.33244095627987);
  const vec3 c4 = vec3(6.228269936347081, 14.17993336680509, 56.69055260068105);
  const vec3 c5 = vec3(4.776384997670288, -13.74514537774601, -65.35303263337234);
  const vec3 c6 = vec3(-5.435455855934631, 4.645852612178535, 26.3124352495832);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}

// Blue – white – red, s ∈ [−1, 1] (negative = depressions, positive = elevations).
vec3 diverging(float s) {
  s = clamp(s, -1.0, 1.0);
  const vec3 nB = vec3(0.13, 0.30, 0.62);
  const vec3 nM = vec3(0.56, 0.72, 0.87);
  const vec3 z0 = vec3(0.96, 0.95, 0.92);
  const vec3 pM = vec3(0.94, 0.63, 0.47);
  const vec3 pR = vec3(0.68, 0.11, 0.15);
  if (s < 0.0) {
    float t = -s;
    return t < 0.5 ? mix(z0, nM, t * 2.0) : mix(nM, nB, t * 2.0 - 1.0);
  }
  return s < 0.5 ? mix(z0, pM, s * 2.0) : mix(pM, pR, s * 2.0 - 1.0);
}

vec3 canopyRamp(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  vec3 a = vec3(0.93, 0.91, 0.72), b = vec3(0.66, 0.80, 0.42), c = vec3(0.30, 0.60, 0.26);
  vec3 d = vec3(0.10, 0.36, 0.17), e = vec3(0.04, 0.20, 0.11);
  if (t < 1.0) return mix(a, b, t);
  if (t < 2.0) return mix(b, c, t - 1.0);
  if (t < 3.0) return mix(c, d, t - 2.0);
  return mix(d, e, t - 3.0);
}

// Physical value → colour. Mirrors relief.ts normalise()/colorFor().
// `isFlat` is set for grey maps (which are not hillshade-modulated).
vec3 colorize(float v, int cmap, vec3 st, float hs, out bool isFlat) {
  float lo = st.x, hi = st.y;
  float ig = 1.0 / max(st.z, 1e-3);
  isFlat = cmap <= 1;
  if (cmap == 2) {
    float s = (lo < 0.0 && hi > 0.0) ? (v < 0.0 ? -v / lo : v / hi) : 2.0 * (v - lo) / max(hi - lo, 1e-9) - 1.0;
    s = clamp(s, -1.0, 1.0);
    return diverging(sign(s) * pow(abs(s), ig));
  }
  float t = clamp((v - lo) / max(hi - lo, 1e-9), 0.0, 1.0);
  if (cmap == 5) {
    // Categorical mask over a neutral hillshade: 0 plain, 0.5 orange, 1 magenta.
    float k = floor(t * 2.0 + 0.5);
    vec3 grey = vec3(0.12) + hs * vec3(0.82);
    if (k < 0.5) { isFlat = true; return grey; }
    vec3 c = k < 1.5 ? vec3(0.95, 0.60, 0.20) : vec3(0.85, 0.15, 0.45);
    return c;
  }
  t = pow(t, ig);
  if (cmap == 1) return vec3(1.0 - t);
  if (cmap == 3) return viridis(t);
  if (cmap == 4) return canopyRamp(t);
  return vec3(t);
}

// Live slope (degrees) — stands in for a `slope` layer on levels that don't carry it.
bool sourceValue1(vec2 g, out float v) {
  v = degrees(atan(length(g)));
  return true;
}

// RVT 'VAT combined' preset p = (slope max °, opns min °, opns max °, svf min). Mirrors
// terrain/liveVat.ts vatPreset() exactly, incl. rvt's in-place overlay (full strength).
float vatPreset(float hs, float slopeDeg, float svf, float opns, vec4 p) {
  float r = 0.5 * (1.0 - clamp(slopeDeg / p.x, 0.0, 1.0)) + 0.5 * hs;    // slope, luminosity 50 %
  float o = clamp((opns - p.y) / (p.z - p.y), 0.0, 1.0);
  r = r > 0.5 ? 1.0 - (1.0 - 2.0 * (r - 0.5)) * (1.0 - o) : 2.0 * r * o;  // positive openness, overlay
  float v = clamp((svf - p.w) / (1.0 - p.w), 0.0, 1.0);
  return 0.75 * r + 0.25 * v * r;                                         // svf, multiply 25 %
}

// Live VAT from the true-height gradient g (per metre; x east, y south), fixed sun 315° / 35°.
bool liveVatValue(vec2 g, vec2 uv, out float v) {
  v = 0.0;
  if (uHasVatIn < 0.5) return false;
  float slopeDeg = degrees(atan(length(g)));
  float hs = clamp(hillshadeDirs(normalize(vec3(-g.x, 1.0, -g.y)), radians(315.0), radians(35.0), 1), 0.0, 1.0);
  float svf = mix(uVatSvfRange.x, uVatSvfRange.y, texture(uVatSvf, uv).r);
  float opns = mix(uVatOpnRange.x, uVatOpnRange.y, texture(uVatOpn, uv).r);
  v = 0.5 * vatPreset(hs, slopeDeg, svf, opns, vec4(50.0, 68.0, 93.0, 0.7))
    + 0.5 * vatPreset(hs, slopeDeg, svf, opns, vec4(15.0, 85.0, 91.0, 0.9));
  return true;
}

// Stand-in source of a slot whose layer this chunk's source does not carry: 1 live slope,
// 9 live VAT (derived `rvt-vat-combined-v1`), else none (→ fallback hillshade).
bool altValue(int alt, vec2 g, vec2 uv, out float v) {
  v = 0.0;
  if (alt == 1) return sourceValue1(g, v);
  if (alt == 9) return liveVatValue(g, uv, v);
  return false;
}

// Returns false where the source has no data here (layer not loaded yet etc.).
bool sourceValue(int src, float h, vec2 g, float hs, vec2 uv, out float v) {
  v = 0.0;
  if (src == 0) { v = hs; return true; }
  if (src == 1) { v = degrees(atan(length(g))); return true; }
  if (src == 2) {
    if (uHasLowpass < 0.5) return false;
    v = h - lowpassAt(vPx);
    return true;
  }
  if (src == 3) {
    if (uHasLayerA < 0.5) return altValue(uLayerAAlt, g, uv, v);
    v = mix(uLayerARange.x, uLayerARange.y, texture(uLayerA, uv).r);
    return true;
  }
  if (src == 4) {
    if (uHasLayerB < 0.5) return altValue(uLayerBAlt, g, uv, v);
    v = mix(uLayerBRange.x, uLayerBRange.y, texture(uLayerB, uv).r);
    return true;
  }
  if (src == 7) {
    if (uHasLayerC < 0.5) return altValue(uLayerCAlt, g, uv, v);
    v = mix(uLayerCRange.x, uLayerCRange.y, texture(uLayerC, uv).r);
    return true;
  }
  return false;
}

// sRGB texture → linear on sampling; the terrain writes display-space colours, so re-encode.
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

// Image source colour (src 5 = slot A, 6 = slot B); false while that chunk's image is missing.
// uvImg ∈ [0, 1] over the chunk's P image px → apron texture: (uvImg·P + 1) / (P + 2).
bool imageColor(int src, vec2 uvImg, out vec3 c) {
  c = vec3(0.0);
  if (src == 5 && uHasLayerA > 0.5) { c = linearToSrgb(texture(uLayerA, (uvImg * uImgPxA + 1.0) / (uImgPxA + 2.0)).rgb); return true; }
  if (src == 6 && uHasLayerB > 0.5) { c = linearToSrgb(texture(uLayerB, (uvImg * uImgPxB + 1.0) / (uImgPxB + 2.0)).rgb); return true; }
  if (src == 8 && uHasLayerC > 0.5) { c = linearToSrgb(texture(uLayerC, (uvImg * uImgPxC + 1.0) / (uImgPxC + 2.0)).rgb); return true; }
  return false;
}

// Lens glow: a pulsing rim + soft fill around each candidate (radius ≥ ~8 px on screen, so far
// candidates stay findable). Returns the glow amount (0 … ~1.5).
float lensGlow(vec3 w) {
  float camD = length(w - cameraPosition);
  float px = max(camD * uGlowPx, 1e-3);   // metres per screen pixel here
  // A ring reaches 3·max(r, 8 px) + 24 px ≤ 3·r + 48 px: outside the bounding circle no ring can
  // touch this fragment, so most of the screen skips the loop (it scales with the ring count).
  vec2 bd = w.xz - uGlowBound.xy;
  float bR = uGlowBound.z + 48.0 * px;
  if (uGlowBound.z < 0.0 || dot(bd, bd) > bR * bR) return 0.0;
  float acc = 0.0;
  for (int i = 0; i < GLOW_MAX; i++) {
    if (i >= uGlowCount) break;
    vec4 gl = uGlow[i];
    vec2 dv = w.xz - gl.xy;
    float r = max(gl.z, 8.0 * px);
    float reach = 3.0 * r + 24.0 * px;
    float d2 = dot(dv, dv);
    if (d2 > reach * reach) continue;   // far from this ring: no sqrt, no exp()
    float d = sqrt(d2);
    float q = (d - r) / max(0.18 * r, 1.6 * px);
    float rim = exp(-q * q);
    float fill = 0.28 * (1.0 - smoothstep(0.0, r, d));
    float hq = max(d - r, 0.0) / (0.6 * r + 6.0 * px);
    float halo = 0.35 * exp(-hq * hq);
    acc += (rim + fill + halo) * gl.w;
  }
  return acc;
}

vec3 blendColor(vec3 b, vec3 o, int mode) {
  if (mode == 1) return b * o;
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - o);
  if (mode == 3) return mix(2.0 * b * o, 1.0 - 2.0 * (1.0 - b) * (1.0 - o), step(0.5, b));
  if (mode == 4) return (1.0 - 2.0 * o) * b * b + 2.0 * o * b;
  return o;
}

void main() {
  if (uQuadMask != 0) {
    // Partial parent: quadrant (a, b) split at the chunk's half (owned pixels 0.5 … n + 0.5).
    float split = 0.5 * uChunkSize + 0.5;
    int q = (vPx.x >= split ? 1 : 0) + (vPx.y >= split ? 2 : 0);
    if ((uQuadMask & (1 << q)) != 0) discard;
  }
  float h;
  vec2 g;
  sampleHeight(uHeight, vPx, h, g);
  g /= uCellSize; // per pixel → per metre (coarse levels)
  float k = uExag * uShadeZ;
  vec3 n = normalize(vec3(-g.x * k, 1.0, -g.y * k));
  float hs = hillshadeDirs(n, uSunAz, uSunEl, uSunDirs);
  // u8 layers carry a 1-texel apron like the height image: height pixel p ↔ layer texel p, so
  // bilinear sampling interpolates across chunk borders (no clamp band → no seam line).
  vec2 uv = (vPx + 0.5) / (uChunkSize + 2.0);
  // Images cover exactly the chunk's cells: mesh edge (p = 0.5) ↔ u = 0 (apron added in imageColor).
  vec2 uvImg = (vPx - 0.5) / uChunkSize;

  float vb, vo;
  vec3 imgB, imgO;
  bool isImgB = uBaseSrc >= 5;
  bool isImgO = uOvlSrc >= 5;
  // Images are colours, not values: never part of the auto-contrast value pass (valid flag 0).
  bool okB = isImgB ? imageColor(uBaseSrc, uvImg, imgB) : sourceValue(uBaseSrc, h, g, hs, uv, vb);
  bool okO = uOvlSrc >= 0 && (isImgO ? imageColor(uOvlSrc, uvImg, imgO) : sourceValue(uOvlSrc, h, g, hs, uv, vo));

  if (uValuePass == 1) {
    if (isImgB) okB = false;
    if (isImgO) okO = false;
    fragColor = vec4(okB ? vb : 0.0, okO ? vo : 0.0, okB ? 1.0 : 0.0, okO ? 1.0 : 0.0);
    return;
  }

  float shadeLit = 0.35 + 1.1 * hs;
  bool flatC;
  vec3 col;
  if (okB && isImgB) {
    col = imgB * mix(1.0, shadeLit, uBaseShade); // optional live hillshade on the picture
  } else if (okB) {
    col = colorize(vb, uBaseCmap, uBaseStretch, hs, flatC);
    if (!flatC) col *= mix(1.0, shadeLit, uBaseShade);
  } else {
    // Fallback while a layer is loading: warm-tinted grey hillshade.
    col = vec3(0.04) + hs * vec3(0.98, 0.96, 0.92);
  }
  if (okO) {
    vec3 oc;
    if (isImgO) {
      oc = imgO * mix(1.0, shadeLit, uOvlShade);
    } else {
      oc = colorize(vo, uOvlCmap, uOvlStretch, hs, flatC);
      if (!flatC) oc *= mix(1.0, shadeLit, uOvlShade);
    }
    col = mix(col, clamp(blendColor(col, oc, uOvlBlend), 0.0, 1.0), uOvlOpacity);
  }

  float glow = 0.0;
  if (uLensMix > 0.0) {
    vec3 lc;
    float lv;
    bool okL = uLensSrc >= 8 ? imageColor(uLensSrc, uvImg, lc) : sourceValue(uLensSrc, h, g, hs, uv, lv);
    if (okL && uLensSrc >= 8) {
      lc *= mix(1.0, shadeLit, uLensShade);
    } else if (okL) {
      lc = colorize(lv, uLensCmap, uLensStretch, hs, flatC);
      if (!flatC) lc *= mix(1.0, shadeLit, uLensShade);
    } else {
      // Lens layer still loading (or missing at this level): neutral hillshade.
      lc = vec3(0.06) + hs * vec3(0.9);
    }
    col = mix(col, clamp(lc * uLensTint, 0.0, 1.0), uLensMix);
    if (uGlowCount > 0 && uGlowMix > 0.0) glow = lensGlow(vWorld) * uGlowMix;
  }

  col = mix(col, col * uLodColor, uLodTint);
  col = applyFog(col, vWorld, uFogColor, uFogDensity);
  if (glow > 0.0) {
    float pulse = 0.78 + 0.22 * sin(uGlowTime * 3.2);
    float a = clamp(glow * pulse, 0.0, 1.0);
    col = mix(col, uGlowColor, 0.8 * a) + uGlowColor * 0.25 * a; // emissive: drawn over the haze
  }
  fragColor = vec4(col, 1.0);
}
