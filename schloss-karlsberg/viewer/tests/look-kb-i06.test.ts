import { describe, expect, it } from 'vitest';
import { KINO_GOLDEN_EV, KINO_LOW_EV, kinoLowSun } from '../src/light.ts';
import { KINO_GOLDEN_LOOK, KINO_LOOK, gradeData, kinoLook, kinoLookAt, setKinoLook } from '../src/grade.ts';
import { KINO_SKY_GOLD, KINO_SKY_GOLD_MAX, LUM, kinoSkyGold } from '../src/postMath.ts';

const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);

describe('Kino golden hour (wave-7 KB-I06)', () => {
  it('the golden grade weight is full at the golden hour, half by day, none in twilight', () => {
    expect(kinoLowSun(10).g).toBeCloseTo(1, 6);
    expect(kinoLowSun(40).g).toBeCloseTo(0.5, 6); // 'Galerie' 08:30, sun ≈ 40°
    expect(kinoLowSun(60).g).toBeCloseTo(0.5, 6);
    expect(kinoLowSun(-3).g).toBe(0);
    for (let e = -5; e < 60; e += 0.25) expect(Math.abs(kinoLowSun(e + 0.25).g - kinoLowSun(e).g)).toBeLessThan(0.1);
  });

  it('exposure lift: KINO_GOLDEN_EV at the golden hour, a part of KINO_LOW_EV by day, none in twilight', () => {
    expect(kinoLowSun(10).ev).toBeCloseTo(KINO_GOLDEN_EV, 6);
    expect(kinoLowSun(40).ev).toBeCloseTo(KINO_LOW_EV * 0.5, 6);
    expect(kinoLowSun(-3).ev).toBe(0);
    expect(KINO_GOLDEN_EV).toBeLessThanOrEqual(0.5);
  });

  it('kinoLookAt blends the Kino look toward the golden look: lighter midtones, more saturation, a smaller warm slope', () => {
    expect(kinoLookAt(0)).toEqual(KINO_LOOK);
    const g = kinoLookAt(1);
    expect(g.sat).toBeCloseTo(KINO_GOLDEN_LOOK.sat, 9);
    expect(g.power[1]).toBeLessThan(KINO_LOOK.power[1]);
    expect(g.slope[0] - g.slope[2]).toBeLessThan(KINO_LOOK.slope[0] - KINO_LOOK.slope[2]);
    // a sunlit olive meadow (AgX display values) comes out lighter and greener-gold than with the plain Kino look
    const meadow: [number, number, number] = [0.42, 0.38, 0.2];
    const a = kinoLook(meadow);
    const b = kinoLook(meadow, g);
    const lum = (v: number[]) => LUM[0] * v[0] + LUM[1] * v[1] + LUM[2] * v[2];
    expect(lum(b)).toBeGreaterThan(lum(a));
    expect(b[1] / b[0]).toBeGreaterThan(a[1] / a[0]);
    setKinoLook(true, g);
    expect(gradeData[11]).toBeCloseTo(KINO_GOLDEN_LOOK.sat, 6);
    setKinoLook(false);
  });

  it('golden sky glow: a warm gold at luminance 1, only in Kino at the golden hour', () => {
    const l = LUM[0] * KINO_SKY_GOLD[0] + LUM[1] * KINO_SKY_GOLD[1] + LUM[2] * KINO_SKY_GOLD[2];
    expect(l).toBeCloseTo(1, 6);
    expect(KINO_SKY_GOLD[0]).toBeGreaterThan(KINO_SKY_GOLD[1]);
    expect(KINO_SKY_GOLD[1]).toBeGreaterThan(KINO_SKY_GOLD[2]);
    expect(kinoSkyGold('doku', sinDeg(10))).toBe(0);
    expect(kinoSkyGold('kino', sinDeg(10))).toBeCloseTo(KINO_SKY_GOLD_MAX, 6);
    expect(kinoSkyGold('kino', sinDeg(40))).toBe(0);
    expect(kinoSkyGold('kino', sinDeg(-4))).toBe(0);
  });
});
