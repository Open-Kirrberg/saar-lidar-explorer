/**
 * Coordinate frames (pure, no three.js).
 *
 *  EN     : EPSG:25832 easting/northing in metres (UTM zone 32N, central meridian 9° E).
 *  local  : explorer three.js world frame (docs/data-contract.md, karlsberg AOI):
 *             x = E − E0,  y = h (m DHHN2016, true height),  z = −(N − N0)
 *           with E0 = 381000, N0 = 5465000. Never put raw UTM into float32 buffers.
 *  grid   : palace grid (u, v) of catalogue.palace_grid: u along the Ehrenhof axis
 *           (grid azimuth 80.5°, towards the east avenue), v perpendicular towards N (az 350.5°).
 *             E = E_o + u·sin(az) − v·cos(az)
 *             N = N_o + u·cos(az) + v·sin(az)
 *  azimuth: degrees clockwise from north. "grid" azimuth is measured from grid north
 *           (= +N axis of EPSG:25832 = −z in local), "true" from geographic north:
 *             true = grid + γ,   γ = grid convergence (≈ −1.23° at Karlsberg, W of 9° E).
 */
import type { EN, PalaceGrid } from './spec.ts';

export const E0 = 381000;
export const N0 = 5465000;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// EN <-> local
// ---------------------------------------------------------------------------------------------

export function enToLocal(E: number, N: number, h = 0): Vec3 {
  return { x: E - E0, y: h, z: -(N - N0) };
}

export function localToEN(x: number, z: number): EN {
  return [x + E0, N0 - z];
}

/** Plan-only variant: [E, N] -> [x, z]. */
export function enToXZ(p: EN): [number, number] {
  return [p[0] - E0, -(p[1] - N0)];
}

// ---------------------------------------------------------------------------------------------
// Palace grid (u, v) <-> EN
// ---------------------------------------------------------------------------------------------

export interface GridFrame {
  readonly origin: EN;
  readonly azimuthGridDeg: number;
  /** Unit vector of +u in EN. */
  readonly uDir: EN;
  /** Unit vector of +v in EN (u rotated 90° counter-clockwise). */
  readonly vDir: EN;
  toEN(u: number, v: number): EN;
  toUV(E: number, N: number): [number, number];
}

export function gridFrame(pg: Pick<PalaceGrid, 'origin_EN' | 'u_azimuth_grid_deg'>): GridFrame {
  const az = pg.u_azimuth_grid_deg * DEG;
  const uDir: EN = [Math.sin(az), Math.cos(az)];
  const vDir: EN = [-Math.cos(az), Math.sin(az)];
  const [Eo, No] = pg.origin_EN;
  return {
    origin: [Eo, No],
    azimuthGridDeg: pg.u_azimuth_grid_deg,
    uDir,
    vDir,
    toEN(u, v) {
      return [Eo + u * uDir[0] + v * vDir[0], No + u * uDir[1] + v * vDir[1]];
    },
    toUV(E, N) {
      const dE = E - Eo;
      const dN = N - No;
      return [dE * uDir[0] + dN * uDir[1], dE * vDir[0] + dN * vDir[1]];
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Azimuths and directions
// ---------------------------------------------------------------------------------------------

/** Grid azimuth (deg, clockwise from grid north) of the EN direction (dE, dN), in [0, 360). */
export function azimuthOf(dE: number, dN: number): number {
  const a = Math.atan2(dE, dN) / DEG;
  return (a + 360) % 360;
}

/** Unit EN vector for a grid azimuth. */
export function dirEN(azGridDeg: number): EN {
  return [Math.sin(azGridDeg * DEG), Math.cos(azGridDeg * DEG)];
}

/** Unit vector in the local three.js frame (y = 0) for a grid azimuth. */
export function dirLocal(azGridDeg: number): Vec3 {
  return { x: Math.sin(azGridDeg * DEG), y: 0, z: -Math.cos(azGridDeg * DEG) };
}

/** Rotation about +y (three.js `rotation.y`, radians) that turns local −z (grid north) to the azimuth. */
export function rotationYForAzimuth(azGridDeg: number): number {
  // three.js rotation.y = θ maps (0,0,-1) to (−sin θ, 0, −cos θ); we want (sin az, 0, −cos az).
  return -azGridDeg * DEG;
}

// ---------------------------------------------------------------------------------------------
// UTM 32N inverse (for geographic lat/lon and grid convergence)
// ---------------------------------------------------------------------------------------------

const A = 6378137.0; // GRS80 / WGS84 semi-major axis
const F = 1 / 298.257222101; // GRS80 flattening (ETRS89)
const K0 = 0.9996;
const LON0 = 9; // zone 32 central meridian (deg)
const FALSE_E = 500000;

/** EPSG:25832 -> geographic [latDeg, lonDeg] (ETRS89). Accuracy ~1e-9 deg (Krüger series). */
export function enToLatLon(E: number, N: number): [number, number] {
  const n = F / (2 - F);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;
  const Ahat = (A / (1 + n)) * (1 + n2 / 4 + n4 / 64);
  const beta = [
    0,
    n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - n4 / 360,
    n2 / 48 + n3 / 15 - (437 / 1440) * n4,
    (17 / 480) * n3 - (37 / 840) * n4,
    (4397 / 161280) * n4,
  ];
  const xi = N / (K0 * Ahat);
  const eta = (E - FALSE_E) / (K0 * Ahat);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 4; j++) {
    xiP -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  const e2 = F * (2 - F);
  const e = Math.sqrt(e2);
  // conformal latitude -> geodetic latitude (iterate)
  let phi = chi;
  for (let i = 0; i < 10; i++) {
    const s = Math.sin(phi);
    phi = 2 * Math.atan(Math.tan(Math.PI / 4 + chi / 2) * Math.pow((1 + e * s) / (1 - e * s), e / 2)) - Math.PI / 2;
  }
  const lon = LON0 + Math.atan2(Math.sinh(etaP), Math.cos(xiP)) / DEG;
  return [phi / DEG, lon];
}

/**
 * Grid convergence γ in degrees at (E, N): true azimuth = grid azimuth + γ.
 * Negative west of 9° E (Karlsberg ≈ −1.23°, matching catalogue.palace_grid.grid_convergence_deg).
 */
export function gridConvergenceDeg(E: number, N: number): number {
  const [lat, lon] = enToLatLon(E, N);
  return Math.atan(Math.tan((lon - LON0) * DEG) * Math.sin(lat * DEG)) / DEG;
}

export function gridToTrueAzimuth(azGridDeg: number, E: number, N: number): number {
  return (azGridDeg + gridConvergenceDeg(E, N) + 360) % 360;
}

export function trueToGridAzimuth(azTrueDeg: number, E: number, N: number): number {
  return (azTrueDeg - gridConvergenceDeg(E, N) + 360) % 360;
}

/** Unit vector of TRUE north in the local three.js frame at (E, N). */
export function trueNorthLocal(E: number, N: number): Vec3 {
  // true north has grid azimuth −γ
  return dirLocal(-gridConvergenceDeg(E, N));
}
