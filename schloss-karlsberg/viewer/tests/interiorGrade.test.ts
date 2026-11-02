import { describe, expect, it } from 'vitest';
import { FLOOR_ROWS, INDOOR_SHOULDER_GLSL, INDOOR_TONE, PARQUET_BOUNCE, WINDOW_PULL_MAX_EV, WINDOW_VIEW_EV, indoorShoulder, warmRoomGrid, windowTransmittance } from '../src/interiorGrade.ts';

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
  it('keeps a sky-lit reveal and a sun pool short of white but apart', () => {
    const reveal = indoorShoulder(3);
    const pool = indoorShoulder(20);
    expect(reveal).toBeGreaterThan(0.8);
    expect(pool).toBeGreaterThan(reveal + 0.15);
    expect(pool).toBeLessThan(1.25);
  });
  it('the GLSL twin uses the same formula and has no flat varyings', () => {
    expect(INDOOR_SHOULDER_GLSL).toContain('log( 1.0 + ( l - tone.x ) / tone.y )');
    expect(INDOOR_SHOULDER_GLSL).not.toMatch(/\bflat\b/);
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
