/**
 * Calibrated light budget (backlog KB-I06, visual-audit §5.2): pure functions, no three.js, no DOM.
 *
 * Model: every light is first computed in physical units (lux for illuminance, cd/m² = "nits" for radiance), then
 * multiplied by a *pre-exposure* factor derived from an EV curve over the sun's elevation, so the numbers the GPU sees
 * stay in a display-friendly range (≈ 0…10) at noon and at night alike. `renderer.toneMappingExposure` only carries
 * the eye adaptation on top (inside ↔ outside, eased).
 *
 * Evidence: all curves are approximations, tag [I], anchored on
 * - direct sunlight 32–100 klx, daylight without direct sun 10–25 klx, sunrise/sunset ≈ 400 lx, dark limit of civil
 *   twilight ≈ 3.4 lx, full moon 0.05–0.3 lx, moonless clear night ≈ 0.002 lx (https://en.wikipedia.org/wiki/Lux);
 * - twilight bands −6° / −12° / −18° (https://en.wikipedia.org/wiki/Twilight);
 * - EV100 targets ≈ 15 high sun, ≈ 12 golden hour (https://en.wikipedia.org/wiki/Exposure_value, visual-audit §5.2);
 * - relative air mass after Kasten & Young, Applied Optics 28(22), 1989;
 * - blackbody colour after Tanner Helland's fit (https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html).
 */

import { clamp, smoothstep } from '@model/layout/geom.ts';

export type RGB = [number, number, number];

const DEG = Math.PI / 180;

/** Piecewise-linear interpolation over a table sorted by x (clamped at both ends). */
export function interp(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

/** Log-linear interpolation (for illuminances spanning many decades). */
function interpLog(table: readonly (readonly [number, number])[], x: number): number {
  return Math.exp(interp(table.map(([a, b]) => [a, Math.log(b)] as const), x));
}

/** Relative optical air mass (Kasten & Young 1989), elevation in degrees (clamped at −0.5°). */
export function airmass(elDeg: number): number {
  const e = Math.max(elDeg, -0.5);
  return 1 / (Math.sin(e * DEG) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
}

/**
 * Direct sun illuminance on a surface facing the sun (lux), clear July sky [I]:
 * 128 klx outside the atmosphere × exp(−0.21 · air mass), faded out while the disc sets (geometric −1.1°…−0.3°).
 * ≈ 96 klx at 56°, 69 klx at 22°, 26 klx at 8°. Wave-2 review fix: extinction 0.21 → 0.23 per air mass, a hazy July
 * day consistent with the sky's turbidity 4 (a clear, dry atmosphere is ≈ 0.2; summer haze more) [I].
 */
export const SUN_EXTINCTION = 0.23;
export function sunIlluminance(elDeg: number): number {
  return 128000 * Math.exp(-SUN_EXTINCTION * airmass(elDeg)) * smoothstep(-1.1, -0.3, elDeg);
}

/**
 * Diffuse sky illuminance on a horizontal plane (lux) [I]. Day values chosen so the sun:sky ratio is ≈ 5 at high sun
 * (visual-audit §5.2: 3:1–8:1) and falls toward low sun; twilight values follow the Wikipedia anchors; the night floor
 * (0.03 lx) stands in for moon and airglow (the moon phase of 15 Jul 1789 is not modelled, U). Wave-2 review: 22° raised
 * 16 → 17.5 klx (hazy July afternoon skies give 15–20 klx diffuse at that height [I]) to soften the hero-hour shade.
 * Wave-2 review fix (grey-card 15 at 17:30, 29 at 19:00): 5° 5.3, 10° 10.5, 22° 19.5, 40° 20.5 klx, the upper end of the
 * 10–25 klx "daylight without direct sun" anchor for a hazy (turbidity 4) July sky [I].
 */
const SKY_LUX: readonly (readonly [number, number])[] = [
  [-18, 0.03],
  [-12, 0.06],
  [-9, 0.5],
  [-6, 3.4],
  [-4, 30],
  [-2, 150],
  [0, 450],
  [2, 1900],
  [5, 5300],
  [10, 10500],
  [22, 19500],
  [40, 20500],
  [60, 21000],
  [90, 22000],
];
export function skyIlluminance(elDeg: number): number {
  return interpLog(SKY_LUX, elDeg);
}

/** Night floor of the sky illuminance (lux), so the scene never goes black [I]. */
export const NIGHT_FLOOR_LUX = 0.03;

/**
 * Wave-10 review fix (pose 60: the lower 45 % of a moonless night frame was a black void): extra diffuse sky light on
 * the land (terrain, lawn, vegetation; through their SH probe, not the buildings or the sky) at full night, as a
 * multiple of the sky's own, and its cool tint (luminance 1). It stands for airglow and starlight (≈ 0.001 lx on a real
 * moonless night) seen by the dark-adapted eye, which adapts locally to the dim ground under a much brighter twilight
 * sky, so lawn, paths and the lie of the land separate faintly [I, art direction; same never-black spirit as
 * NIGHT_FLOOR_LUX]. `env`: the same lift, smaller, on the buildings' sky light (scene.environmentIntensity), so a
 * limewashed façade stays lighter than the lawn in front of it.
 */
export const NIGHT_GROUND_FILL = { gain: 0.9, tint: [0.84, 1.0, 1.3] as RGB, env: 0.6 };

/** Per-channel multiplier of the land's SH sky light at night strength `night` (0 by day … 1 at night). */
export function nightGroundFill(night: number): RGB {
  const n = clamp(night, 0, 1);
  const t = NIGHT_GROUND_FILL.tint;
  const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  return [0, 1, 2].map((i) => 1 + NIGHT_GROUND_FILL.gain * n * (t[i] / l)) as RGB;
}

/** Global horizontal illuminance (sun + sky), lux. */
export function globalIlluminance(elDeg: number): number {
  return sunIlluminance(elDeg) * Math.max(0, Math.sin(elDeg * DEG)) + skyIlluminance(elDeg);
}

/** Sun (normal) : sky (horizontal) illuminance ratio. */
export function sunSkyRatio(elDeg: number): number {
  return sunIlluminance(elDeg) / skyIlluminance(elDeg);
}

/**
 * Correlated colour temperature of the direct sun (K) over elevation [I]: ≈ 5600 K at 10:30 in July (56°), ≈ 4100 K
 * at the 17:30 / 07:00 hero hours (22–25°), 3900 K at 10°, 2500 K at 0°. Wave-1 review: at 5000 K for 20° the hero
 * hours read as neutral as noon. Wave-2 review (poses 14, 15 still read as midday at 4500–4750 K): the mid band now
 * sits at the warm end of the 4000–4800 K usually quoted for the sun at 20–25° (direct-beam reddening by the air
 * mass, Kasten & Young above; summer haze, turbidity 4, reddens further), so the white render reads cream, not white,
 * while #ECE8DF in shade and the slate stay recognisable. KB-I74 (wave-8 review: the 19:12 'golden hour', sun ≈ 6°,
 * still read neutral): 3100 K at 5°, 3300 K at 8°, 3500 K at 10°, 3800 K at 14°; the reddened low sun of a hazy
 * evening is quoted at ≈ 3000–3500 K for 5–10° (https://en.wikipedia.org/wiki/Color_temperature: "sunrise/sunset"
 * 2500–3500 K) [I]. 20° and above are unchanged (poses 14, 15).
 */
const SUN_K: readonly (readonly [number, number])[] = [
  [0, 2500],
  [2, 2800],
  [5, 3100],
  [8, 3300],
  [10, 3500],
  [14, 3800],
  [20, 4000],
  [25, 4200],
  [32, 4650],
  [40, 5200],
  [60, 5700],
  [90, 5900],
];
export function sunKelvin(elDeg: number): number {
  return interp(SUN_K, elDeg);
}

/** sRGB (0…1) of a blackbody at T kelvin, Tanner Helland's fit (1000–40000 K). */
export function kelvinToSrgb(kelvin: number): RGB {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
export function luminance(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** Scale a linear colour to luminance 1 (black stays black). */
export function normalise(c: RGB): RGB {
  const l = luminance(c);
  return l > 0 ? [c[0] / l, c[1] / l, c[2] / l] : [0, 0, 0];
}

/** Linear-RGB colour of a blackbody at T kelvin with luminance 1. */
export function kelvinLinear(kelvin: number): RGB {
  const s = kelvinToSrgb(kelvin);
  return normalise([srgbToLinear(s[0]), srgbToLinear(s[1]), srgbToLinear(s[2])]);
}

/** Linear-RGB sun colour with luminance 1. */
export function sunColour(elDeg: number): RGB {
  return kelvinLinear(sunKelvin(elDeg));
}

/** Luminance-preserving saturation: 0 = grey of the same luminance, 1 = unchanged. */
export function saturate(c: RGB, s: number): RGB {
  const l = luminance(c);
  return [l + (c[0] - l) * s, l + (c[1] - l) * s, l + (c[2] - l) * s];
}

/**
 * Saturation of the sky radiance used as diffuse image-based light (KB-I06 fix, wave-1 review) [I]. The three.js
 * Preetham sky (turbidity 3–4) gives a horizontal sky irradiance with blue:red ≈ 6:1 in linear sRGB, a CCT far above
 * 25 000 K; clear-sky diffuse light is usually quoted at about 10 000–20 000 K
 * (https://en.wikipedia.org/wiki/Color_temperature#Categorizing_different_lighting). At 0.4 the irradiance lands at
 * blue:red ≈ 2 (≈ 12 000 K): shade stays cool, but walls, shutters and lawns no longer turn navy and teal.
 */
export const ENV_SKY_SAT = 0.4;
/**
 * Elevation-dependent version [I]: 0.4 at high sun; at the golden hour the analytic sky is already much less blue
 * (blue:red ≈ 2.3 at 8°), and the shade has to read cool against the warm sun (wave-1 review, pose 09), so less is
 * taken out; in twilight the sky is the only light and the blue hour stays blue (0.9): with less, the sand court
 * read olive at dusk, because Neutral's toe pulls the shared grey out of dark colours.
 */
export function envSkySat(elDeg: number): number {
  return interp(
    [
      [-6, 0.9],
      [-1, 0.85],
      [3, 0.75],
      [8, 0.7],
      [30, 0.4],
    ],
    elDeg,
  );
}

/**
 * Isotropic share of the sky radiance used as image-based light, over sun elevation [I, wave-2 review fix]. The
 * three.js Preetham sky is a single-scattering model with a strong Mie forward lobe (g = 0.8): at 22° it puts
 * ≈ 48 klx of sky light on a card facing the sun but only ≈ 3.9 klx on a vertical card facing away (measured on the
 * CPU port, `preetham.ts`), a 12:1 sky anisotropy; the grey-card sun:shade ratio was 15 at 17:30 and 29 at 19:00.
 * Real hazy summer skies are much flatter, because multiple scattering spreads the aureole (Perez et al., "All-weather
 * model for sky luminance distribution", Solar Energy 50(3), 1993: clear-sky gradation and circumsolar terms are far
 * below single-scattering values at turbidity ≥ 4). The env radiance is therefore blended toward its hemispherical
 * mean by this share before normalising to `skyIlluminance`: total sky light unchanged, the shaded side gets more.
 * The visible sky keeps its shape (0 there). None in twilight, where the bright band toward the set sun is the look;
 * less at the golden hour (≤ 8°), where raking light on the terrain relief is the point of the hour (pose 08).
 */
export function envSkyIso(elDeg: number): number {
  return interp(
    [
      [-4, 0],
      [0, 0.4],
      [5, 0.6],
      [12, 0.8],
      [30, 0.8],
      [50, 0.35],
    ],
    elDeg,
  );
}

/** CIE xy chromaticity of the CIE daylight locus at T kelvin (4000–25 000 K; CIE 15:2004, §3.1). */
export function daylightXy(kelvin: number): [number, number] {
  const t = clamp(kelvin, 4000, 25000);
  const x =
    t <= 7000
      ? -4.607e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
      : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.23704;
  return [x, -3 * x * x + 2.87 * x - 0.275];
}

/** Linear sRGB (luminance 1) of a CIE xy chromaticity (D65 white, IEC 61966-2-1 matrix). */
export function xyToLinear(x: number, y: number): RGB {
  const X = x / y;
  const Z = (1 - x - y) / y;
  return [3.2406 * X - 1.5372 - 0.4986 * Z, -0.9689 * X + 1.8758 + 0.0415 * Z, 0.0557 * X - 0.204 + 1.057 * Z];
}

/**
 * Colour temperature of the diffuse sky light (horizontal irradiance) over sun elevation [I]: clear-sky skylight is
 * usually quoted at 10 000–20 000 K (https://en.wikipedia.org/wiki/Color_temperature#Categorizing_different_lighting);
 * bluer at low sun, when the shade sees only the anti-solar sky against the warm sun. KB-I74: 18 000 K at 4° and
 * 16 500 K at 8° (the deep zenith and earth-shadow blue that lights the shade at a low sun; was 15 000 K), so the
 * golden-hour shade reads cool next to the warm key [I]; 12° and above unchanged.
 */
const SKY_K: readonly (readonly [number, number])[] = [
  [4, 18000],
  [8, 16500],
  [12, 14000],
  [25, 13000],
  [50, 12000],
];
export function skyKelvin(elDeg: number): number {
  return interp(SKY_K, elDeg);
}

/**
 * Green trim of the skylight colour (multiplier on G before renormalising) [I, art direction, wave-2 review]. RGB
 * rendering multiplies two smooth spectra at three primaries; for a warm broadband albedo (sand #C9B48E, oak) under
 * blue skylight this overstates green, and shaded sand read olive / teal (poses 09, 14). A small trim below the
 * daylight locus lets the shade read lavender-grey, as warm surfaces in blue shade do in photographs.
 */
export const SKY_GREEN_TRIM = 0.97;
/**
 * Elevation-dependent green trim (KB-I74, wave-8 review: at 19:12 the shaded court sand read grey-green, "wet
 * concrete", where the golden hour wants a cool lilac-grey shade next to the warm sun) [I, art direction]: SKY_GREEN_TRIM
 * from 22° up (poses 14, 15 and the day unchanged), 0.88 at 4° and below. Twilight is not affected (skylightWeight).
 */
export function skyGreenTrim(elDeg: number): number {
  return interp(
    [
      [4, 0.88],
      [12, 0.9],
      [22, SKY_GREEN_TRIM],
    ],
    elDeg,
  );
}

/** Linear-RGB colour (luminance 1) of the diffuse sky light: CIE daylight at `skyKelvin(el)`, green trimmed. */
export function skylightColour(elDeg: number): RGB {
  const [x, y] = daylightXy(skyKelvin(elDeg));
  const c = xyToLinear(x, y);
  return normalise([c[0], c[1] * skyGreenTrim(elDeg), c[2]]);
}

/**
 * Share of the sky light used as image-based fill (env + SH) at low sun, in both looks (KB-I74) [I]. SKY_LUX was raised
 * in wave 2 to lift the hero-hour shade (22°); at 4–10° it leaves the horizontal ground lit ≈ 3–7 : 1 by the blue sky
 * against the grazing sun, so the sunlit court read as grey as its shade (pose 09). A clear, hazy sky gives ≈ 3–7 klx
 * diffuse horizontal at 5–10° sun (clear-sky diffuse ≈ 30–60 W/m² × ≈ 120 lm/W; Perez et al., Solar Energy 44(5),
 * 1990, luminous efficacy) against SKY_LUX 5.3–10.5 klx: 0.72 there (KEY_STOPS opens the golden hour by 0.12 EV to keep the sunlit
 * ground light), 1 from 20° up (14, 15 and the day unchanged) and
 * in twilight (−1° and below), where the sky is the only light. Kino keeps its own, deeper fill (kinoLowSun.fill) where
 * that is lower. The exposure meter and the white balance keep the full sky (the eye adapts to the sky it sees).
 */
export function lowSunSkyFill(elDeg: number): number {
  return interp(
    [
      [-1, 1],
      [2, 0.84],
      [4, 0.72],
      [10, 0.72],
      [16, 0.88],
      [20, 1],
    ],
    elDeg,
  );
}

/**
 * Warm haze toward the low sun (KB-I74) [I]: the share by which the sun-side horizon haze is moved toward the sun's own
 * colour (forward Mie scattering of the reddened beam; look-and-period §7.2 "warm haze toward the sun, cool layered
 * hills away from it"). The anti-solar side keeps the cool earth-shadow blue (atmosphere.ts). 0.4 from 1° to 10°,
 * gone by 20° and below −2°.
 */
export const LOW_SUN_HAZE_WARM = 0.4;
export function lowSunHazeWarm(elDeg: number): number {
  return LOW_SUN_HAZE_WARM * smoothstep(-2, 1, elDeg) * (1 - smoothstep(10, 20, elDeg));
}

/**
 * Softness of the Preetham horizon (wave-8 review, night aerial 52): three's Sky.js clamps the view direction at the
 * horizon (`acos( max( 0.0, direction.y ) )`). With the sun below the horizon the sky keeps its sunset shape, whose
 * optical-depth term darkens the last ≈ 1° above the horizon steeply, and below it the sky is flat: from the air that
 * kink read as a hard horizontal seam ≈ 12 % below the top of the frame. The shader uses the smooth maximum
 * min(1, ½ (y + √(y² + k²))) with this k instead (k = 0 is the old clamp, so every day frame is unchanged): 0 with the sun up,
 * `HORIZON_SOFT` (≈ 3.4°) from −4° down [I].
 */
export const HORIZON_SOFT = 0.06;
export function horizonSoftness(elDeg: number): number {
  return HORIZON_SOFT * (1 - smoothstep(-4, 0, elDeg));
}

/** Smooth maximum of y and 0 used by the sky shader (pure twin for the tests). */
export function softHorizonY(y: number, k: number): number {
  return Math.min(1, 0.5 * (y + Math.sqrt(y * y + k * k)));
}

/**
 * Weight of the skylight colour correction over elevation: the env sky's mean colour is moved onto
 * `skylightColour` by day; in twilight the Preetham sky × `skyTint` carries the blue hour unchanged (pose 10).
 */
export function skylightWeight(elDeg: number): number {
  return smoothstep(-3, 3, elDeg);
}

/**
 * Saturation of the *visible* sky toward the horizon (multiplier at elevation 0°, ramps to 1 by ≈ 35°) [I]: the
 * analytic sky keeps a mid blue down to the horizon, a real July sky whitens there with haze (wave-1 review: 10°
 * should read ≥ #8AB4DA at pose 03).
 */
export const HORIZON_SAT = 0.35;
/** Overall saturation of the visible sky at high sun [I]: the analytic zenith blue is a touch too pure for a July haze. */
export const VIEW_SKY_SAT = 0.85;
/**
 * Saturation of the visible sky over sun elevation [I, wave-2 review]: at 15–30° the analytic sky away from the sun
 * is its deepest, most saturated blue (pose 14 zenith #17467A), while late-afternoon and early-morning skies over a
 * hazy July landscape read softer and paler; 0.62 there, 0.85 at high sun (pose 03 unchanged) and in twilight.
 */
export function viewSkySat(elDeg: number): number {
  return interp(
    [
      [2, VIEW_SKY_SAT],
      [8, 0.8],
      [15, 0.62],
      [28, 0.62],
      [45, VIEW_SKY_SAT],
    ],
    elDeg,
  );
}
/** Saturation multiplier of the visible sky at a view direction with vertical component `dirY` (GLSL twin in atmosphere.ts). */
export function visibleSkySat(dirY: number, horizonSat = HORIZON_SAT): number {
  const t = Math.pow(1 - clamp(dirY, 0, 1), 3);
  return 1 + (horizonSat - 1) * t;
}

/**
 * The background sky is shown this many stops brighter than the radiance that lights the scene [I, art direction,
 * wave-1 review]. The three.js Preetham zenith comes out at ≈ 0.1 of a sunlit white wall, which reads as a dark navy
 * on screen next to the bright render; photographs and the Le Clerc gouache show a much paler sky. The image-based
 * light is not raised, so the light budget (sun:sky ≈ 5:1) is unchanged.
 */
export const SKY_VIEW_EV = 0.9;
/**
 * Elevation-dependent version [I]: at low sun the exposure follows the sunlit façades (meterIlluminance, up to 0.8 EV
 * darker than metering the ground), which made the anti-solar sky a near-black navy (pose 09 / 14). +1.6 EV up to 4°,
 * rising to +2.35 at the 17:30 / 07:00 hero hours (wave-2 review: pose 14's zenith read #17467A), back to +0.9 by
 * 56° (10:30, pose 03 unchanged); no lift in twilight (below −2°). Wave-2 review fix: the open low-sun key (`keyStops`)
 * and the higher sky lux brighten everything by 0.35–0.55 EV at 4–30°; the table is lowered by the same amount, so the
 * sky on screen stays where the wave-2 review accepted it.
 */
const SKY_VIEW_EV_TABLE: readonly (readonly [number, number])[] = [
  [0, 1.6],
  [4, 1.25],
  [6, 1.03],
  [8, 0.93],
  [14, 1.55],
  [22, 1.85],
  [30, 1.7],
  [42, 1.1],
  [56, SKY_VIEW_EV],
];
export function skyViewEv(elDeg: number): number {
  return elDeg > -2 ? interp(SKY_VIEW_EV_TABLE, elDeg) : SKY_VIEW_EV;
}

/**
 * Chromatic adaptation (KB-I06 fix, wave-1 review): von Kries gains in linear sRGB that move the scene illuminant
 * `illum` (any scale) toward neutral by `degree` (0 = none, 1 = full), keeping its luminance. Diagonal gains commute
 * with the per-channel albedo multiply, so applying them to every light (sun, sky, haze) equals a white balance of
 * the image before tone mapping. Von Kries 1902; CIECAM02 uses the same degree-of-adaptation idea
 * (https://en.wikipedia.org/wiki/Chromatic_adaptation).
 */
export function whiteBalance(illum: RGB, degree: number): RGB {
  const l0 = normalise(illum);
  if (!(l0[0] > 0 || l0[1] > 0 || l0[2] > 0)) return [1, 1, 1];
  // a channel at 0 (e.g. the blue of a 1850 K blackbody in Helland's fit) would need an infinite gain
  const n: RGB = [Math.max(l0[0], 0.03), Math.max(l0[1], 0.03), Math.max(l0[2], 0.03)];
  const d = clamp(degree, 0, 1);
  const g: RGB = [Math.pow(n[0], -d), Math.pow(n[1], -d), Math.pow(n[2], -d)];
  const k = luminance(n) / luminance([g[0] * n[0], g[1] * n[1], g[2] * n[2]]);
  return [g[0] * k, g[1] * k, g[2] * k];
}

/**
 * Degree of adaptation over sun elevation [I]: the eye neutralises most of the daylight mix at high sun, less at the
 * golden hour (warm light is meant to read warm), and keeps twilight blue but takes the violet edge off. 'kino'
 * adapts less (warmer low sun, bluer dusk). Wave-2 review: 0.35 at 22° neutralised the hero hours back toward noon
 * (poses 14, 15); 0.2 keeps 17:30 / 07:00 visibly late / early, high sun (≥ 50°) unchanged.
 */
const ADAPT: readonly (readonly [number, number])[] = [
  [-12, 0.15],
  [-6, 0.1],
  [-2, 0.12],
  [3, 0.15],
  [10, 0.18],
  [22, 0.2],
  [30, 0.35],
  [40, 0.6],
  [50, 0.85],
];
export function adaptationDegree(elDeg: number, look: 'doku' | 'kino' = 'doku'): number {
  const d = interp(ADAPT, elDeg);
  return look === 'kino' ? d * 0.6 : d;
}

/** Kino exposure lift at the golden hour, and the part of it kept by the low morning / evening sun (EV, see kinoLowSun) [I]. */
export const KINO_GOLDEN_EV = 0.45;
export const KINO_LOW_EV = 0.25;

/**
 * Kino low-sun grade (wave-5 review: the Rundflug's 'Goldene Stunde', 18:45 / sun ≈ 10°, read as flat grey haze) [I,
 * art direction]. `w` is how much the golden-hour treatment applies: 1 between 3° and 12°, gone by 24° and below −1°
 * (the twilight keeps its own look). It returns multipliers on top of the Kino look:
 * - `adapt`: the degree of adaptation (warmer key: the camera keeps the low sun's colour, 0.6× → ≈ 0.33× of Doku);
 * - `fill`: the sky's share of the light (image-based light and SH; deeper, cooler shade next to the warm key);
 * - `skySat`: the visible sky's saturation (less milky);
 * - `haze`: the haze density (clearer air, on top of KINO_HAZE);
 * - `g` (wave-7 KB-I06): the weight of the golden display grade (grade.ts kinoLookAt: lighter midtones, more
 *   saturation). It reaches further: 1 up to 12°, half of it from 26° on through the day, so the morning and
 *   midday shots of the Rundflug ('Galerie' 08:30, sun ≈ 40°) lose the olive, muddy midtones too;
 * - `ev` (wave-7 KB-I06): an exposure lift outdoors, KINO_GOLDEN_EV at the golden hour and KINO_LOW_EV of the wider
 *   ramp `g` (the golden meadow read dark olive-brown, #7F6A3B in the Rundflug; a photographer exposes warm light for
 *   the lit side, ≈ +½ EV over the metered average) [I].
 * Dokumentation never uses it.
 */
export function kinoLowSun(elDeg: number): { w: number; adapt: number; fill: number; skySat: number; haze: number; g: number; ev: number } {
  const up = clamp((elDeg + 1) / 4, 0, 1);
  const s = (t: number) => t * t * (3 - 2 * t);
  const w = s(Math.min(up, 1 - clamp((elDeg - 12) / 12, 0, 1)));
  const g = s(Math.min(up, Math.max(0.5, 1 - clamp((elDeg - 12) / 28, 0, 1))));
  const ev = KINO_GOLDEN_EV * w + KINO_LOW_EV * Math.max(0, g - w);
  return { w, adapt: 1 - 0.6 * w, fill: 1 - 0.4 * w, skySat: 1 + 0.45 * w, haze: 1 - 0.45 * w, g, ev };
}

/**
 * Scene illuminant for the white balance: what a horizontal white card receives (sun + desaturated sky), linear RGB
 * in lux; `sunRgb` and `skyRgb` have luminance 1.
 */
export function sceneIlluminant(elDeg: number, sunRgb: RGB, skyRgb: RGB): RGB {
  const sun = sunIlluminance(elDeg) * Math.max(0, Math.sin(elDeg * DEG));
  const sky = skyIlluminance(elDeg);
  return [sunRgb[0] * sun + skyRgb[0] * sky, sunRgb[1] * sun + skyRgb[1] * sky, sunRgb[2] * sun + skyRgb[2] * sky];
}

/**
 * Colour multiplier (luminance 1) applied to the sky after Preetham: neutral by day, blue hour in civil twilight,
 * a deeper cobalt toward the end of nautical twilight, a cool grey-blue night floor [I]. Wave-1 review: the old deep
 * tint (red above green) read violet on the render; green now stays above red.
 */
export function skyTint(elDeg: number): RGB {
  const day: RGB = [1, 1, 1];
  const blue: RGB = [0.84, 0.96, 1.22];
  const deep: RGB = [0.68, 0.9, 1.3];
  const night: RGB = [0.74, 0.88, 1.1];
  const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  let c: RGB;
  if (elDeg >= 0) c = mix(day, blue, 1 - smoothstep(0, 4, elDeg));
  else if (elDeg >= -6) c = mix(blue, deep, smoothstep(0, -6, elDeg));
  else c = mix(deep, night, smoothstep(-9, -15, elDeg));
  return normalise(c);
}

/**
 * How many stops darker than a "correct" incident-light exposure the scene is rendered, over elevation [I].
 * 0 by day (the eye adapts fully), then the image is allowed to darken through twilight so dusk reads as dusk and
 * night as night, but never black. Wave-1 review: dusk read as "day for night" (render brighter than the sky), so the
 * twilight band sits ≈ 0.7 EV darker than before, on top of the brighter day calibration (EXPOSURE_K). Wave-2 review:
 * 0.15 EV lower key at the hero hours (20–26°), so the sunlit render sits below Neutral's shoulder and keeps its warm
 * cast instead of desaturating to white (poses 14, 15 read like noon); the shade is lifted by the sky lux instead.
 * The key fades out by 56° (10:30 unchanged) slowly enough that the EV still rises with the sun.
 * Wave-2 review fix: once the image-based sky stopped adding ≈ 1 EV of circumsolar light to sun-facing walls
 * (`envSkyIso`), the analytic meter (sun · cos el + half the sky) left the sunlit render ≈ 0.4 EV (22°) to 0.8 EV (6°)
 * darker than before; the key now opens up by 0.2 EV at the hero hours and 0.35–0.4 EV at the golden hour instead, so
 * the sunlit walls keep their glow and the (now brighter) shade follows.
 * KB-I74: with less sky fill at low sun (lowSunSkyFill) the grazing-lit court went brown-dark at 19:12; the key opens
 * 0.12 EV more at 6–10° (0.05 at 14°), and SKY_VIEW_EV_TABLE is lowered by the same amount, so the sky stays.
 */
const KEY_STOPS: readonly (readonly [number, number])[] = [
  [-18, 4.0],
  [-12, 3.6],
  [-6, 3.3],
  [-4, 2.8],
  [-2, 2.1],
  [0, 1.2],
  [3, 0.3],
  [6, -0.47],
  [10, -0.52],
  [14, -0.35],
  [20, -0.2],
  [26, -0.2],
  [40, -0.08],
  [56, 0],
];
export function keyStops(elDeg: number): number {
  return interp(KEY_STOPS, elDeg);
}

/** Incident-light EV100 for an illuminance in lux (calibration constant C = 250). */
export function evFromLux(lux: number): number {
  return Math.log2(Math.max(lux, 1e-6) / 2.5);
}

/**
 * Metering illuminance (lux): the larger of the horizontal global illuminance and the illuminance on a vertical card
 * facing the sun (sun · cos el + half the sky), i.e. exposed for the brightest lit surface. At high sun the ground
 * wins; at low sun the sunlit façades are 1–1.5 EV brighter than the ground, and metering on the ground alone pushed
 * them into the tone-mapping shoulder, where Neutral desaturates them to white (wave-1 review: 14 / 15 / 09 read
 * neutral instead of cream) [I].
 */
export function meterIlluminance(elDeg: number): number {
  const g = Math.max(globalIlluminance(elDeg), NIGHT_FLOOR_LUX);
  const v = sunIlluminance(elDeg) * Math.max(0, Math.cos(elDeg * DEG)) + 0.5 * skyIlluminance(elDeg);
  return Math.max(g, v);
}

/** Adapted EV100 outdoors: ≈ 15.4 at high sun, ≈ 13.5 at golden hour (7°, metered on the sunlit façade), ≈ 1.6 at −6°. */
export function evOutdoor(elDeg: number): number {
  return evFromLux(meterIlluminance(elDeg)) + keyStops(elDeg);
}

/** Daylight factor of the side-lit state rooms (share of outdoor horizontal illuminance indoors) [I, typical 2–5 %]. */
export const DAYLIGHT_FACTOR = 0.03;
/**
 * Ambient level of a room at night from its candles (lux) [I]; the point lights add the local pools. Wave-1 review:
 * at 3 lx the ambient flattened the Festsaal into an evenly lit "beige office"; at 0.4 lx the falloff of the candle
 * lights carries the room. Wave-5 review fix: the chandeliers burn only for a celebration now, so an ordinary evening is
 * the two mantel candelabra and the sconces; 0.4 lx still read "uniformly sepia-bright" (pose 07), 0.15 lx lets the
 * room fall off away from the candles.
 */
export const CANDLE_AMBIENT_LUX = 0.15;
/** Candle flame colour temperature (K): 1800–1930 K (look-and-period.md §5, hypertextbook). */
export const CANDLE_K = 1850;

/**
 * Indoor ambient illuminance (lux): daylight through the windows, plus the candle ambient at night when `candles`
 * (the viewer lights the rooms only around the visitor; which windows were lit in 1789 is U, backlog KB-I43).
 */
export function roomIlluminance(elDeg: number, candles = true): number {
  return DAYLIGHT_FACTOR * globalIlluminance(elDeg) + (candles ? CANDLE_AMBIENT_LUX * (1 - smoothstep(-6, 2, elDeg)) : 0);
}

/**
 * Stops of headroom of the indoor day exposure (EV100 above the ambient meter reading) [I]. Festsaal review (wave 2):
 * 0.5 left the shaded boiserie a mid grey (#C2BEB2); 0.2 brings it to a light warm off-white, and the sun pools on
 * the floor sit on the shoulder (bright, still textured) instead of a flat white. Festsaal review (wave 2, second pass):
 * the window side read blown out at 0.1. Measured at pose 06: what clips is the window opening itself (outdoor haze
 * and reveal ≈ 4–5 EV above the room, #F4F9FD at any headroom up to 0.4), while +0.3 EV greyed the boiserie
 * (#D4D0C5 → #C0BEB2) and the ceiling; 0.25 (+0.15 EV) keeps the sun pools and the window wall textured.
 */
export const INDOOR_DAY_HEADROOM_EV = 0.25;
/**
 * Adapted EV100 inside a room [I]: by day metered on the room's ambient daylight with INDOOR_DAY_HEADROOM_EV of headroom, so the
 * shaded white boiserie reads light but the sun patches through the windows stay near the shoulder (wave-1 review,
 * pose 06); by candle light metered for the pools near the candles (CANDLE_KEY_LUX), so the far end of the room
 * drops into the dark.
 */
export function evIndoor(elDeg: number): number {
  const day = smoothstep(-4, 6, elDeg);
  return evFromLux(roomIlluminance(elDeg) + CANDLE_KEY_LUX * (1 - day)) + INDOOR_DAY_HEADROOM_EV * day;
}
/**
 * Illuminance (lux) the eye adapts to in a candle-lit room [I]. Wave 1–10: 5 lx. Wave 11 (look): the room is lit by
 * its own candle clusters now (candleLight.ts) and no longer by a light under the floor; 3 lx (+0.7 EV) keeps the pool
 * round a single guéridon candle and the parquet readable at pose 07 (a 1 cd flame gives 3 lx at 0.58 m).
 */
export const CANDLE_KEY_LUX = 3;

/**
 * Pre-exposure for an adapted EV100: display value = luminance (cd/m²) × preExposure (Lagarde & de Rousiers,
 * "Moving Frostbite to PBR", SIGGRAPH 2014 course notes: max luminance = 1.2 · 2^EV100).
 */
export function preExposure(ev: number): number {
  return 1 / (1.2 * Math.pow(2, ev));
}

/** Frame-rate independent ease of the adapted EV toward a target (time constant tau seconds). */
export function easeEv(current: number, target: number, dt: number, tau = 1.2): number {
  if (!Number.isFinite(current)) return target;
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  return current + (target - current) * k;
}
