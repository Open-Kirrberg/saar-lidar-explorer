import { describe, expect, it } from 'vitest';
import { kelvinLinear, kelvinToSrgb, linearToSrgb, whiteBalance } from '../src/light.ts';
import { WINDOW_PEAK_MAX, litShare, portalLanterns, windowCandleColour, windowLevel, windowLight, windowShade } from '../src/nightlights.ts';
import { candleColour } from '../src/atmosphere.ts';

describe('night (KB-I43)', () => {
  it('window candle colour: amber 1850 K, warmer than the room-adapted candle colour', () => {
    const w = windowCandleColour(kelvinLinear, whiteBalance);
    expect(0.2126 * w[0] + 0.7152 * w[1] + 0.0722 * w[2]).toBeCloseTo(1, 2); // ≈ 1 (the 0.03 blue floor adds a trace)
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[1]).toBeGreaterThan(w[2]);
    // display hue at the peak: orange-amber (sRGB green/red 0.55–0.75, blue/red < 0.35), not cream
    const m = Math.max(...w);
    const s = w.map((v) => linearToSrgb(v / m));
    expect(s[1] / s[0]).toBeGreaterThan(0.55);
    expect(s[1] / s[0]).toBeLessThan(0.75);
    expect(s[2] / s[0]).toBeLessThan(0.35);
    const room = candleColour();
    expect(w[0] / w[1]).toBeGreaterThan(room[0] / room[1]);
    // the candle range 1800–1930 K stays amber at the same adaptation
    for (const k of [1800, 1930]) {
      const c = windowCandleColour(kelvinLinear, whiteBalance, k);
      expect(c[0] / c[1]).toBeGreaterThan(2);
      expect(kelvinToSrgb(k)[2]).toBeLessThan(0.05);
    }
  });

  it('window level: the brightest channel never runs into the tone-mapping shoulder', () => {
    const w = windowCandleColour(kelvinLinear, whiteBalance);
    const peak = Math.max(...w);
    for (const pre of [1e-4, 0.01, 0.1, 1, 10]) expect(windowLevel(pre, peak) * peak).toBeLessThanOrEqual(WINDOW_PEAK_MAX + 1e-9);
    expect(windowLevel(1e-4, peak)).toBeCloseTo(6e-4, 9); // dim nights follow the window luminance
  });

  it('windowShade: brightest low in the middle, darker at the head and the reveals', () => {
    expect(windowShade(0.1, 0)).toBe(1);
    expect(windowShade(1, 0)).toBeCloseTo(0.45, 6);
    expect(windowShade(0.1, 1)).toBeCloseTo(0.65, 6);
    let prev = 2;
    for (let v = 0; v <= 1; v += 0.05) {
      const s = windowShade(v, 0.3);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      expect(s).toBeGreaterThan(0.25);
      prev = s;
    }
  });

  it('lit-window share: 10–20 % in the Corps de logis, ≈ 10 % in the wings (U), deterministic', () => {
    expect(litShare('CDL')).toBeGreaterThanOrEqual(0.1);
    expect(litShare('CDL')).toBeLessThanOrEqual(0.2);
    expect(litShare('WING2')).toBeGreaterThanOrEqual(0.08);
    expect(litShare('WING2')).toBeLessThanOrEqual(0.2);
    const a = Array.from({ length: 200 }, (_, i) => windowLight('KB-B03', [i * 2.9, 6, 0], litShare('WING2')));
    const b = Array.from({ length: 200 }, (_, i) => windowLight('KB-B03', [i * 2.9, 6, 0], litShare('WING2')));
    expect(a).toEqual(b);
  });

  it('portal lanterns: a pair beside a door below its head, one above an arch, none on windows', () => {
    const door = { kind: 'portal', a: 20.5, width: 2, bottom_h: 346.2, top_h: 350.6 };
    const pair = portalLanterns(door, 0.5);
    expect(pair).toHaveLength(2);
    expect(pair[0].a).toBeLessThan(door.a - door.width / 2);
    expect(pair[1].a).toBeGreaterThan(door.a + door.width / 2);
    expect(pair[0].a + pair[1].a).toBeCloseTo(2 * door.a, 9); // symmetric about the door axis
    for (const l of pair) {
      expect(l.h).toBeGreaterThan(door.bottom_h + 1.8);
      expect(l.h).toBeLessThan(door.top_h);
      expect(l.out).toBeGreaterThan(0.5); // in front of the risalit plane
    }
    const arch = portalLanterns({ kind: 'durchfahrt', a: 35.9, width: 3.4, bottom_h: 344.8, top_h: 348.8 });
    expect(arch).toHaveLength(1);
    expect(arch[0].a).toBe(35.9);
    expect(arch[0].h).toBeGreaterThan(348.8);
    expect(portalLanterns({ kind: 'window', a: 3, width: 1.2, bottom_h: 347, top_h: 349 })).toEqual([]);
  });
});
