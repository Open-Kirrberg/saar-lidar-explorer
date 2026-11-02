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
export const INDOOR_TONE = { knee: 0.5, s: 0.12 } as const;
export function indoorShoulder(x: number, knee: number = INDOOR_TONE.knee, s: number = INDOOR_TONE.s): number {
  if (!(x > knee)) return x;
  return knee + s * Math.log(1 + (x - knee) / s);
}

/** GLSL twin of `indoorShoulder` on a linear colour (luminance-preserving hue), weight `w` (0 = off). */
export const INDOOR_SHOULDER_GLSL = /* glsl */ `
vec3 skbIndoorShoulder( vec3 c, float exposure, vec3 tone ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) * exposure;
  if ( tone.z <= 0.0 || l <= tone.x ) return c;
  float y = tone.x + tone.y * log( 1.0 + ( l - tone.x ) / tone.y );
  return c * mix( 1.0, y / l, tone.z );
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
