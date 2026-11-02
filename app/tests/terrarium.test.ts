import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { decodeTerrarium, decodeTerrariumPixel, encodeTerrarium, encodeTerrariumRGBA } from '../src/data/terrarium';

describe('Terrarium encoding', () => {
  it('round-trips heights within half a quantisation step (≈2 mm)', () => {
    let maxErr = 0;
    for (let k = 0; k < 20000; k++) {
      const h = 150 + Math.random() * 400 + (k % 7) * 1e-4;
      const [r, g, b] = encodeTerrarium(h);
      maxErr = Math.max(maxErr, Math.abs(decodeTerrariumPixel(r, g, b) - h));
    }
    expect(maxErr).toBeLessThanOrEqual(1 / 512 + 1e-9);
  });

  it('handles carries and negative heights', () => {
    for (const h of [0, -0.001, -12.5, 255.999, 256, 383.0039, 1000.5]) {
      const [r, g, b] = encodeTerrarium(h);
      expect(Math.abs(decodeTerrariumPixel(r, g, b) - h)).toBeLessThanOrEqual(1 / 512);
    }
  });

  it('preserves cm-scale relief (no terracing)', () => {
    // 0.4 m wall on a 300 m plateau, 1 cm steps must stay distinguishable.
    const hs = Array.from({ length: 41 }, (_, k) => 300 + k * 0.01);
    const dec = decodeTerrarium(encodeTerrariumRGBA(hs), hs.length, 4);
    const steps = new Set(Array.from(dec, (v) => v.toFixed(2)));
    expect(steps.size).toBe(41);
  });

  it('decodes RGBA and RGB buffers identically (Float32 precision)', () => {
    const hs = [231.4, 402.9, 300.123, 299.877];
    const rgba = encodeTerrariumRGBA(hs);
    const rgb = new Uint8Array(hs.length * 3);
    for (let k = 0; k < hs.length; k++) rgb.set(rgba.subarray(k * 4, k * 4 + 3), k * 3);
    const a = decodeTerrarium(rgba, hs.length, 4);
    const b = decodeTerrarium(rgb, hs.length, 3);
    expect(Array.from(a)).toEqual(Array.from(b));
    hs.forEach((h, k) => expect(a[k]).toBeCloseTo(h, 2));
  });

  it('survives a PNG (RGB8) encode/decode round-trip byte-exactly', () => {
    const w = 7;
    const h = 5;
    const heights = Array.from({ length: w * h }, (_, k) => 280 + k * 0.137);
    const rgba = encodeTerrariumRGBA(heights);
    const rgb = Buffer.alloc(w * h * 3);
    for (let k = 0; k < w * h; k++) rgb.set(rgba.subarray(k * 4, k * 4 + 3), k * 3);
    const png = PNG.sync.write({ width: w, height: h, data: rgb } as PNG, { colorType: 2, inputColorType: 2 });
    const back = PNG.sync.read(png); // → RGBA
    const dec = decodeTerrarium(back.data, w * h, 4);
    heights.forEach((v, k) => expect(Math.abs(dec[k] - v)).toBeLessThanOrEqual(1 / 512 + 1e-4));
  });
});
