/**
 * CPU port of the analytic sky in three r187 `examples/jsm/objects/Sky.js` (Preetham, Shirley & Smits, "A Practical
 * Analytic Model for Daylight", SIGGRAPH 1999, as adapted by three.js), without clouds and without the sun disc.
 * Pure (no three.js): lets the viewer normalise the sky to a target illuminance and derive the haze colour from the
 * same radiance the GPU draws (backlog KB-I06/KB-I07). Directions are unit vectors [x, y, z] with y up.
 */
import { clamp } from '@model/layout/geom.ts';
import type { RGB } from './light.ts';

export type V3 = [number, number, number];

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

const totalRayleigh: V3 = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst: V3 = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const cutoffAngle = 1.6110731556870734;
const steepness = 1.5;
const EE = 1000;
const rayleighZenithLength = 8.4e3;
const mieZenithLength = 1.25e3;
const THREE_OVER_SIXTEENPI = 0.05968310365946075;
const ONE_OVER_FOURPI = 0.07957747154594767;


function sunIntensity(zenithAngleCos: number): number {
  const c = clamp(zenithAngleCos, -1, 1);
  return EE * Math.max(0, 1 - Math.exp(-((cutoffAngle - Math.acos(c)) / steepness)));
}

/** Radiance of the analytic sky toward `dir` (three.js Sky units, linear RGB, before any exposure). */
export function skyRadiance(dir: V3, sunDir: V3, p: SkyParams): RGB {
  // vertex part
  const sunE = sunIntensity(sunDir[1]);
  const sunfade = 1 - clamp(1 - Math.exp(sunDir[1] / 450000), 0, 1);
  const rayleighCoefficient = p.rayleigh - (1 - sunfade);
  const mieC = 0.2 * p.turbidity * 10e-18;
  const betaR = totalRayleigh.map((v) => v * rayleighCoefficient) as V3;
  const betaM = MieConst.map((m) => 0.434 * mieC * m * p.mieCoefficient) as V3;
  // fragment part
  const zenithAngle = Math.acos(Math.max(0, dir[1]));
  const inverse = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
  const sR = rayleighZenithLength * inverse;
  const sM = mieZenithLength * inverse;
  const cosTheta = dir[0] * sunDir[0] + dir[1] * sunDir[1] + dir[2] * sunDir[2];
  const rc = cosTheta * 0.5 + 0.5; // three.js passes cosTheta * 0.5 + 0.5 to the Rayleigh phase
  const rPhase = THREE_OVER_SIXTEENPI * (1 + rc * rc);
  const g = p.mieDirectionalG;
  const g2 = g * g;
  const mPhase = ONE_OVER_FOURPI * ((1 - g2) / Math.pow(1 - 2 * g * cosTheta + g2, 1.5));
  const blend = clamp(Math.pow(1 - sunDir[1], 5), 0, 1);
  const out: RGB = [0, 0, 0];
  const night = [0, 0.0003, 0.00075];
  for (let i = 0; i < 3; i++) {
    const fex = Math.exp(-(betaR[i] * sR + betaM[i] * sM));
    const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
    let lin = Math.pow(Math.max(0, sunE * ratio * (1 - fex)), 1.5);
    lin *= 1 + (Math.pow(Math.max(0, sunE * ratio * fex), 0.5) - 1) * blend;
    const l0 = 0.1 * fex;
    out[i] = (lin + l0) * 0.04 + night[i];
  }
  return out;
}

/** Deterministic, roughly uniform directions on the unit sphere (Fibonacci lattice). */
export function sphereDirections(n: number): V3[] {
  const out: V3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  return out;
}

const DIRS = sphereDirections(512);

/**
 * Irradiance (cosine-weighted integral of radiance, linear RGB) on a surface with normal `n`: the sky above the
 * horizon, and `ground` (a constant radiance) below it. Pass ground = [0, 0, 0] for the sky part alone.
 */
export function irradiance(n: V3, sunDir: V3, p: SkyParams, ground: RGB = [0, 0, 0]): RGB {
  const e: RGB = [0, 0, 0];
  const w = (4 * Math.PI) / DIRS.length;
  for (const d of DIRS) {
    const c = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (c <= 0) continue;
    const L = d[1] > 0 ? skyRadiance(d, sunDir, p) : ground;
    e[0] += L[0] * c * w;
    e[1] += L[1] * c * w;
    e[2] += L[2] * c * w;
  }
  return e;
}

/**
 * Mean radiance of the sky over the upper hemisphere (uniform over solid angle, linear RGB): the isotropic part the
 * image-based light is blended toward (`envSkyIso` in light.ts). A uniform sky of this radiance gives π × it on a
 * horizontal plane.
 */
export function meanSkyRadiance(sunDir: V3, p: SkyParams): RGB {
  const out: RGB = [0, 0, 0];
  let k = 0;
  for (const d of DIRS) {
    if (d[1] <= 0) continue;
    const L = skyRadiance(d, sunDir, p);
    out[0] += L[0];
    out[1] += L[1];
    out[2] += L[2];
    k++;
  }
  return [out[0] / k, out[1] / k, out[2] / k];
}

/**
 * Mean sky radiance in a low band above the horizon (default elevations 1°…8°) around azimuth direction `towards`
 * (horizontal unit vector), ± 40°: the colour distant haze takes in that direction.
 */
export function horizonRadiance(towards: V3, sunDir: V3, p: SkyParams, elevations: readonly number[] = [1, 3, 5, 8]): RGB {
  const out: RGB = [0, 0, 0];
  const base = Math.atan2(towards[2], towards[0]);
  let k = 0;
  for (let a = -40; a <= 40; a += 10) {
    for (const el of elevations) {
      const az = base + (a * Math.PI) / 180;
      const e = (el * Math.PI) / 180;
      const L = skyRadiance([Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)], sunDir, p);
      out[0] += L[0];
      out[1] += L[1];
      out[2] += L[2];
      k++;
    }
  }
  return [out[0] / k, out[1] / k, out[2] / k];
}

// ---------------------------------------------------------------- spherical harmonics (KB-I55 widened, wave-1 review)

/** Real SH basis, bands 0–2, in the order and normalisation of three.js `SphericalHarmonics3.getBasisAt`. */
export function shBasis(d: V3): number[] {
  const [x, y, z] = d;
  return [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
}

/**
 * Project a radiance function onto 9 SH coefficients (linear RGB), Monte-Carlo over a Fibonacci sphere. The result
 * plugs into three's GLSL `shGetIrradianceAt` (which applies the cosine-lobe convolution), as a `LightProbe` does.
 */
export function projectSH(radiance: (d: V3) => RGB, n = 512): RGB[] {
  const dirs = n === DIRS.length ? DIRS : sphereDirections(n);
  const c: RGB[] = Array.from({ length: 9 }, () => [0, 0, 0] as RGB);
  const w = (4 * Math.PI) / dirs.length;
  for (const d of dirs) {
    const L = radiance(d);
    const b = shBasis(d);
    for (let k = 0; k < 9; k++) {
      c[k][0] += L[0] * b[k] * w;
      c[k][1] += L[1] * b[k] * w;
      c[k][2] += L[2] * b[k] * w;
    }
  }
  return c;
}

/** CPU twin of three's GLSL `shGetIrradianceAt(normal, sh)`: irradiance (π × radiance for a uniform sky). */
export function shIrradiance(sh: readonly RGB[], n: V3): RGB {
  const [x, y, z] = n;
  const f = [0.886227, 2 * 0.511664 * y, 2 * 0.511664 * z, 2 * 0.511664 * x, 2 * 0.429043 * x * y, 2 * 0.429043 * y * z, 0.743125 * z * z - 0.247708, 2 * 0.429043 * x * z, 0.429043 * (x * x - y * y)];
  const out: RGB = [0, 0, 0];
  for (let k = 0; k < 9; k++) for (let i = 0; i < 3; i++) out[i] += sh[k][i] * f[k];
  return out;
}
