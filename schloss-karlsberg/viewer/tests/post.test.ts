import { describe, expect, it } from 'vitest';
import {
  LANTERN_CD,
  LANTERN_REACH,
  SSR_GROWTH,
  SSR_STEPS,
  SSR_T0,
  aoDistanceFade,
  aoLightWeight,
  aoRadius,
  bloomStrength,
  bloomThreshold,
  lanternIlluminance,
  marchReach,
  sceneMsaa,
  vignetteFor,
  waterFresnel,
} from '../src/postMath.ts';
import { QUALITY } from '../src/quality.ts';
import { kinoLowSun } from '../src/light.ts';

describe('post chain parameters (KB-I41)', () => {
  it('AO radius grows with distance and stays within 0.9…6 m', () => {
    expect(aoRadius(0)).toBeCloseTo(0.9, 6);
    expect(aoRadius(-5)).toBeCloseTo(0.9, 6);
    expect(aoRadius(300)).toBeCloseTo(4.5, 6);
    expect(aoRadius(5000)).toBe(6);
    for (let d = 0; d < 1000; d += 25) expect(aoRadius(d + 25)).toBeGreaterThanOrEqual(aoRadius(d));
  });

  it('AO fades out with distance and acts less on sunlit pixels', () => {
    expect(aoDistanceFade(500)).toBe(1);
    expect(aoDistanceFade(2000)).toBe(0);
    expect(aoLightWeight(0.1)).toBe(1);
    expect(aoLightWeight(2)).toBeCloseTo(0.35, 6);
    expect(aoLightWeight(0.8)).toBeLessThan(1);
  });

  it('bloom: high threshold by day, below the lit windows at night, restrained strength', () => {
    expect(bloomThreshold(0)).toBeGreaterThan(2);
    expect(bloomThreshold(1)).toBeLessThan(1.35); // lit windows (nightlights.ts) bloom at night
    for (let n = 0; n < 1; n += 0.1) expect(bloomThreshold(n + 0.1)).toBeLessThanOrEqual(bloomThreshold(n));
    expect(bloomThreshold(-1)).toBe(bloomThreshold(0));
    expect(bloomThreshold(2)).toBe(bloomThreshold(1));
    expect(bloomStrength(0)).toBeLessThanOrEqual(0.05);
    expect(bloomStrength(1)).toBeLessThanOrEqual(0.15);
  });

  it('lantern light follows the inverse square law, faces the lamp and ends at its reach', () => {
    expect(LANTERN_CD).toBeGreaterThan(0.5);
    expect(LANTERN_CD).toBeLessThan(5); // a candle lantern, not an electric lamp
    const e1 = lanternIlluminance(LANTERN_CD, 1, 1);
    const e2 = lanternIlluminance(LANTERN_CD, 2, 1);
    expect(e1 / e2).toBeCloseTo((4 + 0.04) / (1 + 0.04), 6);
    expect(lanternIlluminance(LANTERN_CD, 2, 0.5)).toBeCloseTo(e2 / 2, 9);
    expect(lanternIlluminance(LANTERN_CD, 2, -0.3)).toBe(0);
    expect(lanternIlluminance(LANTERN_CD, LANTERN_REACH, 1)).toBe(0);
    expect(lanternIlluminance(LANTERN_CD, LANTERN_REACH + 1, 1)).toBe(0);
    // a pool against moonlight (≈ 0.1 lx) up to a few metres
    expect(lanternIlluminance(LANTERN_CD, 3, 1)).toBeGreaterThan(0.1);
  });

  it('water: Schlick Fresnel of n = 1.33 and a march that crosses the Herzogsgarten', () => {
    expect(waterFresnel(1)).toBeCloseTo(0.02, 6);
    expect(waterFresnel(0)).toBeCloseTo(1, 6);
    for (let i = 0; i < 10; i++) expect(waterFresnel((i + 1) / 10)).toBeLessThan(waterFresnel(i / 10));
    expect(marchReach(SSR_T0, SSR_GROWTH, SSR_STEPS)).toBeGreaterThanOrEqual(250);
    expect(SSR_T0).toBeLessThan(0.5); // the first step still resolves the basin's coping
  });

  it('scene MSAA steps down on large drawing buffers', () => {
    expect(sceneMsaa(4, 1920 * 1080)).toBe(4);
    expect(sceneMsaa(4, 2268 * 1473)).toBe(2);
    expect(sceneMsaa(4, 3024 * 1964)).toBe(0);
    expect(sceneMsaa(0, 1280 * 720)).toBe(0);
    expect(sceneMsaa(2, 1920 * 1080)).toBe(2);
  });

  it('vignette only in Kino', () => {
    expect(vignetteFor('doku')).toBe(0);
    expect(vignetteFor('kino')).toBeGreaterThan(0);
    expect(vignetteFor('kino')).toBeLessThan(0.4);
  });

  it('presets: Mobil without AO, bloom and SSR; Hoch has every pass and MSAA', () => {
    expect(QUALITY.mobil.post.ao).toBe(false);
    expect(QUALITY.mobil.post.bloom).toBe(false);
    expect(QUALITY.mobil.post.ssr).toBe(false);
    expect(QUALITY.hoch.post).toMatchObject({ ao: true, bloom: true, ssr: true, msaa: 4 });
    expect(QUALITY.mittel.post.aoSamples).toBeLessThanOrEqual(QUALITY.hoch.post.aoSamples);
  });
});

describe('Kino low-sun grade (wave-5 review, Goldene Stunde)', () => {
  it('applies fully at the golden hour and not at high sun or in twilight', () => {
    expect(kinoLowSun(10).w).toBeCloseTo(1, 6); // 18:45 on 15 Jul 1789
    expect(kinoLowSun(30).w).toBe(0);
    expect(kinoLowSun(56).w).toBe(0);
    expect(kinoLowSun(-3).w).toBe(0);
    const g = kinoLowSun(10);
    expect(g.adapt).toBeLessThan(1); // warmer key
    expect(g.fill).toBeLessThan(1); // deeper shade
    expect(g.skySat).toBeGreaterThan(1); // less milky sky
    expect(g.haze).toBeLessThan(1);
    expect(kinoLowSun(40)).toMatchObject({ w: 0, adapt: 1, fill: 1, skySat: 1, haze: 1 });
  });

  it('is continuous over elevation', () => {
    for (let e = -5; e < 40; e += 0.25) expect(Math.abs(kinoLowSun(e + 0.25).w - kinoLowSun(e).w)).toBeLessThan(0.1);
  });
});
