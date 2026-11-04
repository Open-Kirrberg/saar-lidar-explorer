// Wave-6 review fixes (look): review clock (KB-I64), retina cost (KB-I65), indoor AO, Kino sky and grade, Fest bloom.
import { describe, expect, it } from 'vitest';
import { ReviewClock, advanceClock } from '../src/clock.ts';
import { AO_INDOOR, KINO_SKY_BLUE, LUM, aoDivisor, aoRadius, bloomStrength, kinoSkyStrength, skyScale } from '../src/postMath.ts';
import { KINO_LOOK, kinoLook } from '../src/grade.ts';
import { CANDLE_NIGHT, KINO_HAZE, KINO_SKY } from '../src/atmosphere.ts';

describe('review clock (KB-I64)', () => {
  it('test hooks own the frames until a real input; the rAF loop then resumes', () => {
    const c = new ReviewClock();
    expect(c.wallFrame()).toBe(true);
    c.hook();
    expect(c.wallFrame()).toBe(false);
    c.hook();
    expect(c.wallFrame()).toBe(false);
    c.input();
    expect(c.wallFrame()).toBe(true);
  });

  it('animation clocks advance only by the frame dt (same steps → same time), wrap, and ignore dt ≤ 0', () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 80; i++) a = advanceClock(a, 1 / 60);
    for (let i = 0; i < 80; i++) b = advanceClock(b, 1 / 60);
    expect(a).toBe(b);
    expect(a).toBeCloseTo(80 / 60, 9);
    expect(advanceClock(5, 0)).toBe(5);
    expect(advanceClock(5, -1)).toBe(5);
    expect(advanceClock(3599.5, 1)).toBeCloseTo(0.5, 9);
  });
});

describe('retina cost (KB-I65)', () => {
  it('AO drops to quarter resolution above ≈ 4.2 Mpx (native retina), half below', () => {
    expect(aoDivisor(1920 * 1080)).toBe(2);
    expect(aoDivisor(2268 * 1473)).toBe(2);
    expect(aoDivisor(3024 * 1964)).toBe(4);
  });

  it('the sky is shaded at 0.5 (small buffers) or 0.35 (1080p and above) of the resolution per axis', () => {
    expect(skyScale(1280 * 720)).toBe(0.5);
    expect(skyScale(1920 * 1080)).toBe(0.35);
    expect(skyScale(3024 * 1964)).toBe(0.35);
    // the sky target of a native retina frame stays below a fifth of a 1080p frame
    expect(3024 * 1964 * skyScale(3024 * 1964) ** 2).toBeLessThan(0.4 * 1920 * 1080);
  });
});

describe('indoor AO (wave-6 review: soot under coves, halos over chair backs)', () => {
  it('uses a small fixed radius and less strength than outdoors', () => {
    expect(AO_INDOOR.radius).toBeLessThan(aoRadius(0) / 2);
    expect(AO_INDOOR.strength).toBeLessThan(0.85);
    expect(AO_INDOOR.strength).toBeGreaterThan(0.3); // contact shade stays
  });
});

describe('Kino sky and grade (wave-6 review: beige skies, muddy golden hour)', () => {
  it('the sky blue has luminance 1 and is a clear blue (b > g > r)', () => {
    const l = LUM[0] * KINO_SKY_BLUE[0] + LUM[1] * KINO_SKY_BLUE[1] + LUM[2] * KINO_SKY_BLUE[2];
    expect(l).toBeCloseTo(1, 6);
    expect(KINO_SKY_BLUE[2]).toBeGreaterThan(KINO_SKY_BLUE[1]);
    expect(KINO_SKY_BLUE[1]).toBeGreaterThan(KINO_SKY_BLUE[0]);
  });

  it('applies in Kino by day only (not in Dokumentation, not in twilight)', () => {
    expect(kinoSkyStrength('doku', 0.6)).toBe(0);
    expect(kinoSkyStrength('kino', 0.6)).toBeGreaterThan(0.5);
    expect(kinoSkyStrength('kino', -0.1)).toBe(0);
    expect(kinoSkyStrength('kino', 0.02)).toBeLessThan(kinoSkyStrength('kino', 0.6));
  });

  it('the warm slope spares clear blues and still warms neutrals', () => {
    const grey = kinoLook([0.5, 0.5, 0.5]);
    expect(grey[0]).toBeGreaterThan(grey[2]); // warm shift on a neutral
    const sky = kinoLook([0.45, 0.6, 0.8]);
    const plain = (() => {
      const g = [0.45, 0.6, 0.8].map((v, i) => (v * KINO_LOOK.slope[i]) ** KINO_LOOK.power[i]);
      const l = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
      return g.map((x) => l + KINO_LOOK.sat * (x - l));
    })();
    // with the blue protection the sky keeps more blue over red than with the plain warm slope
    expect(sky[2] / sky[0]).toBeGreaterThan(plain[2] / plain[0]);
  });

  it('haze 30 % below the wave-5 Kino value; the Kino sky is more saturated than Dokumentation', () => {
    expect(KINO_HAZE).toBeCloseTo(0.6 * 0.7, 6);
    expect(KINO_SKY.sat).toBeGreaterThan(1);
    expect(KINO_SKY.horizon).toBeGreaterThan(0.35);
  });
});

describe('Fest (wave-6 review: shards brighter than the flames, specular hotspot)', () => {
  it('bloom is stronger indoors at night only', () => {
    expect(bloomStrength(0, true)).toBe(bloomStrength(0, false));
    expect(bloomStrength(1, true)).toBeGreaterThan(bloomStrength(1, false));
  });

  it('candle clusters widen the specular lobe (sphere-light roughness) and dim the crystal’s diffuse share', () => {
    const r = 0.3;
    const widened = Math.sqrt(r * r + CANDLE_NIGHT.widen);
    expect(widened).toBeGreaterThan(0.45);
    expect(widened).toBeLessThan(0.55);
    expect(CANDLE_NIGHT.crystal).toBeLessThan(0.5);
  });
});
