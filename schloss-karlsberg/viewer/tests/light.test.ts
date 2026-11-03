import { describe, expect, it } from 'vitest';
import {
  airmass,
  easeEv,
  CANDLE_KEY_LUX,
  evFromLux,
  evIndoor,
  evOutdoor,
  globalIlluminance,
  adaptationDegree,
  envSkySat,
  interp,
  kelvinLinear,
  kelvinToSrgb,
  luminance,
  meterIlluminance,
  NIGHT_FLOOR_LUX,
  preExposure,
  roomIlluminance,
  saturate,
  sceneIlluminant,
  skyIlluminance,
  skyTint,
  skyViewEv,
  viewSkySat,
  VIEW_SKY_SAT,
  INDOOR_DAY_HEADROOM_EV,
  keyStops,
  sunColour,
  sunIlluminance,
  sunKelvin,
  sunSkyRatio,
  visibleSkySat,
  whiteBalance,
  daylightXy,
  envSkyIso,
  skyKelvin,
  skylightColour,
  skylightWeight,
  SKY_GREEN_TRIM,
  LOW_SUN_HAZE_WARM,
  lowSunHazeWarm,
  lowSunSkyFill,
  skyGreenTrim,
  SUN_EXTINCTION,
  xyToLinear,
} from '../src/light.ts';

const ELS = [-20, -15, -10, -6, -3, 0, 2, 5, 10, 20, 40, 62];

describe('light budget (KB-I06)', () => {
  it('interp clamps and interpolates linearly', () => {
    const t = [
      [0, 0],
      [10, 100],
    ] as const;
    expect(interp(t, -5)).toBe(0);
    expect(interp(t, 5)).toBe(50);
    expect(interp(t, 20)).toBe(100);
  });

  it('air mass is 1 at the zenith and ≈ 38 at the horizon', () => {
    expect(airmass(90)).toBeCloseTo(1, 2);
    expect(airmass(0)).toBeGreaterThan(35);
    expect(airmass(0)).toBeLessThan(40);
  });

  it('sun and sky illuminance rise monotonically with elevation', () => {
    for (let i = 1; i < ELS.length; i++) {
      expect(skyIlluminance(ELS[i])).toBeGreaterThan(skyIlluminance(ELS[i - 1]));
      expect(sunIlluminance(ELS[i])).toBeGreaterThanOrEqual(sunIlluminance(ELS[i - 1]));
      expect(globalIlluminance(ELS[i])).toBeGreaterThan(globalIlluminance(ELS[i - 1]));
    }
  });

  it('matches the Wikipedia anchors: direct sun 32–100 klx high, ≈ 400 lx at sunset, 3.4 lx at −6°', () => {
    expect(sunIlluminance(62)).toBeGreaterThan(90000);
    expect(sunIlluminance(62)).toBeLessThan(110000);
    expect(skyIlluminance(0)).toBeGreaterThan(300);
    expect(skyIlluminance(0)).toBeLessThan(600);
    expect(skyIlluminance(-6)).toBeCloseTo(3.4, 5);
    expect(sunIlluminance(-2)).toBe(0);
    expect(skyIlluminance(-30)).toBeCloseTo(NIGHT_FLOOR_LUX, 5);
  });

  it('sun:sky ratio is 3:1–8:1 at high sun and falls toward the horizon', () => {
    expect(sunSkyRatio(62)).toBeGreaterThan(3);
    expect(sunSkyRatio(62)).toBeLessThan(8);
    expect(sunSkyRatio(5)).toBeLessThan(sunSkyRatio(62));
    expect(sunSkyRatio(1)).toBeLessThan(sunSkyRatio(5));
  });

  it('sun colour: warm and low, near white high; the blackbody fit is white at 6500 K', () => {
    expect(sunKelvin(0)).toBe(2500);
    expect(sunKelvin(62)).toBeGreaterThan(5700);
    const w = kelvinToSrgb(6500);
    for (const c of w) expect(c).toBeGreaterThan(0.97);
    const c1850 = kelvinToSrgb(1850);
    expect(c1850[0]).toBe(1);
    expect(c1850[1]).toBeGreaterThan(0.45);
    expect(c1850[1]).toBeLessThan(0.55);
    expect(c1850[2]).toBe(0);
    for (const e of [0, 5, 30, 62]) expect(luminance(sunColour(e))).toBeCloseTo(1, 6);
    const low = sunColour(2);
    expect(low[0]).toBeGreaterThan(low[2] * 2);
  });

  it('sky tint keeps luminance 1, neutral by day, blue in twilight', () => {
    for (const e of [-18, -9, -4, 0, 2, 30]) expect(luminance(skyTint(e))).toBeCloseTo(1, 6);
    const day = skyTint(30);
    expect(day[0]).toBeCloseTo(day[2], 6);
    const dusk = skyTint(-4);
    expect(dusk[2]).toBeGreaterThan(dusk[0] * 1.3);
    // wave-1 review: no violet cast, green stays above red in every twilight tint
    for (const e of [-2, -4, -6, -9, -12, -18]) expect(skyTint(e)[1]).toBeGreaterThan(skyTint(e)[0]);
  });

  it('exposure: EV100 ≈ 15 at high sun, ≈ 13.5 at golden hour (metered on the sunlit façade), bounded at night', () => {
    expect(evFromLux(2.5)).toBeCloseTo(0, 9);
    expect(evOutdoor(62)).toBeGreaterThan(14.5);
    expect(evOutdoor(62)).toBeLessThan(16);
    expect(evOutdoor(7)).toBeGreaterThan(12.8);
    expect(evOutdoor(7)).toBeLessThan(14.2);
    for (let i = 1; i < ELS.length; i++) expect(evOutdoor(ELS[i])).toBeGreaterThanOrEqual(evOutdoor(ELS[i - 1]));
    expect(Number.isFinite(evOutdoor(-40))).toBe(true);
  });

  it('indoor: darker than outside by day, candle ambient only when lit', () => {
    expect(evIndoor(40)).toBeLessThan(evOutdoor(40) - 3);
    // wave-1 review: a small candle ambient (0.4 lx, wave-5 fix 0.15 lx with the chandeliers out), the point lights carry the room
    expect(roomIlluminance(-15, true)).toBeGreaterThan(roomIlluminance(-15, false) + 0.1);
    expect(roomIlluminance(-15, true)).toBeLessThan(roomIlluminance(-15, false) + 1);
    // the night meter (CANDLE_KEY_LUX near the candles; 5 lx until wave 10, 3 lx with the wave-11 candle pool) keeps
    // the far end of the room dark but not black
    expect(evIndoor(-15)).toBeGreaterThan(0.2);
    expect(evIndoor(-15)).toBeLessThan(1.0);
    expect(evIndoor(-15)).toBeCloseTo(evFromLux(roomIlluminance(-15) + CANDLE_KEY_LUX), 6);
    expect(roomIlluminance(40, true)).toBeCloseTo(roomIlluminance(40, false), 6);
  });

  it('pre-exposure follows Lagarde & de Rousiers (1 / (1.2 · 2^EV))', () => {
    expect(preExposure(0)).toBeCloseTo(1 / 1.2, 9);
    expect(preExposure(15) * 1.2 * 2 ** 15).toBeCloseTo(1, 9);
    expect(preExposure(10) / preExposure(11)).toBeCloseTo(2, 9);
  });

  it('easeEv converges frame-rate independently and accepts a NaN start', () => {
    expect(easeEv(NaN, 5, 0.016)).toBe(5);
    let a = 0;
    for (let i = 0; i < 60; i++) a = easeEv(a, 10, 1 / 60);
    let b = 0;
    for (let i = 0; i < 30; i++) b = easeEv(b, 10, 1 / 30);
    expect(a).toBeCloseTo(b, 9);
    expect(easeEv(0, 10, 100)).toBeCloseTo(10, 6);
    expect(easeEv(3, 10, -1)).toBe(3);
  });

  it('meterIlluminance: ground at high sun, the sunlit façade at low sun', () => {
    expect(meterIlluminance(62)).toBeCloseTo(globalIlluminance(62), 6);
    expect(meterIlluminance(7)).toBeGreaterThan(globalIlluminance(7) * 2);
    expect(meterIlluminance(-30)).toBeGreaterThanOrEqual(NIGHT_FLOOR_LUX);
  });
});

describe('white balance and sky colour (KB-I06 fix, wave-1 review)', () => {
  it('saturate keeps luminance; 0 is grey, 1 unchanged', () => {
    const c: [number, number, number] = [0.2, 0.5, 0.9];
    expect(luminance(saturate(c, 0.3))).toBeCloseTo(luminance(c), 9);
    const g = saturate(c, 0);
    expect(g[0]).toBeCloseTo(g[2], 9);
    expect(saturate(c, 1)).toEqual(c);
  });

  it('whiteBalance: full degree neutralises the illuminant, zero is identity, luminance kept', () => {
    const warm = kelvinLinear(3000);
    const g = whiteBalance(warm, 1);
    const out: [number, number, number] = [warm[0] * g[0], warm[1] * g[1], warm[2] * g[2]];
    expect(out[0]).toBeCloseTo(out[1], 6);
    expect(out[1]).toBeCloseTo(out[2], 6);
    expect(luminance(out)).toBeCloseTo(luminance(warm), 6);
    for (const k of whiteBalance(warm, 0)) expect(k).toBeCloseTo(1, 9);
    const half = whiteBalance(warm, 0.5);
    expect(half[2]).toBeGreaterThan(1); // blue raised for a warm light
    expect(half[2]).toBeLessThan(g[2]);
    // a channel at zero (1850 K blackbody) stays finite
    for (const k of whiteBalance(kelvinLinear(1850), 0.75)) expect(Number.isFinite(k)).toBe(true);
    expect(whiteBalance([0, 0, 0], 1)).toEqual([1, 1, 1]);
  });

  it('adaptation is high at noon, low at the golden hour and in twilight; kino adapts less', () => {
    expect(adaptationDegree(60)).toBeGreaterThan(0.8);
    expect(adaptationDegree(6)).toBeLessThan(0.25);
    expect(adaptationDegree(-8)).toBeLessThan(0.2);
    expect(adaptationDegree(40, 'kino')).toBeCloseTo(adaptationDegree(40) * 0.6, 9);
  });

  it('scene illuminant (horizontal card): warm with the sun up, the sky colour at night', () => {
    const sky: [number, number, number] = [0.8, 1, 1.3];
    const sunUp = sceneIlluminant(20, sunColour(20), sky);
    expect(sunUp[0]).toBeGreaterThan(sunUp[2]);
    // at 5° the sun grazes a horizontal card, so the sky weighs more than at 20°
    const low = sceneIlluminant(5, sunColour(5), sky);
    expect(low[2] / low[0]).toBeGreaterThan(sunUp[2] / sunUp[0]);
    const night = sceneIlluminant(-10, sunColour(-10), sky);
    expect(night[2]).toBeGreaterThan(night[0]);
  });

  it('env sky saturation: 0.4 at high sun, more at the golden hour and in twilight', () => {
    expect(envSkySat(60)).toBeCloseTo(0.4, 9);
    expect(envSkySat(6)).toBeGreaterThan(0.6);
    expect(envSkySat(-8)).toBeGreaterThanOrEqual(0.85);
    for (const e of [-20, -6, 0, 8, 30, 60]) {
      expect(envSkySat(e)).toBeGreaterThan(0);
      expect(envSkySat(e)).toBeLessThanOrEqual(1);
    }
  });

  it('visible sky whitens toward the horizon only', () => {
    expect(visibleSkySat(0)).toBeCloseTo(0.35, 9);
    expect(visibleSkySat(1)).toBeCloseTo(1, 9);
    expect(visibleSkySat(-0.5)).toBeCloseTo(0.35, 9);
    expect(visibleSkySat(0.2)).toBeGreaterThan(visibleSkySat(0.05));
  });

  it('sky view EV: +0.9 by day, +1.6 at sunset, most lift at the hero hours, none below −2°', () => {
    expect(skyViewEv(60)).toBeCloseTo(0.9, 9);
    expect(skyViewEv(56)).toBeCloseTo(0.9, 9); // 10:30 (poses 01–05) unchanged
    expect(skyViewEv(0)).toBeCloseTo(1.6, 9);
    expect(skyViewEv(-5)).toBeCloseTo(0.9, 9);
    // wave-2 review: the 17:30 / 07:00 zenith (22–25°) is lifted most, so it no longer reads navy
    expect(skyViewEv(22)).toBeGreaterThan(skyViewEv(8));
    expect(skyViewEv(22)).toBeGreaterThan(skyViewEv(40));
    // wave-2 fix: the open low-sun key already brightens the sky; the visible sky on screen stays where it was
    // (display gain = sky view EV − key + log2 of the sky lux change, within ±0.1 EV of the wave-2 table at 8° and 22°)
    expect(Math.abs(skyViewEv(22) - keyStops(22) - (2.35 - 0.15) + Math.log2(19500 / 17500))).toBeLessThan(0.12);
    expect(Math.abs(skyViewEv(8) - keyStops(8) - (1.62 - 0.05) + Math.log2(skyIlluminance(8) / 7230))).toBeLessThan(0.15);
  });

  it('visible sky saturation: softer at the hero hours, unchanged at high sun', () => {
    expect(viewSkySat(56)).toBeCloseTo(VIEW_SKY_SAT, 9);
    expect(viewSkySat(-4)).toBeCloseTo(VIEW_SKY_SAT, 9);
    expect(viewSkySat(22)).toBeLessThan(0.7);
    expect(viewSkySat(22)).toBeGreaterThan(0.5);
  });

  it('hero hours read warm: sun ≤ 4300 K and adaptation ≤ 0.27 at 20–25°, a lower key, high sun unchanged', () => {
    for (const e of [20, 22, 25]) {
      expect(sunKelvin(e)).toBeLessThanOrEqual(4300);
      expect(sunKelvin(e)).toBeGreaterThan(3900);
      expect(adaptationDegree(e)).toBeLessThanOrEqual(0.27);
    }
    expect(adaptationDegree(56)).toBeGreaterThan(0.8);
    expect(sunKelvin(56)).toBeGreaterThan(5500);
    // wave-2 fix: with the flatter image-based sky the sunlit walls lost ≈ 0.4 EV; the key opens up instead
    expect(keyStops(22)).toBeLessThan(0);
    expect(keyStops(22)).toBeGreaterThan(-0.4);
    // the EV still (nearly) rises with the sun: the façade meter itself dips by < 0.05 EV around 35°
    for (let e = 10; e < 70; e++) expect(evOutdoor(e + 1)).toBeGreaterThan(evOutdoor(e) - 0.05);
    expect(keyStops(56)).toBe(0);
    const c = sunColour(22);
    expect(c[0] / c[2]).toBeGreaterThan(1.6);
  });

  it('indoor day exposure: little headroom, so the shaded boiserie reads light', () => {
    expect(INDOOR_DAY_HEADROOM_EV).toBeGreaterThanOrEqual(0);
    expect(INDOOR_DAY_HEADROOM_EV).toBeLessThan(0.5);
    expect(evIndoor(56)).toBeCloseTo(evFromLux(roomIlluminance(56)) + INDOOR_DAY_HEADROOM_EV, 1);
  });
});

describe('low-sun shade (wave-2 review fix)', () => {
  it('CIE daylight locus: D65 at 6504 K maps to sRGB white; 12 000 K is blue with green between red and blue', () => {
    const [x, y] = daylightXy(6504);
    expect(x).toBeCloseTo(0.3127, 3);
    expect(y).toBeCloseTo(0.329, 3);
    const w = xyToLinear(x, y);
    for (const c of w) expect(c).toBeCloseTo(1, 1);
    const c = xyToLinear(...daylightXy(12000));
    expect(c[2]).toBeGreaterThan(c[1]);
    expect(c[1]).toBeGreaterThan(c[0]);
  });

  it('skylight colour: luminance 1, cool, bluer at low sun, green trimmed below the locus', () => {
    for (const e of [2, 10, 22, 56]) expect(luminance(skylightColour(e))).toBeCloseTo(1, 6);
    const low = skylightColour(8);
    const high = skylightColour(56);
    expect(low[2] / low[0]).toBeGreaterThan(high[2] / high[0]);
    expect(skyKelvin(8)).toBeGreaterThan(skyKelvin(56));
    expect(skyKelvin(56)).toBeGreaterThanOrEqual(10000);
    expect(SKY_GREEN_TRIM).toBeGreaterThan(0.9);
    expect(SKY_GREEN_TRIM).toBeLessThanOrEqual(1);
    // a warm sand (#C9B48E, linear ≈ 0.58 / 0.46 / 0.27) in pure skylight shade must not turn green (olive)
    const sand = [0.584, 0.456, 0.27];
    const shade = sand.map((a, i) => a * skylightColour(22)[i]);
    expect(shade[1]).toBeLessThanOrEqual(Math.max(shade[0], shade[2]) * 1.02);
  });

  it('isotropic share of the env sky: none in twilight, most at the hero hours, less at high sun', () => {
    expect(envSkyIso(-6)).toBe(0);
    expect(envSkyIso(22)).toBeGreaterThanOrEqual(0.7);
    expect(envSkyIso(6)).toBeLessThan(envSkyIso(22));
    expect(envSkyIso(56)).toBeLessThan(envSkyIso(22));
    for (const e of [-10, 0, 5, 30, 60, 90]) {
      expect(envSkyIso(e)).toBeGreaterThanOrEqual(0);
      expect(envSkyIso(e)).toBeLessThanOrEqual(1);
    }
    expect(skylightWeight(-6)).toBe(0);
    expect(skylightWeight(6)).toBe(1);
  });

  it('a hazy July sun: extinction ≥ 0.21, sun:sky still 3–8 at high sun and ≤ 4 at the hero hours', () => {
    expect(SUN_EXTINCTION).toBeGreaterThanOrEqual(0.21);
    expect(SUN_EXTINCTION).toBeLessThanOrEqual(0.3);
    expect(sunSkyRatio(56)).toBeGreaterThan(3);
    expect(sunSkyRatio(56)).toBeLessThan(8);
    expect(sunSkyRatio(22)).toBeLessThan(4);
    expect(skyIlluminance(22)).toBeLessThanOrEqual(25000); // Wikipedia: daylight without direct sun 10–25 klx
  });
});

describe('KB-I74 low-sun warmth and sky fill (wave-8 review)', () => {
  it('the low sun is 3000-3500 K at 5-10°, the hero hours and the day unchanged', () => {
    for (const e of [5, 6, 8, 10]) {
      expect(sunKelvin(e)).toBeGreaterThanOrEqual(3000);
      expect(sunKelvin(e)).toBeLessThanOrEqual(3500);
    }
    expect(sunKelvin(20)).toBe(4000);
    expect(sunKelvin(25)).toBe(4200);
    for (let e = 0; e < 60; e++) expect(sunKelvin(e + 1)).toBeGreaterThanOrEqual(sunKelvin(e));
  });

  it('sky fill: less at the golden hour, full from 20° up and in twilight', () => {
    for (const e of [4, 6, 8, 10]) expect(lowSunSkyFill(e)).toBeLessThanOrEqual(0.75);
    for (const e of [20, 22, 30, 56, 90, -1, -6, -18]) expect(lowSunSkyFill(e)).toBe(1);
    for (let e = -10; e < 40; e++) {
      expect(lowSunSkyFill(e)).toBeGreaterThan(0.5);
      expect(lowSunSkyFill(e)).toBeLessThanOrEqual(1);
    }
  });

  it('warm haze toward the sun only at low sun', () => {
    expect(lowSunHazeWarm(6)).toBeCloseTo(LOW_SUN_HAZE_WARM, 6);
    for (const e of [20, 30, 56, -2, -6]) expect(lowSunHazeWarm(e)).toBe(0);
    for (let e = -5; e < 30; e++) expect(lowSunHazeWarm(e)).toBeLessThanOrEqual(LOW_SUN_HAZE_WARM);
  });

  it('golden-hour shade on court sand is lilac-grey (G not above R and B), the sunlit sand warm; 22° unchanged', () => {
    expect(skyGreenTrim(22)).toBe(SKY_GREEN_TRIM);
    expect(skyGreenTrim(56)).toBe(SKY_GREEN_TRIM);
    const sand = [0.584, 0.456, 0.27];
    for (const e of [5, 6, 8]) {
      const sky = skylightColour(e);
      const g = whiteBalance(sceneIlluminant(e, sunColour(e), sky), adaptationDegree(e));
      const shade = sand.map((a, i) => a * sky[i] * g[i]);
      // green never leads: at most level with red, below blue (no grey-green "wet concrete")
      expect(shade[1]).toBeLessThanOrEqual(Math.min(shade[0], shade[2]) * 1.005);
      expect(shade[1]).toBeLessThan(shade[2]);
      const sinE = Math.sin((e * Math.PI) / 180);
      const lit = sand.map((a, i) => a * (sky[i] * skyIlluminance(e) * lowSunSkyFill(e) + sunColour(e)[i] * sunIlluminance(e) * sinE) * g[i]);
      // the grazing sun visibly warms the lit sand against its shade
      expect(lit[0] / lit[2]).toBeGreaterThan((shade[0] / shade[2]) * 1.15);
    }
  });
});
