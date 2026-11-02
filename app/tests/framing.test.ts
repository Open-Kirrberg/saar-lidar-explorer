import { describe, expect, it } from 'vitest';
import { displayY, frameSite } from '../src/candidates/framing';

const flat = (y: number) => () => y;
/** Does the camera look exactly at the target (pitch matches the drop over the horizontal distance)? */
function aimError(f: ReturnType<typeof frameSite>, tx: number, ty: number, tz: number): number {
  const d = Math.hypot(tx - f.x, tz - f.z);
  return Math.abs(-(Math.atan2(f.y - ty, d) * 180) / Math.PI - f.pitch);
}

describe('frameSite (exaggeration-aware N/P framing)', () => {
  it('displayY applies y = hRef + (h − hRef) · exag', () => {
    expect(displayY(310, 300, 1)).toBe(310);
    expect(displayY(310, 300, 3)).toBe(330);
    expect(displayY(290, 300, 5)).toBe(250);
  });

  it('matches the old oblique pose on flat ground at 1× (camera dist back along the heading)', () => {
    const f = frameSite(0, 300, 0, 100, 65, 0, flat(300));
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(100); // heading 0 = grid north = −z, camera stands south of the target
    expect(f.y).toBeCloseTo(365);
    expect(f.pitch).toBeCloseTo(-((Math.atan2(65, 100) * 180) / Math.PI));
    const e = frameSite(0, 300, 0, 100, 65, 90, flat(300));
    expect(e.x).toBeCloseTo(-100);
    expect(e.z).toBeCloseTo(0);
  });

  it('keeps a pit at 1–5× centred: the target y is the displayed one and the aim is exact', () => {
    const hRef = 300;
    for (const exag of [1, 2, 3, 5]) {
      const ty = displayY(296, hRef, exag); // 4 m deep pit
      const ground = (_x: number, z: number) => displayY(300 + 0.05 * z, hRef, exag); // slope rising towards the camera
      const f = frameSite(10, ty, -20, 120, 78, 0, ground);
      expect(aimError(f, 10, ty, -20)).toBeLessThan(1e-9);
      // sight line clears the terrain at the sampled points between camera and target (t ≥ 0.1)
      for (let k = 2; k <= 16; k++) {
        const t = k / 16;
        const z = -20 + (f.z + 20) * t;
        expect(ty + t * f.rise).toBeGreaterThanOrEqual(ground(0, z) - 1e-6);
      }
    }
  });

  it('raises the camera behind a ridge instead of hiding the target, and ignores unknown ground', () => {
    const ridge = (_x: number, z: number) => (z > 40 && z < 60 ? 400 : 300);
    const f = frameSite(0, 300, 0, 100, 50, 0, ridge);
    expect(f.rise).toBeGreaterThan(50);
    expect(aimError(f, 0, 300, 0)).toBeLessThan(1e-9);
    const g = frameSite(0, 300, 0, 100, 50, 0, () => NaN);
    expect(g.rise).toBe(50);
  });
});
