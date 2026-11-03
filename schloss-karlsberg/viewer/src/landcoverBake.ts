/**
 * Land-cover albedo bake (wave-2 review, perf + look): the cultivated patterns (hay parcels with windrows, field
 * strips with balks and headlands, vine row groups, kitchen-garden quarters) and the lawn / meadow / forest-floor
 * tones are rendered ONCE into a mipmapped texture over the terrain crop (1 m texels, 3 × 3 supersampled), instead of
 * being evaluated per pixel in the terrain shader. The terrain shader then takes one (anisotropic) fetch of this
 * texture times the grass detail; only the 1.1 m vine rows stay analytic near the camera (too fine for the bake).
 *
 * Edges: the class weights come in the blurred-weight encoding (landcover.ts smoothWeights, smooth 0.5 iso-lines
 * instead of the 2 m staircase), looked up with a smooth edge wobble (±3 m + ±0.8 m for hay and fields, ±0.5 m for
 * the staked vineyard and the walled kitchen gardens, ±1 m for lawn, forest floor and water); a distance texture (landcover.ts groundDistances) adds grass margins and
 * headlands along field edges, trodden verges and desire paths near paths and courts, lusher grass by the water.
 *
 * Texture layout (RGBA8, linear sampling, mipmaps): RGB = sqrt(linear albedo) (8-bit precision for the dark forest
 * floor), A = 0.5 · cultivated weight (hay, field, kitchen garden) + 1.0 · vineyard weight (decode in terrain.ts).
 */
import * as THREE from 'three';
import { FIELD_DIR, FIELD_ROTATION, MAX_PARCEL_SEGMENTS, bakeGrid } from './landcover.ts';
import { PLEASURE_GROUND } from '@model/layout/grammar.ts';
import { ZONE_SCALE } from './lawnZones.ts';

export interface LandBakeUniforms {
  tWeights: THREE.IUniform<THREE.Texture>;
  tCult: THREE.IUniform<THREE.Texture>;
  tMacro: THREE.IUniform<THREE.Texture>;
  tDist: THREE.IUniform<THREE.Texture>;
  tNoise: THREE.IUniform<THREE.Texture>;
  uDistScale: THREE.IUniform<number>;
  uGroundOrigin: THREE.IUniform<THREE.Vector2>;
  uGroundSize: THREE.IUniform<THREE.Vector2>;
  uShowClasses: THREE.IUniform<number>;
  uGridU: THREE.IUniform<THREE.Vector2>;
  uVineAcross: THREE.IUniform<THREE.Vector2>;
  uHayGreen: THREE.IUniform<THREE.Vector3>;
  uHayStraw: THREE.IUniform<THREE.Vector3>;
  uFieldGold: THREE.IUniform<THREE.Vector3>;
  uFieldGreen: THREE.IUniform<THREE.Vector3>;
  uFallow: THREE.IUniform<THREE.Vector3>;
  uStubble: THREE.IUniform<THREE.Vector3>;
  /** wave 11 (KB-I84): spelt, oats, clover and the ploughed fallow of the three-field rotation */
  uSpelt: THREE.IUniform<THREE.Vector3>;
  uOats: THREE.IUniform<THREE.Vector3>;
  uClover: THREE.IUniform<THREE.Vector3>;
  uPlough: THREE.IUniform<THREE.Vector3>;
  /** wave 11: contour direction per field block (landcover.ts fieldBlockDirs, FIELD_DIR²) */
  tFieldDir: THREE.IUniform<THREE.Texture>;
  uVine: THREE.IUniform<THREE.Vector3>;
  uSoil: THREE.IUniform<THREE.Vector3>;
  uGardenSoil: THREE.IUniform<THREE.Vector3>;
  uParterreCol: THREE.IUniform<THREE.Vector3>;
  uMeadow: THREE.IUniform<THREE.Vector3>;
  uMeadowDry: THREE.IUniform<THREE.Vector3>;
  uMeadowLush: THREE.IUniform<THREE.Vector3>;
  uLawn: THREE.IUniform<THREE.Vector3>;
  uLawnDry: THREE.IUniform<THREE.Vector3>;
  uWorn: THREE.IUniform<THREE.Vector3>;
  uTrack: THREE.IUniform<THREE.Vector3>;
  uBalk: THREE.IUniform<THREE.Vector3>;
  /** vineyard outline as edge segments (landcover.ts ringSegments, local x/z); uVineSegN 0 = use the class raster */
  uVineSeg: THREE.IUniform<THREE.Vector4[]>;
  uVineSegN: THREE.IUniform<number>;
}

/**
 * Vineyard rows, shared by the bake (area average) and the terrain shader (analytic rows near the camera), so the
 * two meet without a seam [N/I research/11 S10; D PV "rows over red-brown soil"]:
 * - rows 1.1 m apart down the slope; in July the leaf wall is ~0.5-0.9 m wide, swelling plant by plant (one vine per
 *   ~1 m on its own stake, the Pfahlerziehung of the period [N]), with leaf clusters (`clump` noise) and rounded
 *   shading (lit crown, darker flanks); hoed red-brown Buntsandstein soil between, barely greyed [N July hoeing; D PV
 *   "red-brown vine rows"; I] (wave-3 review fix: the old 45 % grey soil and dark leaf read as a cloud shadow);
 * - grassy contour walks (Querwege) 1.6 m wide every 30 m [N; I spacing];
 * - area average = 58.3 % leaf at 0.877 of the leaf colour over the soil at 0.897 (the numeric mean of vineRows over
 *   rows, plants and clumps, lattice noise; luminance ≈ 0.21 against meadow 0.18 and hay 0.32).
 * Wave 5 (pose 11, "too strident"): the July leaf is a dull olive (vineLeaf: 28 % toward its own luminance in an olive
 * grey (1, 1, 0.68), ×1.06), the soil between the rows less red and darker (vineSoil: 35 % grey, ×0.92; the area
 * mean keeps its luminance ≈ 0.21), and the row contrast
 * eases toward the area mean with the pixel footprint (15 % at the camera, 60 % at 9 cm per pixel) before the caller's
 * hand-over to the bake. vineLeaf / vineSoil are linear in their colour and the contrast fade mixes toward the exact
 * mean, so the analytic rows and the bake keep the same area mean [I hues].
 */
export const VINE_GLSL = /* glsl */ `
const vec3 VINE_GRASS = vec3(0.205, 0.227, 0.085); // linear #7D8351, the balk grass of GROUND_COLOURS
vec3 vineSoil(vec3 soil){ return mix(soil, vec3(dot(soil, vec3(0.2126, 0.7152, 0.0722))), 0.35) * vec3(0.92, 0.96, 0.78); }
vec3 vineLeaf(vec3 vine){ return mix(vine, dot(vine, vec3(0.2126, 0.7152, 0.0722)) * vec3(1.0, 1.0, 0.68), 0.28) * 1.06; }
vec3 vineAverage(vec3 vine, vec3 soil){ return mix(vineSoil(soil) * 0.897, vineLeaf(vine) * 0.877, 0.583); }
// clump: leaf-cluster noise along the row (0..1); stock: 0..1 strength of the plant-by-plant swelling (one vine
// per ~1 m on its stake), faded by the caller where the 1 m period would alias; pr: pixel footprint across the rows (m),
// which widens the leaf and shadow edges into a box filter of that width (KB-I59: no stair-stepped, aliasing edges
// before the caller fades the rows into the area average)
vec3 vineRows(vec2 xz, vec2 across, vec3 vine, vec3 soil, float clump, float stock, float pr){
  float q = dot(xz, across) / 1.1;
  float along = dot(xz, vec2(-across.y, across.x));
  float r = abs(fract(q) - 0.5) * 1.1;
  float plant = mix(0.5, 0.5 + 0.5 * cos(6.2832 * (along + 0.37 * floor(q))), stock);
  float hw = 0.24 + 0.12 * plant + 0.08 * clump;
  float e = 0.5 * pr;
  float leaf = 1.0 - smoothstep(hw - 0.07 - e, hw + 0.03 + e, r);
  float shade = (0.66 + 0.42 * clamp(1.0 - r / hw, 0.0, 1.0)) * (0.8 + 0.38 * clump);
  // the leaf wall shades the soil beside it
  float soilSh = 0.78 + 0.22 * smoothstep(hw - e, hw + 0.18 + e, r);
  vec3 c = mix(vineSoil(soil) * (1.06 - 0.12 * clump) * soilSh, vineLeaf(vine) * shade, leaf);
  return mix(c, vineAverage(vine, soil), 0.15 + 0.45 * smoothstep(0.015, 0.09, pr));
}
float vinePath(vec2 xz, vec2 across){
  float along = dot(xz, vec2(-across.y, across.x));
  return 1.0 - smoothstep(0.55, 0.95, abs(fract(along / 30.0 + 0.5) - 0.5) * 30.0);
}
vec3 vinePathCol(vec3 soil){ return mix(vineSoil(soil), VINE_GRASS, 0.55); }
// Wave-7 review fix (poses 11, 41): the far look of the 3D plants (viewer/src/vines.ts). Seen from the side, the 1 m
// leaf columns hide the soil between the rows: 'vineCover' is the share of the ground they hide from a view ray at
// sinT (sine of its elevation over the slope), looking across the rows by acrossC (|cos| between the horizontal view
// direction and the across-row direction): 0.583 straight down (the area average), toward 1 at grazing views, faster
// across the rows (walls 1.1 m apart) than along them (gaps between the plants) [I geometry]. 'vineCanopy' is the
// mean rendered albedo of the 3D plants (shaded flanks and lit tops through the foliage shading), measured at 41 / 11
// (#5B673E rendered against #83855F for the painted area mean) [I, measured].
vec3 vineCanopy(vec3 vine){ return vineLeaf(vine) * vec3(0.44, 0.40, 0.36); }
float vineCover(float sinT, float acrossC){
  float cotT = sqrt(max(1.0 - sinT * sinT, 0.0)) / max(sinT, 0.03);
  return 1.0 - 0.417 * exp(-cotT * (acrossC / 1.1 + (1.0 - acrossC) * 0.5));
}
`;

/**
 * Gewann strip frame shared by the bake (crops per strip) and the terrain shader (balk and furrow lines per pixel, so
 * they hold at ≥ 1 px from 450 m up; wave-3 review fix). Mirrored on the CPU by landcover.ts `fieldStrip`
 * [N Gewannflur; I sizes]: blocks of 190 × 150 m in the palace grid warped by 30 m of 160 m noise (`warp` =
 * (vn(xz / 160), vn(xz / 160 + 7.3)) from the shared lattice), strips 12-24 m wide, an alternating ±5.5 % value step
 * (±1.5 % jitter) so neighbouring strips differ by ≥ 8 % even with the same crop, a grass balk on half of the strip
 * edges and a plain furrow on the rest.
 * Wave 11 (KB-I84, audit #2): the strips of a block run along its contour (`tFieldDir`, landcover.ts fieldBlockDirs;
 * the wave-3 hash axis where the block is flat), and the crops follow the three-field rotation: one Zelge per block
 * (winter grain, summer grain, fallow) and the strip crops inside it (landcover.ts FIELD_ROTATION, fieldCropOf).
 */
export const FIELD_GLSL = /* glsl */ `
const vec2 FIELD_B = vec2(190.0, 150.0);
uniform sampler2D tFieldDir;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
struct FieldFrame { vec2 p; vec2 blk; vec2 fb; vec2 a; vec2 acrossDir; float across; float along; float sw; float sid; float fa; };
FieldFrame fieldFrame(vec2 xz, vec2 gU, vec2 warp){
  FieldFrame F;
  vec2 gV = vec2(-gU.y, gU.x);
  F.p = vec2(dot(xz, gU), dot(xz, gV)) + 30.0 * warp;
  F.blk = floor(F.p / FIELD_B);
  F.fb = F.p - F.blk * FIELD_B;
  vec2 bi = F.blk + ${(FIELD_DIR / 2).toFixed(1)};
  vec4 bd = all(greaterThanEqual(bi, vec2(0.0))) && all(lessThan(bi, vec2(${FIELD_DIR.toFixed(1)}))) ? textureLod(tFieldDir, (bi + 0.5) / ${FIELD_DIR.toFixed(1)}, 0.0) : vec4(0.0);
  vec2 a = hash12(F.blk + 3.1) < 0.55 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  if (bd.g > 0.5) { float ang = bd.r * (255.0 / 256.0) * 3.14159265; a = vec2(cos(ang), sin(ang)); }
  F.a = a;
  F.across = dot(F.p, a);
  F.along = dot(F.p, vec2(-a.y, a.x));
  F.acrossDir = a.x * gU + a.y * gV;
  F.sw = 12.0 + 12.0 * hash12(F.blk + 9.7);
  F.sid = floor(F.across / F.sw);
  F.fa = F.across - F.sid * F.sw;
  return F;
}
// Zelge of the block: 0 winter grain, 1 summer grain, 2 fallow (landcover.ts fieldZelge)
float fieldZelge(FieldFrame F){ float h = hash12(F.blk + vec2(51.7, 23.3)); return h < ${FIELD_ROTATION.zelge[0].toFixed(3)} ? 0.0 : h < ${(FIELD_ROTATION.zelge[0] + FIELD_ROTATION.zelge[1]).toFixed(3)} ? 1.0 : 2.0; }
// reaped / ploughed share of the block width (landcover.ts fieldCutShare)
float fieldCutShare(vec2 blk, vec3 cut){ float h = hash12(blk + vec2(61.3, 17.9)); return h < cut.x ? 0.0 : cut.y + (h - cut.x) / (1.0 - cut.x) * (cut.z - cut.y); }
// 0 rye, 1 spelt, 2 reaped stubble; 3 oats, 4 barley; 5 clover, 6 weedy fallow, 7 ploughed (landcover.ts fieldCropOf):
// one crop per block (Flurzwang), the reapers' / plough's run from the block's low-across side
float fieldCrop(FieldFrame F){
  float z = fieldZelge(F);
  float h = hash12(vec2(F.blk.x * 31.0 + 0.7, F.blk.y * 7.0 + 0.3));
  vec2 b0 = F.blk * FIELD_B;
  float a0 = dot(b0, F.a) + min(0.0, FIELD_B.x * F.a.x) + min(0.0, FIELD_B.y * F.a.y);
  float a1 = dot(b0, F.a) + max(0.0, FIELD_B.x * F.a.x) + max(0.0, FIELD_B.y * F.a.y);
  float t = ((F.sid + 0.5) * F.sw - a0) / max(a1 - a0, 1e-6);
  if (z < 0.5) return t < fieldCutShare(F.blk, vec3(${FIELD_ROTATION.winterCut.map((v) => v.toFixed(3)).join(', ')})) ? 2.0 : h < ${FIELD_ROTATION.winter[0].toFixed(3)} ? 0.0 : 1.0;
  if (z < 1.5) return h < ${FIELD_ROTATION.summer[0].toFixed(3)} ? 3.0 : 4.0;
  return t < fieldCutShare(F.blk, vec3(${FIELD_ROTATION.fallowCut.map((v) => v.toFixed(3)).join(', ')})) ? 7.0 : h < ${FIELD_ROTATION.fallow[0].toFixed(3)} ? 5.0 : 6.0;
}
float fieldStripValue(FieldFrame F){ return (mod(F.sid, 2.0) < 0.5 ? 1.035 : 0.965) * (1.0 + 0.06 * (hash12(vec2(F.sid, 7.0 + F.blk.x)) - 0.5)); }
float fieldHasBalk(FieldFrame F){ return step(0.5, hash12(vec2(floor(F.across / F.sw + 0.5), F.blk.x * 5.0 + F.blk.y + 0.5))); }
`;

/**
 * Wave 10 (garden, audit #1): the meadow-lawn's mowing zones (viewer/src/lawnZones.ts, macro B = 128 + 8 · signed
 * distance, negative = close-mown). Both the bake and the terrain shader turn it into the aftermath-meadow weight with
 * the same ragged scythe edge: ±0.9 m at 1.6 m and ±1.2 m at 7 m (n1, n7 = value noise at xz / 1.6 + 23, xz / 7 + 5).
 * Wave-10 review fix (02: the mown zone round the rondell ended in a straight, hard-edged rectangle from the air): a
 * one-sided 45 m / 17 m warp that lets the mown ground reach up to ZONE_WARP[1] m farther out and pulls it in by at most
 * ZONE_WARP[0] m (so the walk verges never close), so the scythe line wanders at aerial scale too.
 */
export const ZONE_WARP = [1.2, 4.2] as const;
/** Mean straw-windrow weight of a scythed parcel (aftermathSwath wr over one swath pair; the bake carries it, wave-10 review fix). */
export const WINDROW_MEAN = 0.22;
export const ZONE_GLSL = /* glsl */ `
float lawnMeadowAt(float b, vec2 xz, float n1, float n7){
  float sd = (b * 255.0 - 128.0) / ${ZONE_SCALE.toFixed(1)};
  float wA = clamp(zn(xz / 45.0 + 61.0) * 0.7 + zn(xz / 17.0 + 67.0) * 0.3, 0.0, 1.0);
  sd += ${ZONE_WARP[0].toFixed(2)} - wA * ${(ZONE_WARP[0] + ZONE_WARP[1]).toFixed(2)};
  return smoothstep(-0.5, 0.5, sd + (n1 - 0.5) * 1.8 + (n7 - 0.5) * 2.4);
}
// aftermath parcels (≈ 34 × 24 m, warped, on the palace grid; PLEASURE_GROUND.patch): st = the parcel's mowing state
// hash (< 0.45 standing seeding grass, < 0.8 freshly scythed, else regrowth); in scythed parcels wr = the straw windrow
// (one per two 1.7 m swaths), alt = the swath's value step (±1), edge = distance (m) to the parcel edge (the uncut
// margin), sy = the coordinate across the swaths (m; its pixel footprint fades the swaths, wave-10 review fix).
// Needs zn() = mip-0 value noise and hash12 (FIELD_GLSL) in the including shader.
struct Swath { float st; float wr; float alt; float edge; float sy; };
Swath aftermathSwath(vec2 xz, vec2 gU) {
  vec2 gV = vec2(-gU.y, gU.x);
  vec2 aq = vec2(dot(xz, gU), dot(xz, gV)) + 9.0 * vec2(zn(xz / 40.0 + 71.0), zn(xz / 40.0 + 77.0)) + 1.5 * vec2(zn(xz / 9.0 + 81.0), zn(xz / 9.0 + 83.0));
  vec2 PS = vec2(${PLEASURE_GROUND.patch[0].toFixed(1)}, ${PLEASURE_GROUND.patch[1].toFixed(1)});
  vec2 pid = floor(aq / PS);
  vec2 pf = aq - pid * PS;
  Swath S;
  S.st = hash12(pid + 91.3);
  float sw = ${PLEASURE_GROUND.swath.toFixed(2)};
  float sy = pf.y + (zn(vec2(pf.x / 8.0, pid.x * 2.3 + pid.y * 1.9)) - 0.5) * 0.8;
  S.sy = sy;
  S.alt = mod(floor(sy / sw), 2.0) < 0.5 ? 1.0 : -1.0;
  float d = abs(fract(sy / (2.0 * sw)) - 0.5) * 2.0 * sw;
  S.wr = (1.0 - smoothstep(0.3, 0.7, d)) * (0.5 + 0.5 * zn(xz / 5.0 + 51.0));
  S.edge = min(min(pf.x, PS.x - pf.x), min(pf.y, PS.y - pf.y)) + (zn(xz / 3.0 + 3.0) - 0.5) * 1.6;
  return S;
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Pattern colours [I hues; N practice] — see GROUND_COLOURS in terrain.ts for the evidence of each base colour:
 * - meadow / pasture: macro patches of drier, seeding grass (55-140 m and 23 m noise), lusher grass by the water,
 *   in the forest's shade and in "hollows" (noise), fine 2.7 m variation that breaks the grass texture's repeat;
 *   trodden verges along paths and courts (0.5-5 m) and meandering desire paths (~1 m) within ~45 m of them;
 * - lawn: scythed meadow-lawn, drier and yellower patches (±5 % value), a worn edge along the walks;
 * - hay parcels (~95 × 70 m, warped): standing (with a flowering / seeding tint), freshly cut with windrows along the
 *   parcel's long axis (4-6 m apart, ≤ 10 % value contrast), or regrowth; cut parcels keep a 2 m uncut margin
 *   [N mowing practice, wave-2 review];
 * - fields: Gewann blocks (~190 × 150 m) of 12-24 m strips, three-field rotation in July (ripe winter grain, summer
 *   grain, fallow / clover, stubble with stooks), lengthwise streaks of the plough lands, lodged patches, narrow grass
 *   balks or plain furrows between strips, a grass headland (Anwand) at the block edge and a grass margin along the
 *   edge of the field land, dusty field tracks with ruts on about 45 % of the block edges [N Dreifelderwirtschaft,
 *   hand harvest; I shares and widths];
 * - vineyard: VINE_GLSL area average with contour walks;
 * - kitchen gardens: 26 × 20 m quarters, 1.6 m walks of trodden earth, 1.4 m beds + 0.5 m paths [N Sckell; I].
 * No pattern in the bake is finer than ~2 texels, and the 3 × 3 supersampling plus mipmaps filter the rest, so
 * nothing in it can alias into moiré at any distance.
 */
const FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tWeights; uniform sampler2D tCult; uniform sampler2D tNoise; uniform sampler2D tDist;
uniform float uDistScale; uniform vec2 uGroundOrigin; uniform vec2 uGroundSize; uniform float uShowClasses;
uniform vec2 uGridU; uniform vec2 uVineAcross; uniform vec2 uTexel;
uniform vec3 uHayGreen; uniform vec3 uHayStraw; uniform vec3 uFieldGold; uniform vec3 uFieldGreen; uniform vec3 uFallow;
uniform vec3 uStubble; uniform vec3 uSpelt; uniform vec3 uOats; uniform vec3 uClover; uniform vec3 uPlough; uniform vec3 uVine; uniform vec3 uSoil; uniform vec3 uGardenSoil; uniform vec3 uParterreCol;
uniform vec3 uMeadow; uniform vec3 uMeadowDry; uniform vec3 uMeadowLush; uniform vec3 uLawn; uniform vec3 uLawnDry;
uniform vec3 uWorn; uniform vec3 uTrack; uniform vec3 uBalk;
uniform sampler2D tMacro; uniform vec4 uVineSeg[${MAX_PARCEL_SEGMENTS}]; uniform int uVineSegN;
const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
// value noise from the shared lattice, always at mip 0 (the bake has no screen-space derivatives to trust)
float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); return textureLod(tNoise, (i + f*f*(3.0-2.0*f) + 0.5) / 256.0, 0.0).r; }
vec3 lumTo(vec3 c, float L){ return c * (L / max(dot(c, LUM), 1e-4)); }
${VINE_GLSL}
${FIELD_GLSL}
float zn(vec2 p){ return vn(p); }
${ZONE_GLSL}
// signed distance (m) to the vineyard outline (negative inside, even-odd), mirrored by landcover.ts parcelSignedDistance
float vineSd(vec2 p, out vec2 cp){
  float d2 = 1e12;
  bool inside = false;
  cp = p;
  for (int i = 0; i < ${MAX_PARCEL_SEGMENTS}; i++) {
    if (i >= uVineSegN) break;
    vec4 sg = uVineSeg[i];
    vec2 e = sg.zw - sg.xy;
    vec2 w = p - sg.xy;
    vec2 q = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
    if (dot(q, q) < d2) { d2 = dot(q, q); cp = p - q; }
    if ((sg.y > p.y) != (sg.w > p.y) && p.x < e.x * (p.y - sg.y) / e.y + sg.x) inside = !inside;
  }
  return (inside ? -1.0 : 1.0) * sqrt(d2);
}
// class weights in the blurred-weight encoding (landcover.ts smoothWeights): one bilinear fetch has smooth
// iso-lines; re-sharpened around 0.5 to a ~1.5 m soft edge
vec4 classes(sampler2D t, vec2 p, float s){ return smoothstep(0.5 - s, 0.5 + s, texture2D(t, (p - uGroundOrigin) / uGroundSize)); }
// field track along a Gewann block edge: e = signed distance (m) to the edge, side = ±1, 2.6 m wide, 3 m inside
float edgeTrack(float e, float side){ return 1.0 - smoothstep(1.0, 1.45, abs(e - side * 3.0)); }

vec4 land(vec2 xz) {
  vec2 gU = uGridU;
  vec2 gV = vec2(-gU.y, gU.x);
  // edge wobble: ±1 m for lawn / forest floor / water, ±3 m (40 m) + ±0.8 m (9 m) for the cultivated classes
  vec2 wS = (vec2(vn(xz / 5.0), vn(xz / 5.0 + 17.3)) - 0.5) * 2.0;
  vec2 wL = (vec2(vn(xz / 40.0 + 3.7), vn(xz / 40.0 + 11.1)) - 0.5) * 6.0 + (vec2(vn(xz / 9.0 + 5.5), vn(xz / 9.0 + 8.8)) - 0.5) * 1.6;
  // vineyard: the exact staked-out outline (≤ 1 m edge) where the class raster still has the vineyard (features painted
  // over it stay), and a 1.6 m grass headland (Anwand) inside it for turning at the row ends [N; I width]. The edge is
  // exclusive: inside, the other classes yield; in a 3.5 m fringe outside, they are looked up 3.5 m out, so the
  // blurred, wobbled neighbour (hay) runs right up to the edge instead of a soft meadow seam.
  float vineHead = 0.0;
  float inV = 0.0;
  vec2 xzc = xz;
  if (uVineSegN > 0) {
    vec2 cp;
    float sd = vineSd(xz, cp);
    inV = (1.0 - smoothstep(-0.25, 0.25, sd)) * smoothstep(0.04, 0.2, texture2D(tCult, (xz - uGroundOrigin) / uGroundSize).b) * uShowClasses;
    vineHead = inV * (1.0 - smoothstep(1.4, 1.8, -sd));
    if (sd > 0.0 && sd < 3.5) xzc = cp + (xz - cp) * (3.5 / sd);
  }
  vec4 w = classes(tWeights, xzc + wS, 0.22) * uShowClasses;
  vec4 cu = classes(tCult, xzc + wL, 0.22) * uShowClasses;
  // kitchen gardens are walled: straighter edges (±0.5 m) than meadows
  cu.ba = classes(tCult, xzc + wS * 0.5, 0.22).ba * uShowClasses;
  // fields: the parcel edge as rasterised (no wobble), the same weight the terrain shader gates its strip lines with
  cu.g = classes(tCult, xzc, 0.22).g * uShowClasses;
  if (uVineSegN > 0) {
    w.rba *= 1.0 - inV;
    cu.rga *= 1.0 - inV;
    cu.b = inV;
  }
  // R hard surface, G forest, B inward from the own cultivated class edge, A water (metres)
  vec4 dd = texture2D(tDist, (xz + wS * 0.5 - uGroundOrigin) / uGroundSize) * uDistScale;
  float n1 = vn(xz / 2.7 + 31.0);
  float n9 = vn(xz / 9.0);
  float n23 = vn(xz / 23.0 + 2.2);
  float nBig = vn(xz / 140.0 + 1.7) * 0.6 + vn(xz / 55.0 + 5.1) * 0.4;

  // ---- meadow / pasture -------------------------------------------------------------------------------------
  float dry = smoothstep(0.45, 0.85, nBig * 0.6 + n23 * 0.4 + (n9 - 0.5) * 0.3);
  vec3 meadowC = mix(uMeadow, uMeadowDry, dry * 0.8);
  float lush = max(1.0 - smoothstep(2.0, 12.0, dd.a), (1.0 - smoothstep(1.0, 9.0, dd.g)) * 0.7);
  lush = max(lush, smoothstep(0.62, 0.9, 1.0 - nBig) * 0.5);
  meadowC = mix(meadowC, uMeadowLush, lush * 0.75);
  meadowC *= (0.94 + 0.12 * n9) * (0.96 + 0.08 * n1);
  float verge = (1.0 - smoothstep(0.3, 2.5 + 2.5 * n9, dd.r)) * (0.35 + 0.65 * smoothstep(0.3, 0.75, vn(xz / 3.1 + 9.0)));
  float dp = abs(vn(xz / 47.0 + 13.0) - 0.5) * 66.0;
  float desire = (1.0 - smoothstep(0.35, 0.8, dp)) * (1.0 - smoothstep(20.0, 45.0, dd.r)) * smoothstep(0.42, 0.5, vn(xz / 160.0 + 21.0));
  float wear = max(verge * 0.55, desire * (0.45 + 0.25 * n1));
  meadowC = mix(meadowC, mix(uWorn * (0.92 + 0.16 * n1), meadowC, 0.3), wear);

  // ---- lawn (scythed meadow-lawn) ------------------------------------------------------------------------------
  float ld = smoothstep(0.5, 0.85, n23 * 0.55 + nBig * 0.45);
  vec3 lawnC = mix(uLawn, uLawnDry, ld * 0.7) * (0.95 + 0.1 * vn(xz / 6.0)) * (0.97 + 0.06 * n1);
  lawnC = mix(lawnC, mix(uWorn, lawnC, 0.5), (1.0 - smoothstep(0.3, 1.6, dd.r)) * 0.35);
  // wave-10 review fix (04 / 16 / 33: one olive-yellow tone): the close-mown turf is a cooler, fresher green (rolled and
  // scythed every week or two, no seed heads, no sun-faded thatch) at the same value [N Sckell / Hirschfeld; I tint]
  float Lm = dot(lawnC, LUM);
  lawnC = lumTo(lawnC * vec3(0.92, 1.0, 1.1), Lm);
  // wave 10 (garden, audit #1): beyond the close-mown pleasure ground the meadow-lawn is an aftermath hay meadow
  // (grammar PLEASURE_GROUND; research/11 §3.1 "mown light-green / straw strips and taller seeding grass" [N]): parcels
  // mown on different days (≈ 34 × 24 m, warped, on the palace grid), each either standing seeding grass (buff and
  // reddish seed heads, darker tussocks), freshly scythed (pale stubble with straw windrows) or green regrowth; an
  // uncut 1 m margin between parcels [N mowing practice; I shares and tones]. Wave-10 review fix: the meadow is a warmer
  // tone about 6-9 % above the mown turf (it was up to 25 % and read parched olive-yellow), and the bake carries only the
  // mean of the 1.7 m swaths and windrows: from the air the parcels differ by state alone (the 3.4 m stripes read as
  // ride-on mower striping at 02 / 62); the terrain shader draws the swaths near the camera while they resolve
  if (w.r > 0.001) {
    float gm = lawnMeadowAt(texture2D(tMacro, (xz - uGroundOrigin) / uGroundSize).b, xz, vn(xz / 1.6 + 23.0), vn(xz / 7.0 + 5.0));
    if (gm > 0.001) {
      Swath S = aftermathSwath(xz, gU);
      float st = S.st;
      // only ≥ 4 m variation here: the bake's 1 m texels are magnified near the camera, where the terrain shader's
      // meadow grain, swaths and the seeding grass cards (grassBlades.ts) carry the fine structure
      float nS = vn(xz / 7.0 + 13.0);
      float Lh = Lm * 1.09;
      vec3 seeding = lumTo(mix(mix(uHayGreen, uMeadow, 0.4), uHayStraw, 0.08), Lh) * (0.93 + 0.12 * nS) * (0.95 + 0.08 * n9);
      seeding = mix(seeding, lumTo(mix(uHayGreen, uHayStraw, 0.4) * vec3(1.06, 0.95, 0.96), Lh * 1.03), 0.3 * smoothstep(0.5, 0.85, vn(xz / 11.0 + 4.0) * 0.6 + n23 * 0.4));
      vec3 ag;
      if (st < 0.45) ag = seeding;
      else if (st < 0.8) {
        vec3 cutG = lumTo(mix(mix(uLawn, uHayGreen, 0.5), uHayStraw, 0.22), Lm * 1.1);
        ag = mix(cutG, lumTo(uHayStraw, Lm * 1.2), 0.45 * ${WINDROW_MEAN.toFixed(2)}) * (0.97 + 0.06 * n9);
        ag = mix(seeding, ag, smoothstep(0.6, 1.6, S.edge));
      } else {
        ag = lumTo(mix(uHayGreen, uLawn, 0.6), Lm * 1.01) * (0.95 + 0.1 * vn(xz / 6.0 + 7.0));
      }
      lawnC = mix(lawnC, ag, gm);
    }
  }

  vec3 forestC = mix(vec3(0.10, 0.13, 0.07), vec3(0.17, 0.19, 0.10), n9 * 0.6 + n23 * 0.4);
  // water class: the ground under the water surfaces is hidden by them; where a graded natural shore (wave 9,
  // site/shore.ts) leaves a 2 m class cell above the waterline, it is damp, lush bank grass, not a dark teal patch
  vec3 waterC = uMeadowLush * 0.92 * (0.95 + 0.1 * n1);
  float sumL = w.r + w.b + w.a + cu.r + cu.g + cu.b + cu.a;
  float meadow = clamp(1.0 - sumL - w.g, 0.0, 1.0);
  float tot = sumL + meadow;
  if (tot < 1e-3) return vec4(meadowC, 0.0);
  vec3 col = lawnC * w.r + forestC * w.b + waterC * w.a + meadowC * meadow;

  // ---- hay meadows -------------------------------------------------------------------------------------------
  if (cu.r > 0.001) {
    // parcel frame: palace grid + 28 m (90 m) + 5 m (23 m) warp — mirrored by landcover.ts hayParcel (hay cocks)
    vec2 hq = vec2(dot(xz, gU), dot(xz, gV)) + 28.0 * vec2(vn(xz / 90.0), vn(xz / 90.0 + 9.2)) + 5.0 * vec2(vn(xz / 23.0 + 41.0), vn(xz / 23.0 + 47.0));
    vec2 S = vec2(95.0, 70.0);
    vec2 bid = floor(hq / S);
    vec2 f = hq - bid * S;
    float ph = hash12(bid + 5.3);
    float L = dot(uHayGreen, LUM);
    float edge = min(min(f.x, S.x - f.x), min(f.y, S.y - f.y)) + (vn(xz / 3.0) - 0.5) * 2.0;
    // standing grass: 2-6 m value breakup (tussocks, lodged and thinner patches; wave-3 review fix: the near slope at
    // 05 read as a mown golf lawn), seeding / flowering drifts (sorrel and grass heads reddish-buff, buttercup and
    // umbellifer specks) [N July hay meadow; I hues]
    // wave 9 (audit #1: the outer hay meadows read yellow at 17:30, pose 47): 12 % straw (was 20 %), fewer buttercup drifts
    vec3 standing = lumTo(mix(uHayGreen, uHayStraw, 0.12), L) * (0.94 + 0.1 * hash12(bid + 2.0)) * (0.91 + 0.16 * vn(xz / 5.0)) * (0.91 + 0.18 * n1);
    standing = mix(standing, lumTo(mix(uHayGreen, uHayStraw, 0.55) * vec3(1.1, 0.93, 0.97), L * 1.04), 0.6 * smoothstep(0.45, 0.85, n9 * 0.6 + n23 * 0.4));
    standing = mix(standing, lumTo(vec3(1.0, 0.92, 0.6), L * 1.14), 0.12 * smoothstep(0.6, 0.88, vn(xz / 3.3 + 61.0)));
    // darker, lusher tussocks and lodged patches (2-4 m)
    standing *= 1.0 - 0.1 * smoothstep(0.62, 0.85, vn(xz / 2.3 + 77.0));
    // parcels still being mown (hash < 0.6 of the cut ones): mown up to cutY along the short axis, mirrored by
    // landcover.ts hayParcel().cutTo (hay cocks only on the mown part)
    float cutY = ph < 0.5 || ph >= 0.78 ? 0.0 : ph < 0.6 ? S.y * (0.3 + 0.5 * hash12(bid + 21.7)) : S.y;
    vec3 hay;
    if (ph < 0.5) hay = standing;
    else if (ph < 0.78) {
      // freshly cut: pale stubble, windrows of drying hay along the parcel's long axis
      float sp = 4.0 + 2.0 * hash12(bid + 7.7);
      float wy = f.y + (vn(vec2(f.x / 9.0, bid.x * 3.1 + bid.y * 1.7)) - 0.5) * 1.0;
      float d = abs(fract(wy / sp) - 0.5) * sp;
      // wave-10 review fix (62: evenly spaced bands read as modern mower striping from the air): hand-raked windrows
      // are uneven: each row breaks up along its length (gaps, thinner stretches) and varies in width [N; I]
      float wRow = floor(wy / sp + 0.5);
      float wBreak = smoothstep(0.22, 0.55, vn(vec2(f.x / 6.0, wRow * 3.7 + bid.x * 1.3 + bid.y * 2.1)));
      float wr = (1.0 - smoothstep(0.25 + 0.2 * vn(xz / 9.0 + 3.0), 0.85, d)) * (0.55 + 0.45 * vn(xz / 4.0)) * (0.35 + 0.65 * wBreak);
      // wave 11 (KB-I84, audit #2: hay parcels read as one olive sheet from the air): paler stubble and rows
      // (was L · 1.04 / 1.12) so the mown parcels stand apart [research/11 §3.1 mown light strips; I values]
      vec3 stubble = lumTo(mix(uHayGreen, uHayStraw, 0.45), L * 1.09);
      vec3 rows = lumTo(uHayStraw, L * 1.18);
      vec3 cut = mix(stubble, rows, 0.75 * wr) * (0.97 + 0.06 * vn(xz / 5.0)) * (0.96 + 0.08 * n1);
      // uncut margin along the parcel edge, and the standing rest of a parcel still being mown (a ragged swath edge)
      float mown = smoothstep(1.4, 2.6, edge) * (1.0 - smoothstep(-0.4, 0.4, f.y - cutY + (vn(xz / 2.0) - 0.5) * 0.8));
      hay = mix(standing * 0.97, cut, mown);
    } else {
      // regrowth (aftermath): short fresh green, lighter and cooler than the seeding stands (wave 11, was straw 0.16)
      hay = lumTo(mix(mix(uHayGreen, uLawn, 0.35), uHayStraw, 0.06), L * 1.05) * (0.95 + 0.1 * vn(xz / 3.0));
    }
    // a soft seam between neighbouring parcels (different mowing dates) instead of a ruled line
    hay = mix(hay, standing, (1.0 - smoothstep(0.0, 1.2, edge)) * 0.5);
    col += hay * cu.r;
  }

  // ---- fields ------------------------------------------------------------------------------------------------
  if (cu.g > 0.001) {
    // block and strip frame: FIELD_GLSL (shared with the terrain shader's per-pixel balk lines; landcover.ts fieldStrip)
    FieldFrame F = fieldFrame(xz, gU, vec2(vn(xz / 160.0), vn(xz / 160.0 + 7.3)));
    vec2 p = F.p;
    vec2 B = FIELD_B;
    vec2 blk = F.blk;
    vec2 fb = F.fb;
    float across = F.across;
    float alongC = F.along;
    float sw = F.sw;
    float sid = F.sid;
    float hsd = fieldCrop(F);
    float hs2 = hash12(vec2(sid, blk.x * 17.0 + blk.y * 3.0 + 1.0));
    vec3 crop;
    float ripe = 0.0;
    float stub = 0.0;
    float clover = 0.0;
    float plough = 0.0;
    // wave 11 (KB-I84): the three-field rotation in July (FIELD_GLSL fieldCrop; landcover.ts FIELD_ROTATION) [N; I hues]
    if (hsd < 0.5) { crop = mix(uFieldGold, uFieldGold * vec3(0.93, 0.95, 1.05), hs2); ripe = 1.0; } // ripe rye, greyer to golder
    else if (hsd < 1.5) { crop = mix(uSpelt, uFieldGold, 0.25 * hs2); ripe = 1.0; } // ripe spelt: straw gold
    else if (hsd < 2.5) { crop = uStubble; stub = 1.0; } // reaped: stubble with sheaf stooks
    else if (hsd < 3.5) crop = mix(uOats, uFieldGreen, 0.3 * hs2); // oats, still blue-green
    else if (hsd < 4.5) crop = mix(uFieldGreen, uFieldGold, 0.3 + 0.3 * hs2); // barley, yellowing
    else if (hsd < 5.5) { crop = mix(uClover, uClover * vec3(1.05, 0.96, 1.0), hs2); clover = 1.0; } // clover in the fallow
    else if (hsd < 6.5) crop = mix(uFallow, uMeadowDry, 0.35 * hs2); // weedy, grazed fallow
    else { crop = mix(uPlough, uPlough * vec3(1.06, 1.04, 1.0), hs2); plough = 1.0; } // freshly ploughed fallow
    // wave-11 review fix: one crop per block, so neighbouring strips differ only in ripeness (a late-sown strip a little
    // greener, hs3) and value (fieldStripValue, ±6.5 %): a hard step between strips (wave-3 review fix), no category jump
    float hs3 = hash12(vec2(sid, blk.x * 5.0 + blk.y * 11.0 + 2.0));
    crop = mix(crop, uFieldGreen, (ripe > 0.5 || (hsd > 2.5 && hsd < 4.5) ? 0.1 : 0.0) * hs3);
    crop *= fieldStripValue(F);
    // lengthwise streaks of the plough lands (3-5 m) and broad patches [N]; wave-11 review fix: low-frequency patches
    // along each strip (thin and lush stretches, ±5 %, 30-60 m) and the ridged plough lands (3.2 m ridge-and-furrow
    // across the grain and the ploughed fallow, ±3 %) [N; I]
    float streak = vn(vec2(across / 3.7, alongC / 45.0) + blk * 13.0);
    vec3 cropC = crop * (0.95 + 0.07 * streak) * (0.96 + 0.08 * vn(xz / 13.0));
    cropC *= 0.95 + 0.1 * vn(vec2(alongC / 38.0, sid * 1.7) + blk * 5.0);
    cropC *= 1.0 + 0.03 * sin(across * 1.9635) * (1.0 - stub) * (1.0 - clover);
    // lodged and weedy patches in the ripe grain: darker, a little greener
    cropC = mix(cropC, cropC * vec3(0.86, 0.9, 0.84), ripe * smoothstep(0.7, 0.9, vn(xz / 7.0 + 3.0)) * 0.8);
    // clover: pink-red flower heads in drifts; the ploughed fallow: furrow ridges along the strip and clods [N; I]
    cropC = mix(cropC, cropC * vec3(1.12, 0.9, 0.95), clover * 0.45 * smoothstep(0.5, 0.85, vn(xz / 6.0 + 41.0)));
    cropC *= 1.0 + plough * (0.07 * (vn(vec2(across / 1.3, alongC / 60.0) + blk * 7.0) - 0.5) + 0.05 * (vn(xz / 3.0 + 17.0) - 0.5));
    // stooks (Garbenhocken) on most reaped strips, ~6 × 5 m apart [N hand harvest; I spacing]
    if (stub > 0.5 && hs2 < 0.8) {
      vec2 sc = vec2(across / 6.0, alongC / 5.0);
      vec2 cid = floor(sc);
      vec2 jit = vec2(hash12(cid + 1.3), hash12(cid + 2.9)) - 0.5;
      float dS = length((fract(sc) - 0.5 - jit * 0.4) * vec2(6.0, 5.0));
      cropC = mix(cropC, uFieldGold * 0.7, (1.0 - smoothstep(0.45, 0.85, dS)) * 0.85);
    }
    // the balks and furrows between strips are drawn per pixel by the terrain shader (≥ 1 px wide); the bake carries
    // them for the mip levels beyond the shader's line fade. Wave-11 review fix (no balks from the air): a 0.85 m grass
    // balk (Rain) at 60 %, a 0.45 m furrow at 25 %, so they fade out with the mips instead of vanishing at the line gate [N]
    float bd = min(F.fa, sw - F.fa);
    float hasBalk = fieldHasBalk(F);
    vec3 fieldC = mix(cropC, mix(cropC * 0.82, uBalk * (0.92 + 0.16 * n1), hasBalk), (1.0 - smoothstep(mix(0.2, 0.42, hasBalk), mix(0.45, 0.75, hasBalk), bd)) * mix(0.25, 0.6, hasBalk));
    // headland (Anwand) across the block edge, 4-6 m in all (the plough team turned there; ploughed last, so part
    // trodden soil, part grass), and a 3-6 m grass headland along the edge of the field land, so the strips no longer
    // stop on a ruled line against the meadow [N; I widths]
    float eb = min(min(fb.x, B.x - fb.x), min(fb.y, B.y - fb.y)) + (vn(xz / 4.0) - 0.5) * 1.5;
    float head = 1.0 - smoothstep(1.8, 2.6 + 0.8 * vn(xz / 21.0 + 4.4), eb);
    float marg = 1.0 - smoothstep(2.6, 4.4 + 1.6 * n9, dd.b);
    vec3 headC = mix(uBalk, mix(uFallow, uWorn, 0.5), 0.35 * smoothstep(0.35, 0.75, vn(xz / 6.0 + 27.0))) * (0.9 + 0.2 * n9);
    fieldC = mix(fieldC, headC, max(head, marg) * 0.9);
    // dusty field tracks with two ruts and a grass middle on ~45 % of the block edges (same edge keys as the hedges)
    float ex = p.x - floor(p.x / B.x + 0.5) * B.x;
    float ey = p.y - floor(p.y / B.y + 0.5) * B.y;
    vec2 kx = vec2(floor(p.x / B.x + 0.5) * 3.1, floor(p.y / B.y) + 0.5);
    vec2 ky = vec2(floor(p.x / B.x) + 0.5, floor(p.y / B.y + 0.5) * 3.1 + 100.0);
    float tx = step(hash12(kx + vec2(5.1, 8.7)), 0.45) * edgeTrack(ex, hash12(kx + 2.2) < 0.5 ? -1.0 : 1.0);
    float ty = step(hash12(ky + vec2(5.1, 8.7)), 0.45) * edgeTrack(ey, hash12(ky + 2.2) < 0.5 ? -1.0 : 1.0);
    float tr = max(tx, ty);
    if (tr > 0.001) {
      float dT = min(tx > 0.0 ? abs(abs(ex) - 3.0) : 9.0, ty > 0.0 ? abs(abs(ey) - 3.0) : 9.0);
      float rut = exp(-pow((dT - 0.74) / 0.22, 2.0));
      vec3 trackC = uTrack * (0.92 + 0.16 * n1) * (1.0 - 0.12 * rut);
      trackC = mix(trackC, uBalk, (1.0 - smoothstep(0.2, 0.45, dT)) * 0.6);
      fieldC = mix(fieldC, trackC, tr * 0.9);
    }
    col += fieldC * cu.g;
  }

  // ---- vineyard ----------------------------------------------------------------------------------------------
  if (cu.b > 0.001) {
    float q = dot(xz, uVineAcross);
    float along = dot(xz, vec2(-uVineAcross.y, uVineAcross.x));
    vec3 vc = vineAverage(uVine, uSoil) * (0.94 + 0.12 * vn(vec2(q / 3.0, along / 11.0)));
    // wave 8 (audit: the parcel read as a flat dark decal from the air): groups of 6-10 rows planted or hoed together
    // differ in vigour and in how much red-brown soil shows, so the cultivation reads as stripes along the contour at a
    // pitch the far views resolve (7-11 m) [N vineyards planted and worked in sections; I sizes]
    float gq = q / 1.1;
    float gw = 6.0 + 4.0 * hash12(vec2(floor(gq / 8.0), 3.7));
    float gid = floor(gq / gw);
    float gh = hash12(vec2(gid, 17.3));
    // KB-I73 (wave-8 review fix: the groups did not show from the air): freshly hoed groups show more red-brown soil
    // (45 % leaf), vigorous ones more leaf (68 %), the rest the plain average; the hue step (red-brown against green)
    // carries the stripes at the pixel scale of the aerial views [I shares]
    float hoed = 1.0 - smoothstep(0.3, 0.38, gh);
    float lushG = smoothstep(0.66, 0.74, gh);
    vc = mix(vc, mix(vineSoil(uSoil) * 0.897, vineLeaf(uVine) * 0.877, 0.45) * (0.97 + 0.06 * n9), 0.85 * hoed);
    vc = mix(vc, mix(vineSoil(uSoil) * 0.897, vineLeaf(uVine) * 0.877, 0.68) * (0.97 + 0.06 * n9), 0.85 * lushG);
    vc *= 0.95 + 0.1 * hash12(vec2(gid, 4.1));
    vc = mix(vc, vinePathCol(uSoil), vinePath(xz, uVineAcross));
    // grass headland along the staked-out edge
    vc = mix(vc, mix(uBalk, uWorn, 0.25) * (0.92 + 0.16 * n9), vineHead / max(cu.b, 1e-3));
    col += vc * cu.b;
  }

  // ---- kitchen gardens ---------------------------------------------------------------------------------------
  if (cu.a > 0.001) {
    vec2 p = vec2(dot(xz, gU), dot(xz, gV));
    vec2 qd = p / vec2(26.0, 20.0);
    vec2 qf = fract(qd) * vec2(26.0, 20.0);
    vec2 qid = floor(qd);
    float walk = step(qf.x, 1.6) + step(qf.y, 1.6);
    float bq = (qf.y - 1.6) / 1.9;
    float isBed = step(0.27, fract(bq));
    float hb = hash12(vec2(floor(bq), qid.x * 13.0 + qid.y * 5.0));
    // cabbages (grey-green), roots and beans (mid green), lettuce (fresh), leeks, a freshly dug bed [I hues]
    vec3 veg = hb < 0.2 ? vec3(0.14, 0.19, 0.12) : hb < 0.4 ? vec3(0.16, 0.25, 0.08) : hb < 0.6 ? vec3(0.12, 0.21, 0.07) : hb < 0.85 ? vec3(0.14, 0.2, 0.08) : mix(uGardenSoil, vec3(0.12, 0.2, 0.07), 0.4);
    veg *= 0.9 + 0.2 * vn(xz * 1.3);
    // beds of crops over dark soil (the 0.5 m bed paths barely show from above), walks of trodden earth
    vec3 kg = walk > 0.5 ? mix(uGardenSoil * 1.15, uWorn, 0.3) : mix(uGardenSoil * 1.1, veg, 0.55 + 0.35 * isBed);
    col += kg * cu.a;
  }
  // contact darkening (wave-3 review fix, KB-I45): grass overhang and ambient occlusion along hard edges (≤ 1.4 m,
  // walls, kerbs, terraces, paths) and a broader occlusion at building walls (nearness ≤ 3 cells) [I strengths]
  float nearB = texture2D(tMacro, (xz - uGroundOrigin) / uGroundSize).g;
  float contact = 0.1 * (1.0 - smoothstep(0.0, 1.4, dd.r)) + 0.12 * nearB * (1.0 - smoothstep(0.5, 5.0, dd.r));
  col *= 1.0 - contact * uShowClasses;
  // A: 0.5 per unit of cultivated land (hay, field, kitchen garden, the vineyard headland), 1.0 per unit of vine rows
  float a = (0.5 * (cu.r + cu.g + cu.a + vineHead) + (cu.b - vineHead)) / tot;
  return vec4(col / tot, a);
}

void main() {
  vec2 xz0 = uGroundOrigin + vUv * uGroundSize;
  vec4 acc = vec4(0.0);
  // 3 × 3 supersampling: patterns finer than a texel (beds, balks, ruts) average out instead of aliasing
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) acc += land(xz0 + vec2(float(i), float(j)) * uTexel / 3.0);
  acc /= 9.0;
  gl_FragColor = vec4(sqrt(max(acc.rgb, 0.0)), acc.a);
}
`;

/** One-off GPU bake of the land-cover albedo into a mipmapped render target (see the file comment). */
export class LandBake {
  readonly target: THREE.WebGLRenderTarget;
  readonly cell: number;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  bakes = 0;

  constructor(uniforms: LandBakeUniforms, renderer: THREE.WebGLRenderer, cell = 1) {
    const size = uniforms.uGroundSize.value;
    const g = bakeGrid(size.x, size.y, renderer.capabilities.maxTextureSize, cell);
    this.cell = g.cell;
    this.target = new THREE.WebGLRenderTarget(g.width, g.height, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      anisotropy: Math.min(4, renderer.capabilities.getMaxAnisotropy()),
      colorSpace: THREE.NoColorSpace,
    });
    this.target.texture.name = 'terrain/landcover-bake';
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...uniforms, uTexel: { value: new THREE.Vector2(size.x / g.width, size.y / g.height) } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.material.name = 'terrain/landcover-bake';
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Render the bake (call again after the class textures, the epoch or the grass mean change). */
  render(renderer: THREE.WebGLRenderer): void {
    const prev = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevNeeds = renderer.shadowMap.needsUpdate;
    renderer.autoClear = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.shadowMap.needsUpdate = prevNeeds; // the main view's shadow cache must not lose a pending redraw
    this.bakes++;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
