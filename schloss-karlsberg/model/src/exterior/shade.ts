/**
 * Baked per-vertex shading of the exterior (pure, no three.js; unit-tested in model/tests/shade.test.ts).
 *
 * KB-I20 baked ambient occlusion: the generator knows where geometry is concave (window reveals, cornice soffits, the
 * wall foot, under the cornice, dormer cheeks), so it writes an occlusion value per vertex instead of ray-casting.
 * The viewer multiplies indirect light by it (materials `baked()` variant); the explorer export bakes a share of it
 * into COLOR_0 (format unchanged). All values are render choices [I], not period norms.
 *
 * KB-I19 finish variation (research/09 §1.3.5-6, §2.4, §3.7, M3, M5): limewash colour by facade age (warm, older
 * 1778-82 work → cool, fresh 1785-88 work), ±3 % luminance per building, faint grime streaks under sills and the
 * cornice, per-block value and hue of exposed sandstone (red toward yellow-grey: recycled Jägersburg/Hohenburg
 * stone) on a 0.36 m course grid, and a slight per-building slate/tile jitter. Deterministic: mulberry32(hashString(id) ^ seed).
 */

import { hashString, mulberry32 } from '../layout/geom.ts';

/** Packed vertex shade: albedo multiplier rgb (linear) + ambient occlusion a. */
export type Shade = [number, number, number, number];

/**
 * Attribute encoding: Uint16 normalised; albedo multipliers up to SHADE_RGB_MAX (sandstone hue shifts need > 1 in
 * green and blue), AO in [0, 1].
 */
export const SHADE_RGB_MAX = 4;
export const SHADE_ATTRIBUTE = 'aShade';

/** Encode raw shades (4 floats per vertex) into `out` (Uint16, normalised). */
export function encodeShade(raw: ArrayLike<number>, out: Uint16Array | number[]): void {
  for (let i = 0; i < raw.length; i += 4) {
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(Math.min(1, Math.max(0, raw[i + k] / SHADE_RGB_MAX)) * 65535);
    out[i + 3] = Math.round(Math.min(1, Math.max(0, raw[i + 3])) * 65535);
  }
}

export function decodeShade(a: ArrayLike<number>, i: number, normalised = false): Shade {
  const k = normalised ? 1 : 1 / 65535;
  return [a[i] * k * SHADE_RGB_MAX, a[i + 1] * k * SHADE_RGB_MAX, a[i + 2] * k * SHADE_RGB_MAX, a[i + 3] * k];
}

/**
 * Static vertex colour from a material colour and a shade (explorer light layer, KB-I20): albedo multiplier times
 * AO, the AO applied at `aoStrength` (the explorer has no lighting of its own beyond a sun term, so baking the full AO
 * would double-darken the shadowed sides). Linear in, linear out.
 */
export const EXPLORER_AO_STRENGTH = 0.6;
export function shadeColour(c: readonly [number, number, number], s: Shade, aoStrength = EXPLORER_AO_STRENGTH): [number, number, number] {
  const ao = 1 + (s[3] - 1) * aoStrength;
  return [c[0] * s[0] * ao, c[1] * s[1] * ao, c[2] * s[2] * ao];
}

// ---------------------------------------------------------------------------------------------
// KB-I20 ambient occlusion values [I render]
// ---------------------------------------------------------------------------------------------

export const AO = {
  /** Faces looking down (soffits, undersides of sills, caps, cornices, portico ceilings). */
  soffit: 0.72,
  /** Window / door reveal: at the facade edge and at the frame (depth-linear in between). */
  reveal: { outer: 0.94, inner: 0.58, soffitInner: 0.5, sillInner: 0.72 },
  /** Deep passages (Durchfahrten): the reveal darkens over `depth` m and stays at `deep` beyond. */
  passage: { depth: 1.6, deep: 0.42 },
  /** Window joinery sitting in the reveal (frames, glazing bars, glass). */
  joinery: 0.78,
  glass: 0.85,
  /** Wall foot: at the court grade, and the height over which it fades out. */
  foot: { ao: 0.62, fade: 0.7 },
  /** Wall over the projecting plinth course. */
  plinthLedge: { ao: 0.88, fade: 0.35 },
  /** Wall below the main cornice: AO at the cornice foot and the fade distance down the wall. */
  underCornice: { ao: 0.7, fade: 0.9 },
  /** Dormer cheeks and front wall where they meet the roof. */
  dormerFoot: 0.66,
  dormerFade: 0.9,
  /** Inner corner of a stone step (riser foot and tread back edge), wave-9 review fix KB-I72. */
  stepCorner: 0.55,
} as const;

/** Per-segment AO of the main cornice profile (pairs = start/end of each profile segment, CORNICE_PROFILE order). */
export const CORNICE_AO: readonly [number, number][] = [
  [0.6, 0.66], // fascia underside at the wall
  [0.7, 0.66], // fascia face
  [0.62, 0.58], // bed mould
  [0.56, 0.52],
  [0.5, 0.5],
  [0.48, 0.45], // inner corner under the corona
  [0.45, 0.82], // corona soffit, open towards the drip edge
  [0.95, 1], // corona face
  [1, 1],
  [1, 1],
  [1, 1],
  [1, 1], // top (under the roof)
];

/** Wall zones (absolute heights) that shape the AO and grime of a wall band. */
export interface WallZones {
  /** Grade in front of the building (court level). */
  grade: number;
  plinthTop: number;
  /** Foot of the main cornice (eaves − cornice height). */
  corniceFoot: number;
}

/** Albedo grime (limewash dirt) directly under the cornice and how far it runs down [N research/09 §2.4; I size]. */
export const GRIME = { underCornice: 0.955, cornicFade: 1.4, underSill: 0.95, sillFade: 1.1 } as const;

/** AO of a wall (render band) vertex at height h. */
export function wallAO(h: number, z: WallZones): number {
  let ao = 1;
  const f = AO.plinthLedge;
  if (h < z.plinthTop + f.fade) ao = Math.min(ao, f.ao + ((1 - f.ao) * Math.max(0, h - z.plinthTop)) / f.fade);
  const c = AO.underCornice;
  if (h > z.corniceFoot - c.fade) ao = Math.min(ao, c.ao + ((1 - c.ao) * Math.max(0, z.corniceFoot - h)) / c.fade);
  return ao;
}

/** AO of a plinth (stone band) vertex at height h: dark at and below the grade, fading up. */
export function plinthAO(h: number, z: WallZones): number {
  const f = AO.foot;
  return Math.min(1, f.ao + ((1 - f.ao) * Math.max(0, h - z.grade)) / f.fade);
}

/**
 * Wave 10 (audit #3): albedo of the plinth stone near the grade - splash water and rising damp darken the lowest course
 * [N: splash zone of a stone plinth on a sanded court; I amount `albedo`, height `fade` m]. Baked into the vertex
 * shade, so the explorer light layer shows it too.
 */
export const PLINTH_DAMP = { albedo: 0.82, fade: 0.45 } as const;
export function plinthDamp(h: number, z: WallZones): number {
  const d = PLINTH_DAMP;
  return Math.min(1, d.albedo + ((1 - d.albedo) * Math.max(0, h - z.grade)) / d.fade);
}

/** Albedo grime multiplier of a wall vertex at height h (under the cornice). */
export function wallGrime(h: number, z: WallZones): number {
  const g = GRIME;
  if (h <= z.corniceFoot - g.cornicFade) return 1;
  return g.underCornice + ((1 - g.underCornice) * Math.max(0, z.corniceFoot - h)) / g.cornicFade;
}

/** Albedo grime under a sill: `below` m under the sill (0 at the sill). */
export function sillGrime(below: number): number {
  const g = GRIME;
  return below >= g.sillFade ? 1 : g.underSill + ((1 - g.underSill) * Math.max(0, below)) / g.sillFade;
}

/** Heights where a wall band must be split so vertex interpolation reproduces wallAO / wallGrime / plinthAO. */
export function wallBreaks(z: WallZones): number[] {
  return [z.grade, z.grade + AO.foot.fade, z.plinthTop + AO.plinthLedge.fade, z.corniceFoot - GRIME.cornicFade, z.corniceFoot - AO.underCornice.fade, z.corniceFoot];
}

/** Reveal AO at a depth fraction t (0 = facade edge, 1 = at the joinery) for the face kind. */
export function revealAO(t: number, face: 'jamb' | 'soffit' | 'sill'): number {
  const r = AO.reveal;
  const inner = face === 'soffit' ? r.soffitInner : face === 'sill' ? r.sillInner : r.inner;
  return r.outer + (inner - r.outer) * Math.min(1, Math.max(0, t));
}

/**
 * AO at the four corners of a reveal strip (p at d0, q at d0, q at d1, p at d1): the depth AO (`ao0` at d0, `ao1` at d1)
 * times the AO of the wall zone at the heights of p and q (`zp`, `zq`; plinthAO / wallAO), so a reveal is never lighter
 * than the wall it is cut into (wave-3 review fix) [I render].
 */
export function revealCornerAO(ao0: number, ao1: number, zp: number, zq: number): [number, number, number, number] {
  return [ao0 * zp, ao0 * zq, ao1 * zq, ao1 * zp];
}

/**
 * Albedo of stone reveals cut into the plinth band (cellar windows, passage feet) relative to the plinth face: weathered,
 * dirt-darkened sandstone [I]. Also stands in for the sub-texel self-shadow of a sunlit jamb that the shadow map cannot
 * resolve (wave-3 review: sunlit cellar-window jambs read as bright orange squares at pose 14) [I render].
 */
export const REVEAL_GRIME = { stone: 0.7 } as const;

/** Passage AO at depth d (m) into a Durchfahrt. */
export function passageAO(d: number): number {
  const p = AO.passage;
  return AO.reveal.outer + (p.deep - AO.reveal.outer) * Math.min(1, Math.max(0, d / p.depth));
}

// ---------------------------------------------------------------------------------------------
// KB-I19 finish variation
// ---------------------------------------------------------------------------------------------

/**
 * Limewash colours by facade age [research/09 §3.7: "#E9E7E0 (range #EDE6D8 warm, older → #E6E6E2 cool, newer)";
 * D-> Koblenz, LC, PV; per-age split I]. Work finished by 1780 is the warm end, from 1786 the cool end.
 */
export const LIMEWASH = { warm: '#EDE6D8', cool: '#E6E6E2', warmUntil: 1780, coolFrom: 1786, lumJitter: 0.03 } as const;

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbHex(c: [number, number, number]): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * Limewash colour of a court building finished in `year` (undefined: the base colour unchanged). The base catalogue
 * colour is moved toward the warm / cool end in sRGB by the age; the result is quantised to whole years so only a
 * handful of materials exist.
 */
export function limewashColour(base: string, year: number | undefined): string {
  if (year === undefined) return base.toUpperCase();
  const t = Math.min(1, Math.max(0, (year - LIMEWASH.warmUntil) / (LIMEWASH.coolFrom - LIMEWASH.warmUntil)));
  const w = hexRgb(LIMEWASH.warm);
  const c = hexRgb(LIMEWASH.cool);
  const target: [number, number, number] = [w[0] + (c[0] - w[0]) * t, w[1] + (c[1] - w[1]) * t, w[2] + (c[2] - w[2]) * t];
  const b = hexRgb(base);
  // the catalogue base stays the anchor: 70 % of the way to the age colour keeps the court white-grey, not cream
  return rgbHex([b[0] + (target[0] - b[0]) * 0.7, b[1] + (target[1] - b[1]) * 0.7, b[2] + (target[2] - b[2]) * 0.7]);
}

/** Per-building luminance multiplier of the limewash (±3 %, research/09 M3 "luminance ±3 %") [N uneven finish; I]. */
export function buildingLum(id: string, seed: number): number {
  const r = mulberry32(hashString(`${id}|limewash`) ^ seed)();
  return 1 + (r * 2 - 1) * LIMEWASH.lumJitter;
}

/** Per-building jitter of the roof cover: slate ±4 % luminance, slight blue/grey shift; tile ±6 % [I; research/09 §3.7]. */
export function roofTint(id: string, cover: string, seed: number): [number, number, number] {
  const rnd = mulberry32(hashString(`${id}|roof`) ^ seed);
  const l = cover === 'tile' ? 1 + (rnd() * 2 - 1) * 0.06 : 1 + (rnd() * 2 - 1) * 0.04;
  const h = (rnd() * 2 - 1) * 0.025; // + bluer, − greyer/warmer
  return [l * (1 - h), l, l * (1 + h)];
}

/**
 * Exposed sandstone hues (research/09 §2.2, §3.7, M5): local red Buntsandstein, the Homburg stone runs "yellow, red and
 * yellow-red" [D 09 §2.2], with recycled Jägersburg/Hohenburg blocks [D reuse]. Every block varies a little instead of
 * a few outliers (wave-3 review: 25 % strongly shifted blocks read as patch repairs, and the grey-white blend turned the
 * red purplish): value ±5 % and a hue step from the base red toward yellow-grey of at most `blend` (skewed, most
 * blocks stay near red). Grey-white is left out (it desaturates the red into mauve). Amplitudes are [I].
 */
export const STONE_HUES = {
  red: '#A65E4A',
  yellowGrey: '#C8B38C',
  /** max share of the yellow-grey hue a block can take; the share is blend · r^2 (mean blend / 3) */
  blend: 0.12,
  lumJitter: 0.03,
} as const;

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Linear RGB (0…1) of an sRGB hex colour `#RRGGBB`. */
export function hexLinear(hex: string): [number, number, number] {
  return hexRgb(hex).map(srgbToLinear) as [number, number, number];
}

/** Rec. 709 luminance of a linear RGB triple. */
export const linearLuma = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Albedo multiplier (linear rgb) that turns the base stone colour `base` into this block's hue. `r1`, `r2` are two
 * uniform random numbers of the block (r1: hue step toward yellow-grey, r2: value).
 */
export function stoneBlockTint(base: string, r1: number, r2: number): [number, number, number] {
  const b = hexLinear(base);
  const t = hexLinear(STONE_HUES.yellowGrey);
  const k = STONE_HUES.blend * r1 * r1;
  const lum = 1 + (r2 * 2 - 1) * STONE_HUES.lumJitter;
  // keep the block's luminance at `lum` × base: only the hue moves toward yellow-grey, not the brightness
  const mixed = [0, 1, 2].map((i) => b[i] + (t[i] - b[i]) * k);
  const norm = linearLuma(b) / Math.max(1e-4, linearLuma(mixed));
  return [0, 1, 2].map((i) => ((mixed[i] * norm) / Math.max(1e-4, b[i])) * lum) as [number, number, number];
}

/**
 * Joints of the CC0 `sandstone_blocks_08` ashlar texture (viewer/textures.json `sandstone_ashlar`): u positions
 * (fraction of the tile) of the vertical joints per course, counted from the bottom of the tile (v = 0). Read off the
 * image (local-contrast scan + eye) so colour blocks follow the drawn ones. The image has 5 courses; the material
 * library maps it to `tile` × `tileV` metres (TEXTURE_SIZE in materials/index.ts), so courses are 0.36 m high
 * (≈ 0.30–0.40 m dressed courses, research/09 §2.2 [N]) and blocks 0.3–1.1 m long, mostly 0.7–0.9 m (wave-3
 * review: the 3 × 3 m mapping gave 0.6 m courses).
 */
export const ASHLAR = {
  tile: 3.0,
  tileV: 1.8,
  course: 0.36,
  joints: [
    [0.29, 0.59],
    [0.11, 0.35, 0.46, 0.72],
    [0.17, 0.27, 0.57, 0.87],
    [0.04, 0.34, 0.63],
    [0.19, 0.49, 0.78],
  ] as readonly (readonly number[])[],
} as const;

/** One stone block of an ashlar band: [u0, u1] × [h0, h1] in texture metres, with a stable block key. */
export interface AshlarBlock {
  u0: number;
  u1: number;
  h0: number;
  h1: number;
  key: string;
}

/**
 * Split the rectangle [u0, u1] × [h0, h1] (u = texture u in metres, h = world height = texture v in metres) into the
 * ashlar texture's blocks. Keys are global (tile index, course index, joint index), so neighbouring pieces of the same
 * block get the same hue.
 */
export function ashlarBlocks(u0: number, u1: number, h0: number, h1: number): AshlarBlock[] {
  const { tile, course, joints } = ASHLAR;
  const out: AshlarBlock[] = [];
  const lo = Math.min(u0, u1);
  const hi = Math.max(u0, u1);
  for (let c = Math.floor(h0 / course); c * course < h1 - 1e-6; c++) {
    const ch0 = Math.max(h0, c * course);
    const ch1 = Math.min(h1, (c + 1) * course);
    if (ch1 - ch0 < 1e-4) continue;
    const row = joints[((c % joints.length) + joints.length) % joints.length];
    // joint positions (metres) across the span, then blocks between them
    const cuts: { u: number; key: string }[] = [];
    for (let t = Math.floor(lo / tile) - 1; t * tile <= hi + tile; t++) {
      for (let j = 0; j < row.length; j++) cuts.push({ u: (t + row[j]) * tile, key: `${t}:${j}` });
    }
    cuts.sort((a, b) => a.u - b.u);
    let start = lo;
    let key = cuts.filter((x) => x.u <= lo).pop()?.key ?? 'L';
    for (const x of cuts) {
      if (x.u <= lo + 1e-6) continue;
      if (x.u >= hi - 1e-6) break;
      out.push({ u0: start, u1: x.u, h0: ch0, h1: ch1, key: `${c}|${key}` });
      start = x.u;
      key = x.key;
    }
    out.push({ u0: start, u1: hi, h0: ch0, h1: ch1, key: `${c}|${key}` });
  }
  return out;
}

/**
 * Wave 10 (audit #3): mixed dressed sandstone per block, drawn in the viewer's stone shader (materials/index.ts
 * `ashlarPatch`) on the ashlar texture's own block grid, so it shows at every LOD and on every red Buntsandstein surface
 * (plinths, the Orangerie's high basement, terrace walls) [research/09 §1 item 5 "do not use one uniform red", §3.7 and
 * M5: red `#A65E4A`, yellow-grey `#C8B38C`, grey-white `#CFC8BA`; D local stone, D reuse of Jägersburg / Hohenburg
 * stone; I mix]. Unlike the wave-3 blend (grey-white mixed INTO red turned mauve), a block takes one stone's hue whole:
 * `shares` of red (itself stepped up to `redToYellow` toward yellow-grey: the Homburg stone runs "yellow, red and
 * yellow-red", 09 §2.2 [D]), yellow-grey and grey-white. A pale block moves `mix` of the way from the red to its
 * stone in linear colour (whole hues at the red's value read olive and khaki in shade: wave-10 first cut), and its
 * luminance `lumKeep` of the way from the red's toward its own, so the plinth reads as one warm mixed stone, not as
 * camouflage or patch repairs (wave-3 review). `joint` is the recessed joint (half width m, albedo) and `value` the
 * per-block value jitter. Shares and amplitudes [I].
 */
export const STONE_MIX = {
  /** catalogue colours drawn as mixed dressed stone (the documented plinth red, D KB-B02; the retaining-wall stone) */
  colours: ['#A65E4A', '#A0604E'] as readonly string[],
  shares: { red: 0.45, yellowGrey: 0.35, greyWhite: 0.2 },
  redToYellow: 0.3,
  /** wave-10 review: the red blocks lose this share of their saturation (toward red-brown, not orange-red) */
  redDesat: 0.15,
  mix: { yellowGrey: 0.45, greyWhite: 0.4 },
  /**
   * wave-10 review: pale blocks keep nearly the red's value (≤ ≈ 6 % brighter), so adjacent blocks differ in hue, not
   * as a checkerboard of light and dark (beds of one quarry differ subtly [N])
   */
  lumKeep: { yellowGrey: 0.05, greyWhite: 0.06 },
  value: 0.02,
  /** share of the ashlar photo's luminance variation kept on mixed stone (lumaPatch contrast) */
  textureContrast: 0.45,
  /**
   * recessed joint: half width m (a 1.6 cm joint) and albedo; `arris` the lit top edge of the block below a bed joint
   * (width m, albedo gain). Both fade to their mean once the joint is narrower than a pixel.
   */
  joint: { halfWidth: 0.008, albedo: 0.42, arris: { width: 0.012, gain: 1.18 } },
  greyWhite: '#CFC8BA',
} as const;

/**
 * Wave-10 review (TF-08 at pose 49): retaining walls (terraces, scarps, drive walls; site/features.ts) are laid in the
 * same mixed stone with larger courses, ≈ 0.5 m instead of the plinth's 0.36 m [N larger courses in retaining walls;
 * I size], and carry a projecting grey-white sandstone coping with a drip [N research/02 terraces; I sizes]. `colour`
 * is the material key of their stone (the plinth red weathered a little browner [I]).
 */
export const RETAINING_ASHLAR = {
  colour: '#A0604E',
  courseScale: 1.4,
  coping: { height: 0.3, overhang: 0.07, bed: 0.06, colour: '#CEC6B6' },
} as const;

/**
 * Albedo multipliers (linear) that turn the base stone `base` into a whole yellow-grey and a whole grey-white block at
 * the STONE_MIX luminance (shader uniforms of `ashlarPatch`).
 */
export function stoneMixTints(base: string): { yellowGrey: [number, number, number]; greyWhite: [number, number, number] } {
  const b = hexLinear(base);
  const yb = linearLuma(b);
  const one = (hex: string, mix: number, keep: number): [number, number, number] => {
    const t = hexLinear(hex).map((v, i) => b[i] + (v - b[i]) * mix);
    const yt = linearLuma(t);
    const s = (yb + (yt - yb) * keep) / Math.max(1e-4, yt);
    return [0, 1, 2].map((i) => (t[i] * s) / Math.max(1e-4, b[i])) as [number, number, number];
  };
  const M = STONE_MIX;
  return { yellowGrey: one(STONE_HUES.yellowGrey, M.mix.yellowGrey, M.lumKeep.yellowGrey), greyWhite: one(M.greyWhite, M.mix.greyWhite, M.lumKeep.greyWhite) };
}

/** Hue multiplier of an ashlar block of one building (deterministic per building and block key). */
export function blockTint(buildingId: string, key: string, base: string, seed: number): [number, number, number] {
  const r = mulberry32(hashString(`${buildingId}|${key}`) ^ seed);
  return stoneBlockTint(base, r(), r());
}
