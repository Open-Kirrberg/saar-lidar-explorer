/**
 * Pure parameters of the post chain (KB-I41) and of the water reflections (KB-I37). No three.js, no DOM: post.ts turns
 * these numbers into uniforms, viewer/tests/post.test.ts checks them.
 *
 * Units: the scene target holds pre-exposed linear radiance (display = cd/m² × pre-exposure, light.ts), so a sunlit
 * white render reads ≈ 0.8–1.0 and the tone mapper's exposure carries only the eye adaptation on top (main.ts).
 */
import { smoothstep } from '@model/layout/geom.ts';
import { kinoLowSun } from './light.ts';

/** Rec. 709 luminance weights (linear RGB). */
export const LUM = [0.2126, 0.7152, 0.0722] as const;

// ---------------------------------------------------------------- ambient occlusion

/**
 * World radius (m) of the screen-space AO at a view distance `d` (m): about 1.1 m at eye level (wall foot, steps,
 * furniture), growing with distance so that the court walls still meet the ground in an aerial (≈ 4.5 m at 300 m), and
 * capped at 6 m [I, tuned on poses 01, 03, 14].
 */
export function aoRadius(d: number): number {
  return Math.min(6, Math.max(0.9, 0.9 + 0.012 * Math.max(0, d)));
}

/**
 * Indoor AO (wave-6 review: a grey band under the ceiling coves and cornices and dark halos over the chair backs read
 * as soot in white Louis-seize rooms, look-and-period §4). Inside a building the radius is a fixed 0.35 m (contact
 * shade under furniture, at the skirting and in the panel mouldings, not the 1 m+ room-scale darkening the room
 * environment already carries) and the strength is lower [I, tuned on poses 06, 21].
 */
export const AO_INDOOR = { radius: 0.35, strength: 0.55 } as const;

/**
 * Resolution divisor of the AO buffer for a drawing buffer of `pixels` (KB-I65): half resolution up to ≈ 4.2 Mpx
 * (Hoch on a retina laptop), quarter resolution above (native retina, where a half-resolution AO texel is already
 * smaller than the blur radius) [I].
 */
export function aoDivisor(pixels: number): number {
  return pixels > 4.2e6 ? 4 : 2;
}

/**
 * Linear scale of the sky target (KB-I65: the Preetham sky with its cloud fbm cost 5–6 ms of a 12 ms retina frame at
 * eye level). The sky is smooth apart from the sun disc and the cloud edges, so it is shaded at half the resolution
 * per axis up to ≈ 1.5 Mpx and at 0.35 above (1080p and retina), then read back bilinearly by the dome in the scene
 * pass. Same-session A/B (load ≈ 50): retina −0.7…−1.5 ms at 01, 32, 34; 1080p within noise at 0.5 [measured].
 */
export function skyScale(pixels: number): number {
  return pixels > 1.5e6 ? 0.35 : 0.5;
}

/**
 * KB-I65 (wave-7): the sky dome is camera-centred and its shader depends on the view direction and its uniforms only
 * (the cloud `time` never advances), so it is cached in a cube map and re-shaded only when a uniform changes (hour,
 * look, haze). Face size: 1024 px ≈ 11–23 px per degree, at least the 0.35 scale of the per-frame target at 1080p
 * (≈ 9 px/°) and close to it at retina (≈ 14 px/°); half-float RGBA, 48 MB [I].
 */
export const SKY_CUBE_SIZE = 1024;
/** Cube faces shaded per frame while the cache refreshes (the per-frame low-resolution sky shows meanwhile). */
export const SKY_CUBE_FACES_PER_FRAME = 1;

/** Flattens uniform values (numbers, booleans, vectors, colours, matrices, arrays) into numbers; textures etc. → NaN. */
export function uniformNumbers(values: readonly unknown[]): number[] {
  const out: number[] = [];
  const add = (v: unknown): void => {
    if (typeof v === 'number' || typeof v === 'boolean') out.push(+v);
    else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const a = v as unknown as ArrayLike<unknown>;
      for (let i = 0; i < a.length; i++) add(a[i]);
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('elements' in o) add(o.elements);
      else if ('isColor' in o) add([o.r, o.g, o.b]);
      else if ('x' in o) add([o.x, o.y, 'z' in o ? o.z : 0, 'w' in o ? o.w : 0]);
      else out.push(NaN);
    } else out.push(NaN);
  };
  for (const v of values) add(v);
  return out;
}

/**
 * Signature of a list of uniform values: equal values (to 5 significant digits) give an equal string, so float noise
 * of a steady sky does not refresh the sky cube.
 */
export function uniformSignature(values: readonly unknown[]): string {
  return uniformNumbers(values)
    .map((x) => (Number.isFinite(x) ? Number(x.toPrecision(5)) : 'o'))
    .join(',');
}

/**
 * True when two uniform states differ only a little (each number within `tol` × max(1, |a|)): the sky of a running
 * clock or a tour. The cached cube may then show the previous state for the few frames its refresh takes; a jump
 * (hour slider, look switch) falls back to the per-frame sky until the new cube is complete.
 */
export function smallUniformChange(a: readonly number[], b: readonly number[], tol = 0.02): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (Number.isNaN(x) && Number.isNaN(y)) continue;
    if (!(Math.abs(x - y) <= tol * Math.max(1, Math.abs(x)))) return false;
  }
  return true;
}

/** AO weight over view distance: full up to 900 m, faded out by 1600 m (the haze carries the far field) [I]. */
export function aoDistanceFade(d: number): number {
  return 1 - smoothstep(900, 1600, d);
}

/**
 * How strongly the AO darkens a pixel of exposed display luminance `l`: screen-space AO stands for the occluded sky
 * and bounce light, so it acts fully in shade and only a third as strongly on sunlit surfaces, whose light is mostly
 * the (already shadowed) sun; emissive light (candles, lit windows) is not occluded at all [I; the usual
 * "ambient-only" approximation of SSAO, e.g. Jimenez et al. 2016, "Practical real-time strategies for accurate
 * indirect occlusion" (GTAO), which applies AO to indirect light only].
 */
export function aoLightWeight(l: number): number {
  return 1 - 0.65 * smoothstep(0.45, 1.1, l);
}

// ---------------------------------------------------------------- scene target

/**
 * MSAA samples of the HDR scene target for a drawing buffer of `pixels`, given the preset's `msaa` [I, measured on
 * an M5 Pro, aerial pose 01]: the multisampled half-float target and its resolve cost little at 1080p but ≈ +6 ms at
 * 3024×1964, where the canvas MSAA of the old path was nearly free (resolved in tile memory). Full MSAA up to ≈ 2.6 Mpx
 * (1080p, 1440p-ish), 2× up to ≈ 4.2 Mpx (Hoch on a retina laptop, dpr 1.5), none above (native retina: the pixels
 * are small enough that the aliasing barely shows).
 */
export function sceneMsaa(msaa: number, pixels: number): number {
  if (msaa <= 0) return 0;
  if (pixels <= 2.6e6) return msaa;
  if (pixels <= 4.2e6) return Math.min(msaa, 2);
  return 0;
}

// ---------------------------------------------------------------- bloom

/**
 * Bloom threshold in exposed display luminance (the tone mapper's input). By day only what lies far above a sunlit
 * white wall blooms (sun glints on glass and water, the sun disc); at night the threshold drops below the lit windows
 * (1.35, nightlights.ts) and the lantern panes so they bleed a little into the dark [I]. `night` 0…1.
 */
export function bloomThreshold(night: number): number {
  const n = Math.min(1, Math.max(0, night));
  return 2.4 + (0.95 - 2.4) * n;
}

/**
 * Bloom strength (share of the blurred highlights added back): restrained by day, a little more at night [I]. Indoors
 * at night more again (wave-6 review: in the Fest the candle flames, a few pixels each, must be the dominant highlights;
 * the eye adapted to a candle-lit room sees a clear glare round each flame) [I].
 */
export function bloomStrength(night: number, indoor = false): number {
  const n = Math.min(1, Math.max(0, night));
  return 0.05 + 0.05 * n + (indoor ? 0.1 * n : 0);
}

/** Highlights are clamped to this exposed luminance before blurring, so single bright pixels cannot flicker [I]. */
export const BLOOM_CLAMP = 24;

// ---------------------------------------------------------------- lanterns

/**
 * Luminous intensity (cd) of one portal lantern toward the wall and the ground [I]: a glazed oil lamp or a candle or two
 * behind glass, ≈ 10–15 lm spread over the sphere (15 lm / 4π ≈ 1.2 cd; one candle is ≈ 1 cd by the unit's origin).
 * The brightest lamps of the period, the Paris *réverbères* (oil lamps with a reflector, from 1765/1769), threw several
 * times that into one direction [N]. One value for every lantern (hypothesis, look-and-period §5). Against moonlight
 * (≈ 0.1 lx) even this gives a clear warm pool of a few metres.
 */
export const LANTERN_CD = 1.2;
/** Reach (m) of the screen-space lantern light; beyond it the light is cut off smoothly [I]. */
export const LANTERN_REACH = 9;
/** Grey albedo assumed for the lit surface (render, sand, sandstone ≈ 0.4–0.6) in the screen-space light [I]. */
export const LANTERN_ALBEDO = 0.45;

/**
 * Illuminance (lx) a lantern of intensity `cd` puts on a surface at distance `dist` (m) whose normal makes `cos`
 * with the direction to the lamp: inverse square law with a 0.2 m core (the lamp is not a point) and a smooth cut-off
 * at `reach`.
 */
export function lanternIlluminance(cd: number, dist: number, cos: number, reach = LANTERN_REACH): number {
  if (!(dist < reach) || cos <= 0) return 0;
  const w = 1 - smoothstep(reach * 0.6, reach, dist);
  return (cd * cos * w) / (dist * dist + 0.04);
}

// ---------------------------------------------------------------- water

/** Schlick's Fresnel reflectance of still water (n = 1.33, F0 = 0.02) at the cosine `cos` of the view angle. */
export function waterFresnel(cos: number): number {
  const c = Math.min(1, Math.max(0, cos));
  return 0.02 + 0.98 * (1 - c) ** 5;
}

/**
 * Screen-space reflection march: exponential steps from `t0` (m) growing by `k` per step. Returns the distance
 * covered after `n` steps, so the tests can check that a 32-step march reaches across the Herzogsgarten (≥ 250 m).
 */
export function marchReach(t0: number, k: number, n: number): number {
  return t0 * k ** n;
}
export const SSR_STEPS = 32;
export const SSR_T0 = 0.35;
export const SSR_GROWTH = 1.24;

// ---------------------------------------------------------------- Kino frame

/** Vignette strength (0 = none) per look: none in Dokumentation, a light one in Kino [I]. */
export function vignetteFor(look: 'doku' | 'kino'): number {
  return look === 'kino' ? 0.22 : 0;
}

/**
 * Kino sky grade (wave-6 review: beige-grey skies in the Rundflug, look §7.2): after the tone mapping (AgX greys bright
 * blues: a sky pixel of HDR (0.60, 0.88, 0.98) came out #B8BBB4) the grade pass moves sky pixels toward this clear
 * July blue (linear display RGB, luminance 1; ≈ #7FA8D8 at its luminance) at constant luminance, up to `strength` from
 * ≈ 8° above the horizon away from the sun (0.45 of it at the horizon) and a quarter of it toward the sun [I, art direction].
 */
export const KINO_SKY_BLUE: [number, number, number] = (() => {
  const b = [0.6, 1.0, 1.65];
  const l = LUM[0] * b[0] + LUM[1] * b[1] + LUM[2] * b[2];
  return [b[0] / l, b[1] / l, b[2] / l] as [number, number, number];
})();

/** Strength of the Kino sky grade: none in Dokumentation or in twilight (sun below −2°, the twilight has its own colours). */
export function kinoSkyStrength(look: 'doku' | 'kino', sunY: number): number {
  if (look !== 'kino') return 0;
  return 0.7 * smoothstep(-0.035, 0.05, sunY);
}

/**
 * Kino golden glow (wave-7 KB-I06: a pale beige sky round the low sun in 'Goldene Stunde' / 'Galerie'): AgX bleaches
 * the bright sky near the sun toward grey-white; the grade pass moves it toward this warm gold (linear display RGB,
 * luminance 1; ≈ #E8BE78 at its luminance) at constant luminance, strongest low on the horizon toward the sun [I, art
 * direction]. Only at the golden hour (light.ts kinoLowSun weight) and never in Dokumentation.
 */
export const KINO_SKY_GOLD: [number, number, number] = (() => {
  const b = [1.3, 0.98, 0.56];
  const l = LUM[0] * b[0] + LUM[1] * b[1] + LUM[2] * b[2];
  return [b[0] / l, b[1] / l, b[2] / l] as [number, number, number];
})();
export const KINO_SKY_GOLD_MAX = 0.6;
/** Strength of the golden glow for the sun's elevation (sunY = sin elevation). */
export function kinoSkyGold(look: 'doku' | 'kino', sunY: number): number {
  if (look !== 'kino') return 0;
  return KINO_SKY_GOLD_MAX * kinoLowSun((Math.asin(Math.min(1, Math.max(-1, sunY))) * 180) / Math.PI).w;
}
