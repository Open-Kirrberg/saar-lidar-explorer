import { describe, expect, it } from 'vitest';
import { PHOTO_DOF, apertureRadius, blurPx, burnInText, photoAperture, halton, lensOffset, ndcX, photoFileName, photoSize, pixelJitter, sampleCount, sceneTime, shiftProjection } from '../src/photoMath.ts';

/** three.js makePerspective elements (column-major) for a symmetric frustum. */
function perspective(fovDeg: number, aspect: number, near = 0.3, far = 12000): number[] {
  const top = near * Math.tan((fovDeg * Math.PI) / 360);
  const right = top * aspect;
  const e = new Array(16).fill(0);
  e[0] = near / right;
  e[5] = near / top;
  e[10] = -(far + near) / (far - near);
  e[11] = -1;
  e[14] = (-2 * far * near) / (far - near);
  return e;
}

describe('photo mode (KB-I47)', () => {
  it('Halton jitter: low discrepancy, centred, within ±0.5 px', () => {
    expect(halton(1, 2)).toBe(0.5);
    expect(halton(2, 2)).toBe(0.25);
    expect(halton(1, 3)).toBeCloseTo(1 / 3, 12);
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < 16; k++) {
      const [x, y] = pixelJitter(k);
      expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.5);
      sx += x;
      sy += y;
    }
    expect(Math.abs(sx / 16)).toBeLessThan(0.05);
    expect(Math.abs(sy / 16)).toBeLessThan(0.05);
  });

  it('lens samples cover the aperture disc evenly', () => {
    const n = 32;
    let mx = 0;
    let my = 0;
    for (let k = 0; k < n; k++) {
      const [x, y] = lensOffset(k, n, 0.5);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(0.5 + 1e-12);
      mx += x;
      my += y;
    }
    expect(Math.hypot(mx, my) / n).toBeLessThan(0.03);
    expect(lensOffset(3, 32, 0)).toEqual([0, 0]);
  });

  it('shiftProjection keeps the focus plane fixed and blurs other depths by the aperture', () => {
    const e0 = perspective(55, 16 / 9);
    const F = 120;
    const a = apertureRadius(F, e0[0]);
    expect(a).toBeGreaterThan(0);
    const ax = a;
    const e = [...e0];
    shiftProjection(e, 0, 0, 3840, 2160, ax, 0, F);
    // a point on the focus plane: camera moved by +ax, so its camera-space x is x − ax
    const x = 7;
    expect(ndcX(e, x - ax, -F)).toBeCloseTo(ndcX(e0, x, -F), 12);
    // a point at infinity moves by p00·a/F = 2·cocFrac (image widths in NDC: 2 = full width)
    const far = 1e9;
    const shift = Math.abs(ndcX(e, x - ax, -far) - ndcX(e0, x, -far));
    expect(shift * (3840 / 2)).toBeCloseTo(0.0012 * 2 * 3840 / 2, 3); // ≈ 4.6 px blur radius at infinity
    // pure jitter: half a pixel moves NDC by 1/w
    const j = [...e0];
    shiftProjection(j, 0.5, -0.5, 3840, 2160);
    expect(j[8] - e0[8]).toBeCloseTo(1 / 3840, 12);
    expect(j[9] - e0[9]).toBeCloseTo(-1 / 2160, 12);
  });

  it('sizes, sample counts, labels and file names', () => {
    expect(photoSize(1920, 1080, 2)).toEqual({ w: 3840, h: 2160, scale: 2 });
    expect(photoSize(1920, 1080, 3)).toEqual({ w: 5760, h: 3240, scale: 3 });
    const capped = photoSize(3000, 1600, 3, 8192);
    expect(capped.w).toBeLessThanOrEqual(8192);
    expect(capped.w / capped.h).toBeCloseTo(3000 / 1600, 2);
    expect(sampleCount({ scale: 2, dof: false })).toBe(16);
    expect(sampleCount({ scale: 2, dof: true })).toBe(32);
    expect(sampleCount({ scale: 2, dof: false, samples: 500 })).toBe(64);
    expect(sceneTime(17.5)).toBe('15. Juli 1789, 17:30 Uhr');
    expect(sceneTime(7)).toBe('15. Juli 1789, 07:00 Uhr');
    const t = burnInText(19, 'Gelände: GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0');
    expect(t.label).toContain('Rekonstruktion – Hypothese');
    expect(t.attribution).toContain('GeoBasis-DE/LVGL-SL');
    expect(t.attribution).toContain('Schauen, nicht graben');
    expect(t.attribution).toContain('CC0');
    expect(photoFileName(17.5, new Date(2026, 10, 2, 9, 5, 7))).toBe('schloss-karlsberg-1789_1730_20261102-090507.png');
  });
});

describe('photo DOF for wide shots (wave-7 review)', () => {
  const p00 = perspective(55, 16 / 9)[0];
  const W = 3840;
  it('far focus: nothing from 15 m to infinity blurs by more than 1.5 px', () => {
    for (const F of [30, 56.7, 141, 400]) {
      const a = photoAperture(F, p00, W);
      expect(a).toBeGreaterThan(0);
      for (const d of [PHOTO_DOF.near, 20, 40, 100, 1e6]) expect(blurPx(d, F, a, p00, W)).toBeLessThanOrEqual(PHOTO_DOF.maxBlurPx + 1e-9);
    }
    // the Ehrenhof case: before, the court at 15 m blurred by ≈ 13 px
    expect(blurPx(15, 56.7, apertureRadius(56.7, p00), p00, W)).toBeGreaterThan(10);
  });
  it('near focus keeps the mild depth of field', () => {
    expect(photoAperture(8, p00, W)).toBe(apertureRadius(8, p00));
    expect(photoAperture(PHOTO_DOF.farFocus, p00, W)).toBe(apertureRadius(PHOTO_DOF.farFocus, p00));
  });
});
