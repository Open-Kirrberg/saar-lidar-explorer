import { describe, expect, it } from 'vitest';
import { AO_BRIGHT_FADE_GLSL, FLOOR_ROWS, INDOOR_SHOULDER_GLSL, INDOOR_TONE_NIGHT, aoBrightFade, INDOOR_TONE, PARQUET_BOUNCE, WINDOW_PULL_MAX_EV, WINDOW_VIEW_EV, indoorShoulder, indoorShoulderRgb, indoorToneParams, warmRoomGrid, windowTransmittance } from '../src/interiorGrade.ts';

const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('KB-I75 window pull', () => {
  it('is 1 when the view is not brighter than the allowed step (night, dusk)', () => {
    expect(windowTransmittance(-3)).toBe(1);
    expect(windowTransmittance(0)).toBe(1);
    expect(windowTransmittance(WINDOW_VIEW_EV)).toBe(1);
  });
  it('dims the view to WINDOW_VIEW_EV above the room, at most WINDOW_PULL_MAX_EV', () => {
    expect(windowTransmittance(WINDOW_VIEW_EV + 2)).toBeCloseTo(0.25, 10);
    expect(windowTransmittance(20)).toBeCloseTo(Math.pow(2, -WINDOW_PULL_MAX_EV), 10);
    let prev = 1;
    for (let g = 0; g <= 10; g += 0.25) {
      const t = windowTransmittance(g);
      expect(t).toBeLessThanOrEqual(prev);
      expect(t).toBeGreaterThan(0);
      prev = t;
    }
  });
});

describe('KB-I75 indoor highlight shoulder', () => {
  it('is the identity up to the knee', () => {
    for (const x of [0, 0.1, 0.3, INDOOR_TONE.knee]) expect(indoorShoulder(x)).toBe(x);
  });
  it('is continuous with slope 1 at the knee, monotonic and compressive above', () => {
    const k = INDOOR_TONE.knee;
    const e = 1e-5;
    expect((indoorShoulder(k + e) - indoorShoulder(k)) / e).toBeCloseTo(1, 3);
    let prev = indoorShoulder(k);
    for (let x = k + 0.05; x < 40; x *= 1.2) {
      const y = indoorShoulder(x);
      expect(y).toBeGreaterThan(prev);
      expect(y).toBeLessThan(x);
      prev = y;
    }
  });
  it('keeps a sky-lit reveal and a sun pool short of white but apart (KB-I92: reveals ≤ ≈ 0.9 display)', () => {
    const reveal = indoorShoulder(3);
    const pool = indoorShoulder(20);
    // Khronos PBR Neutral keeps values below 0.76 and compresses above; 0.8 → 0.794 linear ≈ 0.90 sRGB
    const neutral = (x: number) => (x <= 0.76 ? x : 1 - 0.0576 / (x + 0.24 - 0.76));
    const srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    for (const x of [2.2, 3, 4]) expect(srgb(neutral(indoorShoulder(x)))).toBeLessThan(0.906);
    expect(reveal).toBeGreaterThan(0.7);
    expect(pool).toBeGreaterThan(reveal + 0.03);
    expect(pool).toBeLessThan(0.9);
  });
  it('KB-I92: unchanged below the second knee (walls, floors, gilt)', () => {
    const k = INDOOR_TONE.knee;
    const s = INDOOR_TONE.s;
    for (const x of [0.6, 0.7, 0.8]) expect(indoorShoulder(x)).toBeCloseTo(k + s * Math.log(1 + (x - k) / s), 12);
    const e = 1e-6;
    const x2 = k + s * (Math.exp((INDOOR_TONE.knee2 - k) / s) - 1);
    // continuous slope at the second knee
    const d1 = (indoorShoulder(x2) - indoorShoulder(x2 - e)) / e;
    const d2 = (indoorShoulder(x2 + e) - indoorShoulder(x2)) / e;
    expect(d2 / d1).toBeCloseTo(1, 3);
  });
  it('KB-I92: AO keeps more strength on sky-lit reveals indoors only', () => {
    for (const l of [0.2, 0.6, 1.0, 20]) expect(aoBrightFade(l, 1)).toBeCloseTo(aoBrightFade(l, 0), 12);
    expect(aoBrightFade(3, 1)).toBeLessThan(0.65 * 0.5);
    expect(aoBrightFade(3, 0)).toBeCloseTo(0.65, 12);
    expect(AO_BRIGHT_FADE_GLSL).toContain('smoothstep( 1.1, 2.0, l )');
  });
  it('the GLSL twin uses the same formula and has no flat varyings', () => {
    expect(INDOOR_SHOULDER_GLSL).toContain('log( 1.0 + ( l - tone.x ) / tone.y )');
    expect(INDOOR_SHOULDER_GLSL).not.toMatch(/\bflat\b/);
  });
});

describe('wave-11 review fix: the shoulder by candle light (pose 07)', () => {
  const neutral = (x: number) => (x <= 0.76 ? x : 1 - 0.0576 / (x + 0.24 - 0.76));
  const srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  it('by day the KB-I75 / KB-I92 curve on luminance is unchanged', () => {
    const t = indoorToneParams(0);
    expect(t).toEqual({ knee: INDOOR_TONE.knee, s: INDOOR_TONE.s, knee2: INDOOR_TONE.knee2, s2: INDOOR_TONE.s2, peak: 0 });
    const c: [number, number, number] = [3, 2.5, 2];
    const l = lum(c);
    const out = indoorShoulderRgb(c, t);
    expect(lum(out)).toBeCloseTo(indoorShoulder(l), 10);
  });
  it('at night it measures the largest channel: the lit marble top keeps its falloff below 0.87 display, flames stay white', () => {
    const t = indoorToneParams(1);
    expect(t.knee).toBe(INDOOR_TONE_NIGHT.knee);
    expect(t.peak).toBe(1);
    // exposed linear RGB read at pose 07 (wave 11): marble top centre and rim, a flame
    const centre: [number, number, number] = [1.807, 1.183, 0.521];
    const rim: [number, number, number] = [1.035, 0.68, 0.303];
    const flame: [number, number, number] = [2180, 1360, 470];
    const show = (c: [number, number, number]) => srgb(neutral(Math.max(...indoorShoulderRgb(c, t))));
    const before = (c: [number, number, number]) => srgb(neutral(Math.max(...c)));
    expect(show(centre)).toBeLessThan(0.87);
    expect(show(centre) / show(rim)).toBeGreaterThan(1.05);
    // Neutral alone pressed the red of the top into its shoulder (ratio ≈ 1.03)
    expect(before(centre) / before(rim)).toBeLessThan(1.04);
    expect(show(flame)).toBeGreaterThan(0.97);
    // hue kept: channel ratios unchanged
    const o = indoorShoulderRgb(centre, t);
    expect(o[1] / o[0]).toBeCloseTo(centre[1] / centre[0], 10);
    // dark walls (exposed red 0.12) untouched
    expect(indoorShoulderRgb([0.12, 0.085, 0.044], t)).toEqual([0.12, 0.085, 0.044]);
  });
  it('blends continuously from day to night and the GLSL takes the measure from tone2.z', () => {
    let prev = indoorToneParams(0);
    for (let n = 0.05; n <= 1.0001; n += 0.05) {
      const t = indoorToneParams(n);
      expect(Math.abs(t.s - prev.s)).toBeLessThan(0.01);
      expect(t.knee2).toBeGreaterThan(prev.knee2);
      prev = t;
    }
    expect(INDOOR_SHOULDER_GLSL).toContain('max( max( c.r, c.g ), c.b ), tone2.z )');
    expect(INDOOR_SHOULDER_GLSL).toContain('vec3 tone2');
  });
});

describe('KB-I75 parquet bounce', () => {
  it('has luminance 1 and is warm (oak: R > G > B)', () => {
    expect(lum(PARQUET_BOUNCE)).toBeCloseTo(1, 6);
    expect(PARQUET_BOUNCE[0]).toBeGreaterThan(PARQUET_BOUNCE[1]);
    expect(PARQUET_BOUNCE[1]).toBeGreaterThan(PARQUET_BOUNCE[2]);
  });
  it('warms only the floor rows and keeps every texel luminance', () => {
    const w = 4;
    const h = 8;
    const rgb = new Float32Array(w * h * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = 0.2 + ((i * 37) % 11) / 10;
    const out = warmRoomGrid(w, h, rgb);
    let sum = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 3;
        const a = [rgb[o], rgb[o + 1], rgb[o + 2]];
        const b = [out.rgb[o], out.rgb[o + 1], out.rgb[o + 2]];
        expect(lum(b)).toBeCloseTo(lum(a), 5);
        if (!FLOOR_ROWS.includes(y)) expect(b).toEqual(a);
        else expect(b[0] / b[2]).toBeCloseTo(PARQUET_BOUNCE[0] / PARQUET_BOUNCE[2], 5);
        sum += lum(a);
      }
    expect(out.meanLuminance).toBeCloseTo(sum / (w * h), 5);
    expect(out.rgb).not.toBe(rgb);
  });
});
