import proj4 from 'proj4';

/** EPSG:25832 (ETRS89 / UTM 32N), definition fixed by docs/data-contract.md. */
export const EPSG25832 = 'EPSG:25832';
proj4.defs(EPSG25832, '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const toUtm = proj4('WGS84', EPSG25832);

export interface Origin {
  E0: number;
  N0: number;
}
export interface LatLon {
  lat: number;
  lon: number;
}
export interface UTM {
  E: number;
  N: number;
}
/** three.js world-frame ground position: x = E − E0, z = −(N − N0). */
export interface WorldXZ {
  x: number;
  z: number;
}

export function wgs84ToUtm(lat: number, lon: number): UTM {
  const [E, N] = toUtm.forward([lon, lat]);
  return { E, N };
}

export function utmToWgs84(E: number, N: number): LatLon {
  const [lon, lat] = toUtm.inverse([E, N]);
  return { lat, lon };
}

export function utmToWorld(E: number, N: number, o: Origin): WorldXZ {
  return { x: E - o.E0, z: -(N - o.N0) };
}

export function worldToUtm(x: number, z: number, o: Origin): UTM {
  return { E: x + o.E0, N: o.N0 - z };
}

export function worldToWgs84(x: number, z: number, o: Origin): LatLon {
  const { E, N } = worldToUtm(x, z, o);
  return utmToWgs84(E, N);
}

export function wgs84ToWorld(lat: number, lon: number, o: Origin): WorldXZ {
  const { E, N } = wgs84ToUtm(lat, lon);
  return utmToWorld(E, N, o);
}

/**
 * True bearing (degrees, clockwise from true north) of the UTM grid-north direction
 * at (E, N) — i.e. the meridian convergence, ≈ −1.2° around Homburg.
 * Use `trueHeading = gridHeading + gridConvergenceDeg(E, N)` when drawing the camera
 * heading (which is relative to grid north) on a Web-Mercator map.
 */
export function gridConvergenceDeg(E: number, N: number): number {
  const a = utmToWgs84(E, N);
  const b = utmToWgs84(E, N + 100); // 100 m grid north
  const dLon = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  const dLat = b.lat - a.lat;
  // Bearing (clockwise from true north) of the grid-north direction.
  return (Math.atan2(dLon, dLat) * 180) / Math.PI;
}
