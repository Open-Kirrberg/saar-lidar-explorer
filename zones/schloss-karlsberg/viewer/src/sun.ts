/**
 * Solar position (NOAA simplified algorithm) for Homburg / Karlsberg, summer 1789.
 * Returns elevation and azimuth (degrees, azimuth clockwise from TRUE north).
 */
export const KARLSBERG_LAT = 49.336;
export const KARLSBERG_LON = 7.36;

/** Day of year for a Gregorian date. */
export function dayOfYear(y: number, m: number, d: number): number {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cum[m - 1] + d + (leap && m > 2 ? 1 : 0);
}

/**
 * @param doy day of year
 * @param hourLocal local apparent-ish clock hour (we use local mean time: UTC + lon/15, as in 1789)
 */
export function sunPosition(doy: number, hourLocal: number, lat = KARLSBERG_LAT): { elevation: number; azimuth: number } {
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hourLocal - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  // local mean time -> true solar time
  const tst = hourLocal * 60 + eqt;
  const ha = ((tst / 4 - 180) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const el = 90 - (zen * 180) / Math.PI;
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  const azDeg = ((az * 180) / Math.PI + 180 + 360) % 360;
  return { elevation: el, azimuth: azDeg };
}
