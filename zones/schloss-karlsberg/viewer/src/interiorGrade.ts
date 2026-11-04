/**
 * Indoor tone and light of the state rooms by day (backlog KB-I75, wave-8 visual audit #5). Pure: no three.js, no DOM.
 *
 * The audit found the state rooms "clinically white" (poses 06, 20–24, 27–29): the windows, the court beyond them, the
 * window reveals and the sunlit wall panels clipped to pure white, so the white-and-gold boiserie lost its gilt contrast.
 * Three parts, all indoors only (every outdoor frame is unchanged):
 * - `windowTransmittance`: the "window pull" of interior photography (and the eye's local adaptation): the view through
 *   a pane seen from the room is dimmed to `WINDOW_VIEW_EV` above the room exposure, so the court and the sky read as a
 *   bright view instead of a white hole (glass patch, model/src/materials/index.ts `glassView`) [I];
 * - `indoorShoulder`: a logarithmic shoulder on the scene luminance before the tone mapping (Dokumentation Neutral or
 *   Kino AgX), above `INDOOR_TONE.knee`, so sun pools on lime-white walls and parquet keep texture and the gilt keeps its
 *   hue instead of desaturating to white in the tone mapper's shoulder [I, photographic highlight roll-off];
 * - `warmRoomGrid`: the floor rows of the day room environment (finish of the room-light model,
 *   model/src/interior/materials.ts `roomEnvironmentGrid`) take the waxed oak's colour, as the bounce of the sun pools
 *   on the parquet does in a real room (the model's sun-pool texels are near-neutral). Lime-white walls and the ceiling
 *   then read warm ivory, not grey-white [I; parquet `#9B7448`, research/02 §3, N].
 */
import { clamp, smoothstep } from '@model/layout/geom.ts';

/** Stops the view through a window may stay above the room exposure [I: bright, still textured; 1 EV = 2×]. */
export const WINDOW_VIEW_EV = 1;
/** Most the window pull dims the view (EV) [I]. */
export const WINDOW_PULL_MAX_EV = 4;

/**
 * Transmittance (0…1] of the view through a pane seen from the room, for the gap `gapEv` = outdoor EV − adapted EV
 * (≈ 5 EV by day in a side-lit room, < 0 at night by candle light). 1 = no pull.
 */
export function windowTransmittance(gapEv: number): number {
  const pull = Math.min(WINDOW_PULL_MAX_EV, Math.max(0, gapEv - WINDOW_VIEW_EV));
  return Math.pow(2, -pull);
}

/**
 * Indoor highlight shoulder on the exposed scene luminance x (before the tone mapping): identity up to `knee`, then
 * knee + s · ln(1 + (x − knee) / s) (slope 1 at the knee, logarithmic beyond). The shaded lime-white boiserie
 * (≈ 0.6 after exposure) moves to ≈ 0.57 (≈ 0.79 on screen); a sky-lit window reveal (≈ 3) lands at ≈ 0.87 (≈ 0.92 on
 * screen) and a sun pool 30× above the shade (≈ 20) at ≈ 1.1 (≈ 0.95), inside Neutral's shoulder but short of its
 * white, so both keep their gradients and the gilt its hue [I].
 */
export const INDOOR_TONE = { knee: 0.5, s: 0.12, knee2: 0.66, s2: 0.05 } as const;
/**
 * KB-I92 (wave-11 look): a second, tighter log stage above `knee2` (output units; reached at an exposed luminance of
 * ≈ 0.84, so the shaded walls, the floors and the gilt below are unchanged; a sunlit wall at ≈ 1 moves by ≈ 1 %). The
 * sky-lit window reveals (exposed ≈ 2–4, poses 20 / 29: the exterior's lime reveal inside the glass, lit by the outdoor
 * sky) clipped at ≈ 0.91–0.92 display white; now ≈ 0.73–0.75 before Neutral (≈ 0.86 on screen), a sun pool (≈ 20)
 * ≈ 0.77: still the brightest, still apart, still logarithmic so their own shading keeps its steps [I].
 */
export function indoorShoulder(x: number, knee: number = INDOOR_TONE.knee, s: number = INDOOR_TONE.s, knee2: number = INDOOR_TONE.knee2, s2: number = INDOOR_TONE.s2): number {
  if (!(x > knee)) return x;
  const y = knee + s * Math.log(1 + (x - knee) / s);
  return y > knee2 ? knee2 + s2 * Math.log(1 + (y - knee2) / s2) : y;
}

/**
 * Wave-11 review fix (pose 07 and photo mode, "the tabletop clips to a flat cream disc"). By candle light the warm
 * marble top next to a flame is exposed at a red channel of ≈ 1.0 (rim) … 1.8 (centre) while its luminance stays
 * ≈ 0.7–1.2; the tone mapper compresses on the largest channel, so the red ran into Neutral's shoulder and the top lost
 * its falloff (rim : centre 1 : 1.07 on screen against 1 : 1.75 in light). At night the shoulder therefore measures the
 * largest channel (`peak` 1) instead of the luminance and starts lower (knee 0.35, s 0.15, the second stage off): the top
 * ends at ≈ 0.86 display white in red with rim : centre ≈ 1 : 1.16, while a flame (red ≈ 2000 exposed) still reaches
 * ≈ 0.98 and burns white [I]. Between day and night the parameters blend continuously; by day the KB-I75 / KB-I92 curve
 * is unchanged.
 */
export const INDOOR_TONE_NIGHT = { knee: 0.35, s: 0.15 } as const;
/** `knee2` that switches the second stage off (above any value the first stage reaches for exposed ≤ 10⁴). */
const KNEE2_OFF = 4;

export interface IndoorTone {
  knee: number;
  s: number;
  knee2: number;
  s2: number;
  /** measure: 0 = luminance, 1 = the largest channel */
  peak: number;
}

/** Shoulder parameters for the night factor (0 day … 1 night), blended continuously. */
export function indoorToneParams(night: number): IndoorTone {
  const n = clamp(night, 0, 1);
  return {
    knee: INDOOR_TONE.knee + (INDOOR_TONE_NIGHT.knee - INDOOR_TONE.knee) * n,
    s: INDOOR_TONE.s + (INDOOR_TONE_NIGHT.s - INDOOR_TONE.s) * n,
    knee2: INDOOR_TONE.knee2 + (KNEE2_OFF - INDOOR_TONE.knee2) * n,
    s2: INDOOR_TONE.s2,
    peak: n,
  };
}

/** The shoulder on a linear, exposed colour (TS twin of the GLSL): scales `c` by y(m) / m of its measure m. */
export function indoorShoulderRgb(c: readonly [number, number, number], t: IndoorTone): [number, number, number] {
  const m = (1 - t.peak) * (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) + t.peak * Math.max(c[0], c[1], c[2]);
  if (!(m > 0)) return [c[0], c[1], c[2]];
  const k = indoorShoulder(m, t.knee, t.s, t.knee2, t.s2) / m;
  return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * GLSL twin of `indoorShoulder` on a linear colour (hue-preserving): `tone` = (knee, s, weight w (0 = off)),
 * `tone2` = (knee2, s2, measure: 0 luminance … 1 largest channel).
 */
export const INDOOR_SHOULDER_GLSL = /* glsl */ `
vec3 skbIndoorShoulder( vec3 c, float exposure, vec3 tone, vec3 tone2 ) {
  float l = mix( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), max( max( c.r, c.g ), c.b ), tone2.z ) * exposure;
  if ( tone.z <= 0.0 || l <= tone.x ) return c;
  float y = tone.x + tone.y * log( 1.0 + ( l - tone.x ) / tone.y );
  if ( y > tone2.x ) y = tone2.x + tone2.y * log( 1.0 + ( y - tone2.x ) / tone2.y );
  return c * mix( 1.0, y / l, tone.z );
}`;

/**
 * KB-I92: indoors by day the screen-space AO keeps more of its strength on bright, sky-lit surfaces (exposed ≈ 1.1–8:
 * the window reveals and the jambs), so the embrasure's inner corners and the sill line darken as they do in a real
 * reveal; sun pools (≥ 12) and everything below 1.1 keep the outdoor fade (post.ts) [I]. Returns the AO fade weight
 * (0 = full AO … 0.65 = the outdoor maximum fade) for exposed luminance `l`; `indoor` 0…1.
 */
export function aoBrightFade(l: number, indoor: number): number {
  const out = 0.65 * smoothstep(0.45, 1.1, l);
  return out * (1 - indoor * 0.6 * smoothstep(1.1, 2.0, l) * (1 - smoothstep(6.0, 12.0, l)));
}
export const AO_BRIGHT_FADE_GLSL = /* glsl */ `
float skbAoBrightFade( float l, float indoor ) {
  float o = 0.65 * smoothstep( 0.45, 1.1, l );
  return o * ( 1.0 - indoor * 0.6 * smoothstep( 1.1, 2.0, l ) * ( 1.0 - smoothstep( 6.0, 12.0, l ) ) );
}`;

/** Share of the oak's own colour in the floor bounce (the rest neutral: the wax film reflects walls and windows) [I]. */
export const PARQUET_BOUNCE_SHARE = 0.2;
/** Colour of the parquet bounce (linear RGB, luminance 1): waxed oak `#9B7448`, `PARQUET_BOUNCE_SHARE` of the way [I]. */
export const PARQUET_BOUNCE: readonly [number, number, number] = (() => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const oak = [0x9b / 255, 0x74 / 255, 0x48 / 255].map(lin);
  const l = 0.2126 * oak[0] + 0.7152 * oak[1] + 0.0722 * oak[2];
  return oak.map((v) => 1 - PARQUET_BOUNCE_SHARE + (PARQUET_BOUNCE_SHARE * v) / l) as unknown as readonly [number, number, number];
})();

/** Rows of the 8-row day room grid that are floor (`roomEnvironmentGrid`: rows 6–7 parquet, 6 holds the sun pools). */
export const FLOOR_ROWS: readonly number[] = [6, 7];

/**
 * Warm the floor rows of a room environment grid (w × h texels, linear RGB per texel, row 0 = ceiling) toward
 * `PARQUET_BOUNCE`, keeping each texel's luminance. Returns a new array and the new mean luminance.
 */
export function warmRoomGrid(w: number, h: number, rgb: Float32Array, rows: readonly number[] = FLOOR_ROWS, bounce: readonly [number, number, number] = PARQUET_BOUNCE): { rgb: Float32Array; meanLuminance: number } {
  const out = new Float32Array(rgb);
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const l = 0.2126 * out[o] + 0.7152 * out[o + 1] + 0.0722 * out[o + 2];
      if (rows.includes(y)) for (let i = 0; i < 3; i++) out[o + i] = l * bounce[i];
      sum += l;
    }
  }
  return { rgb: out, meanLuminance: sum / (w * h) };
}
