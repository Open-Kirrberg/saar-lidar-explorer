import { describe, expect, it } from 'vitest';
import { luminance } from '../src/light.ts';
import { horizonRadiance, irradiance, projectSH, shBasis, shIrradiance, skyRadiance, sphereDirections, type SkyParams, type V3 } from '../src/preetham.ts';

const P: SkyParams = { turbidity: 3, rayleigh: 1, mieCoefficient: 0.004, mieDirectionalG: 0.8 };
const dir = (azDeg: number, elDeg: number): V3 => {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
};

describe('Preetham sky port (three r187 Sky.js)', () => {
  const sunHigh = dir(0, 50);
  it('is non-negative and finite everywhere', () => {
    for (const d of sphereDirections(200)) {
      for (const c of skyRadiance(d, sunHigh, P)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(c)).toBe(true);
      }
    }
  });

  it('zenith is bluer than the horizon', () => {
    const z = skyRadiance([0, 1, 0], sunHigh, P);
    const h = skyRadiance(dir(180, 2), sunHigh, P);
    expect(z[2] / z[0]).toBeGreaterThan(h[2] / h[0]);
  });

  it('brighter toward the sun than away from it', () => {
    const sunLow = dir(0, 8);
    expect(luminance(skyRadiance(dir(0, 12), sunLow, P))).toBeGreaterThan(luminance(skyRadiance(dir(180, 12), sunLow, P)));
    expect(luminance(horizonRadiance(dir(0, 0), sunLow, P))).toBeGreaterThan(luminance(horizonRadiance(dir(180, 0), sunLow, P)));
  });

  it('Fibonacci directions are unit vectors spread over both hemispheres', () => {
    const d = sphereDirections(512);
    expect(d).toHaveLength(512);
    for (const v of d) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    expect(d.filter((v) => v[1] > 0)).toHaveLength(256);
  });

  it('irradiance is positive upward and grows with ground bounce', () => {
    const up = irradiance([0, 1, 0], sunHigh, P);
    for (const c of up) expect(c).toBeGreaterThan(0);
    const side = irradiance([1, 0, 0], sunHigh, P);
    const sideG = irradiance([1, 0, 0], sunHigh, P, [1, 1, 1]);
    expect(luminance(sideG)).toBeGreaterThan(luminance(side));
    // a uniform radiance of 1 over the lower hemisphere gives irradiance π on a downward surface
    const down = irradiance([0, -1, 0], sunHigh, P, [1, 1, 1]);
    expect(down[0]).toBeCloseTo(Math.PI, 1);
  });
});

describe('spherical-harmonics sky probe (wave-1 review: SH diffuse instead of PMREM)', () => {
  it('basis band 0 is the constant 0.282095 (three.js SphericalHarmonics3)', () => {
    expect(shBasis([0, 1, 0])[0]).toBeCloseTo(0.282095, 6);
    expect(shBasis([0, 1, 0])[1]).toBeCloseTo(0.488603, 6);
  });

  it('a uniform radiance L gives irradiance π·L in every direction', () => {
    const sh = projectSH(() => [1, 0.5, 0.25]);
    for (const n of [[0, 1, 0], [1, 0, 0], [0, -1, 0], [0, 0.6, 0.8]] as V3[]) {
      const e = shIrradiance(sh, n);
      expect(e[0]).toBeCloseTo(Math.PI, 1);
      expect(e[1]).toBeCloseTo(Math.PI * 0.5, 1);
      expect(e[2]).toBeCloseTo(Math.PI * 0.25, 1);
    }
  });

  it('matches the brute-force sky irradiance within a few percent for up and side normals', () => {
    const sun = dir(30, 35);
    const sh = projectSH((d) => (d[1] > 0 ? skyRadiance(d, sun, P) : [0, 0, 0]));
    for (const n of [[0, 1, 0], dir(30, 0), dir(210, 0)] as V3[]) {
      const ref = luminance(irradiance(n, sun, P));
      const got = luminance(shIrradiance(sh, n));
      expect(Math.abs(got - ref) / ref).toBeLessThan(0.15);
    }
  });
});
