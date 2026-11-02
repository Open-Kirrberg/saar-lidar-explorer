import { describe, expect, it } from 'vitest';
import { clamp, fract, hash12, hashString, smoothstep } from '../src/layout/geom.ts';

// Shared scalar helpers (cleanup pass: the viewer, materials and interiors used local copies of these).
describe('geom scalar helpers', () => {
  it('clamp, smoothstep and fract behave like GLSL', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(10, 20, 12.5)).toBeCloseTo(0.15625, 12);
    expect(fract(2.75)).toBe(0.75);
    expect(fract(-0.25)).toBe(0.75);
  });

  it('hashString equals the inline FNV-1a the viewer used for forest tiles, hinterland and leaf cards', () => {
    const inline = (s: string) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
      return h >>> 0;
    };
    for (const s of ['', 'a', '3:-2', 'KB-B01', 'HL-hedge-17', 'forest/near/12:-4/leaf', 'Ü→ß']) expect(hashString(s)).toBe(inline(s));
  });

  it('hash12 is the Hoskins hash in [0, 1)', () => {
    const ref = (x: number, y: number) => {
      const fr = (v: number) => v - Math.floor(v);
      let p0 = fr(x * 0.1031);
      let p1 = fr(y * 0.1031);
      let p2 = fr(x * 0.1031);
      const dd = p0 * (p1 + 33.33) + p1 * (p2 + 33.33) + p2 * (p0 + 33.33);
      p0 += dd;
      p1 += dd;
      p2 += dd;
      return fr((p0 + p1) * p2);
    };
    for (let i = -20; i < 20; i++) {
      const x = i * 3.7 + 0.31;
      const y = i * -1.9 + 5.2;
      const h = hash12(x, y);
      expect(h).toBe(ref(x, y));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});
