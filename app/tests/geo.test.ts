import { describe, expect, it } from 'vitest';
import { gridConvergenceDeg, utmToWgs84, utmToWorld, wgs84ToUtm, worldToUtm } from '../src/geo';

describe('geo (EPSG:25832 ⇄ WGS84)', () => {
  it('projects Schloss Karlsberg within 1 m of the reference', () => {
    const { E, N } = wgs84ToUtm(49.33623, 7.37844);
    expect(Math.abs(E - 382198)).toBeLessThan(1);
    expect(Math.abs(N - 5466099)).toBeLessThan(1);
  });

  it('inverse-projects Karlsberg UTM within 1 m', () => {
    const { lat, lon } = utmToWgs84(382198, 5466099);
    const back = wgs84ToUtm(lat, lon);
    expect(Math.abs(back.E - 382198)).toBeLessThan(0.001);
    expect(Math.abs(back.N - 5466099)).toBeLessThan(0.001);
    // ~1 m ≈ 1.4e-5° lon / 9e-6° lat here
    expect(Math.abs(lat - 49.33623)).toBeLessThan(1e-5);
    expect(Math.abs(lon - 7.37844)).toBeLessThan(1.5e-5);
  });

  it('maps world ⇄ UTM with the contract frame (x = E − E0, z = −(N − N0))', () => {
    const o = { E0: 381000, N0: 5465000 };
    const w = utmToWorld(382198, 5466099, o);
    expect(w).toEqual({ x: 1198, z: -1099 });
    expect(worldToUtm(w.x, w.z, o)).toEqual({ E: 382198, N: 5466099 });
  });

  it('meridian convergence west of 9°E is about −1.2°', () => {
    const g = gridConvergenceDeg(382198, 5466099);
    expect(g).toBeLessThan(-1.0);
    expect(g).toBeGreaterThan(-1.4);
  });
});
