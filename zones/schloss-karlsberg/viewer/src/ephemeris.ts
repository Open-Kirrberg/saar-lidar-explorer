/**
 * Moon, sun and stars for any date of the 18th century (audit wave 9, rank 5: "the moon of 15 Jul 1789 is not
 * unknown"). Pure: no three.js, no DOM. Algorithms after J. Meeus, *Astronomical Algorithms*, 2nd ed., Willmann-Bell
 * 1998 [D for the method; the numbers are computed]:
 * - Julian Day (ch. 7), mean sidereal time at Greenwich (ch. 12, eq. 12.4), obliquity (ch. 22, eq. 22.2);
 * - the sun's apparent longitude, low accuracy ≈ 0.01° (ch. 25);
 * - the moon's geocentric position (ch. 47) with the leading terms of tables 47.A (30 rows) and 47.B (30 rows):
 *   ≈ 0.01° in longitude and latitude, ≈ 30 km in distance against the full series (Meeus example 47.a in the tests);
 * - illuminated fraction and position angle of the bright limb (ch. 48);
 * - precession of J2000 catalogue places to the date (ch. 21, eq. 21.2–21.4; proper motion ignored: ≤ 0.15° for every
 *   star of the catalogue over 211 years);
 * - the topocentric moon: horizontal parallax (≈ 1°) subtracted from the altitude, refraction ignored.
 * Moonlight: Krisciunas & Schaefer, "A model of the brightness of moonlight", PASP 103 (1991) 1033–1039, eq. 8–9
 * (the moon's magnitude over the phase angle); a magnitude-0 star gives 2.54 µlx outside the atmosphere [D].
 * Time: the viewer's clock is local mean time at Karlsberg (sun.ts), so UT = hour − longitude / 15; ΔT (≈ 13 s in
 * 1789) is ignored.
 */

import { airmass } from './light.ts';

const DEG = Math.PI / 180;
const norm360 = (x: number): number => ((x % 360) + 360) % 360;
const sind = (x: number): number => Math.sin(x * DEG);
const cosd = (x: number): number => Math.cos(x * DEG);

/** Julian Day of a Gregorian calendar date; `day` may carry a fraction (UT). Meeus eq. 7.1. */
export function julianDay(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/** Gregorian calendar date (year, month, day with fraction) of a Julian Day. Meeus ch. 7. */
export function calendarDate(jd: number): { year: number; month: number; day: number } {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const a = z + 1 + alpha - Math.floor(alpha / 4);
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e) + f;
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { year, month, day };
}

/** Julian centuries from J2000.0. */
export function centuries(jd: number): number {
  return (jd - 2451545) / 36525;
}

/** Mean sidereal time at Greenwich (degrees), Meeus eq. 12.4. */
export function gmst(jd: number): number {
  const t = centuries(jd);
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - (t * t * t) / 38710000);
}

/** Mean obliquity of the ecliptic (degrees), Meeus eq. 22.2. */
export function obliquity(jd: number): number {
  const t = centuries(jd);
  return 23 + 26 / 60 + (21.448 - 46.815 * t - 0.00059 * t * t + 0.001813 * t * t * t) / 3600;
}

/** Sun: apparent ecliptic longitude (deg) and distance (km), Meeus ch. 25 (low accuracy). */
export function sunEcliptic(jd: number): { lon: number; dist: number } {
  const t = centuries(jd);
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const m = 357.52911 + 35999.05029 * t - 0.0001537 * t * t;
  const e = 0.016708634 - 0.000042037 * t - 0.0000001267 * t * t;
  const c = (1.914602 - 0.004817 * t - 0.000014 * t * t) * sind(m) + (0.019993 - 0.000101 * t) * sind(2 * m) + 0.000289 * sind(3 * m);
  const trueLon = l0 + c;
  const nu = m + c;
  const r = (1.000001018 * (1 - e * e)) / (1 + e * cosd(nu));
  const omega = 125.04 - 1934.136 * t;
  return { lon: norm360(trueLon - 0.00569 - 0.00478 * sind(omega)), dist: r * 149597870.7 };
}

// Meeus table 47.A, leading 30 rows: D, M, M', F, Σl (1e-6 deg), Σr (1e-3 km)
const LR: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
];
// Meeus table 47.B, leading 30 rows: D, M, M', F, Σb (1e-6 deg)
const B: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
];

/** Moon: geocentric ecliptic longitude, latitude (deg) and distance (km), Meeus ch. 47 (truncated series). */
export function moonEcliptic(jd: number): { lon: number; lat: number; dist: number } {
  const t = centuries(jd);
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const lp = norm360(218.3164477 + 481267.88123421 * t - 0.0015786 * t2 + t3 / 538841 - t4 / 65194000);
  const d = norm360(297.8501921 + 445267.1114034 * t - 0.0018819 * t2 + t3 / 545868 - t4 / 113065000);
  const m = norm360(357.5291092 + 35999.0502909 * t - 0.0001536 * t2 + t3 / 24490000);
  const mp = norm360(134.9633964 + 477198.8675055 * t + 0.0087414 * t2 + t3 / 69699 - t4 / 14712000);
  const f = norm360(93.272095 + 483202.0175233 * t - 0.0036539 * t2 - t3 / 3526000 + t4 / 863310000);
  const e = 1 - 0.002516 * t - 0.0000074 * t2;
  const a1 = norm360(119.75 + 131.849 * t);
  const a2 = norm360(53.09 + 479264.29 * t);
  const a3 = norm360(313.45 + 481266.484 * t);
  const ef = (k: number): number => (Math.abs(k) === 1 ? e : Math.abs(k) === 2 ? e * e : 1);
  let sl = 0;
  let sr = 0;
  for (const [cd, cm, cmp, cf, l, r] of LR) {
    const arg = cd * d + cm * m + cmp * mp + cf * f;
    sl += l * ef(cm) * sind(arg);
    sr += r * ef(cm) * cosd(arg);
  }
  let sb = 0;
  for (const [cd, cm, cmp, cf, b] of B) sb += b * ef(cm) * sind(cd * d + cm * m + cmp * mp + cf * f);
  sl += 3958 * sind(a1) + 1962 * sind(lp - f) + 318 * sind(a2);
  sb += -2235 * sind(lp) + 382 * sind(a3) + 175 * sind(a1 - f) + 175 * sind(a1 + f) + 127 * sind(lp - mp) - 115 * sind(lp + mp);
  return { lon: norm360(lp + sl / 1e6), lat: sb / 1e6, dist: 385000.56 + sr / 1000 };
}

/** Ecliptic → equatorial (deg), Meeus eq. 13.3–13.4. */
export function eclipticToEquatorial(lon: number, lat: number, eps: number): { ra: number; dec: number } {
  const ra = Math.atan2(sind(lon) * cosd(eps) - Math.tan(lat * DEG) * sind(eps), cosd(lon)) / DEG;
  const dec = Math.asin(sind(lat) * cosd(eps) + cosd(lat) * sind(eps) * sind(lon)) / DEG;
  return { ra: norm360(ra), dec };
}

/** Equatorial → horizontal: altitude and azimuth (deg, azimuth clockwise from TRUE north), for local sidereal time `lst`. */
export function equatorialToHorizontal(ra: number, dec: number, lst: number, lat: number): { alt: number; az: number } {
  const h = lst - ra;
  const alt = Math.asin(sind(lat) * sind(dec) + cosd(lat) * cosd(dec) * cosd(h)) / DEG;
  const az = Math.atan2(-cosd(dec) * sind(h), cosd(lat) * sind(dec) - sind(lat) * cosd(dec) * cosd(h)) / DEG;
  return { alt, az: norm360(az) };
}

/**
 * 3 × 3 matrix (row-major) from equatorial unit vectors of the date (x → RA 0, z → north pole) to the viewer's local
 * frame (x east, y up, z south = −grid north), for local sidereal time `lst`, latitude `lat` and the grid convergence
 * `gammaDeg` (grid az = true az − γ, as for the sun). Stars: v_local = M · (cos δ cos α, cos δ sin α, sin δ).
 */
export function equatorialToLocalMatrix(lst: number, lat: number, gammaDeg = 0): number[] {
  // equatorial → (east, north, up) of the true horizon
  const sl = sind(lst);
  const cl = cosd(lst);
  const sp = sind(lat);
  const cp = cosd(lat);
  // H = lst − α: cos δ cos H = x cl + y sl, cos δ sin H = x sl − y cl
  const east = [-sl, cl, 0];
  const north = [-sp * cl, -sp * sl, cp];
  const up = [cp * cl, cp * sl, sp];
  // rotate (east, north) by −γ about up so azimuths are measured from grid north: grid az = true az − γ
  const sg = sind(gammaDeg);
  const cg = cosd(gammaDeg);
  const ge = east.map((v, i) => v * cg - north[i] * sg);
  const gn = north.map((v, i) => v * cg + east[i] * sg);
  // local: x = east, y = up, z = −north
  return [...ge, ...up, ...gn.map((v) => -v)];
}

/** Precession matrix (row-major) from J2000.0 equatorial vectors to the mean equator of `jd`, Meeus eq. 21.2–21.4. */
export function precessionMatrix(jd: number): number[] {
  const t = centuries(jd);
  const as = (x: number): number => (x / 3600) * DEG;
  const zeta = as(2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t);
  const z = as(2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t);
  const th = as(2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t);
  const cz = Math.cos(zeta);
  const sz = Math.sin(zeta);
  const cZ = Math.cos(z);
  const sZ = Math.sin(z);
  const ct = Math.cos(th);
  const st = Math.sin(th);
  // R3(−z) · R2(θ) · R3(−ζ)
  return [
    cZ * ct * cz - sZ * sz, -cZ * ct * sz - sZ * cz, -cZ * st,
    sZ * ct * cz + cZ * sz, -sZ * ct * sz + cZ * cz, -sZ * st,
    st * cz, -st * sz, ct,
  ];
}

/** Precess a J2000 place (deg) to the date. */
export function precess(ra: number, dec: number, jd: number): { ra: number; dec: number } {
  const p = precessionMatrix(jd);
  const v = [cosd(dec) * cosd(ra), cosd(dec) * sind(ra), sind(dec)];
  const x = p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
  const y = p[3] * v[0] + p[4] * v[1] + p[5] * v[2];
  const zz = p[6] * v[0] + p[7] * v[1] + p[8] * v[2];
  return { ra: norm360(Math.atan2(y, x) / DEG), dec: Math.asin(Math.max(-1, Math.min(1, zz))) / DEG };
}

export interface MoonState {
  /** topocentric altitude (deg, parallax applied, no refraction) */
  alt: number;
  /** azimuth clockwise from TRUE north (deg) */
  az: number;
  /** illuminated fraction 0…1 (Meeus 48.1) */
  k: number;
  /** phase angle i (deg): 0 full, 180 new */
  phaseAngle: number;
  /** waxing (true) or waning */
  waxing: boolean;
  /** position angle of the bright limb (deg, from celestial north toward east), Meeus eq. 48.5 */
  limbAngle: number;
  /** parallactic angle q (deg), Meeus eq. 14.1: turns the limb angle into the horizon frame (zenith angle = χ − q) */
  parallactic: number;
  /** apparent angular radius (deg) */
  radius: number;
  dist: number;
  ra: number;
  dec: number;
}

/** Julian Day of a local-mean-time clock hour at the given longitude (deg east). */
export function jdLocal(year: number, month: number, day: number, hourLocal: number, lonEast: number): number {
  return julianDay(year, month, day + (hourLocal - lonEast / 15) / 24);
}

/** The moon seen from (lat, lon) at Julian Day `jd`. */
export function moonState(jd: number, lat: number, lonEast: number): MoonState {
  const mo = moonEcliptic(jd);
  const su = sunEcliptic(jd);
  const eps = obliquity(jd);
  const eq = eclipticToEquatorial(mo.lon, mo.lat, eps);
  const sq = eclipticToEquatorial(su.lon, 0, eps);
  const lst = norm360(gmst(jd) + lonEast);
  const geo = equatorialToHorizontal(eq.ra, eq.dec, lst, lat);
  // horizontal parallax: sin π = 6378.14 / Δ; altitude lowered by ≈ π cos h
  const par = Math.asin(6378.14 / mo.dist) / DEG;
  const alt = geo.alt - par * cosd(geo.alt);
  // phase (Meeus 48.2–48.3, ecliptic form)
  const cpsi = cosd(mo.lat) * cosd(mo.lon - su.lon);
  const psi = Math.acos(Math.max(-1, Math.min(1, cpsi)));
  const i = Math.atan2(su.dist * Math.sin(psi), mo.dist - su.dist * Math.cos(psi)) / DEG;
  const k = (1 + cosd(i)) / 2;
  // bright limb (Meeus 48.5)
  const chi = Math.atan2(cosd(sq.dec) * sind(sq.ra - eq.ra), sind(sq.dec) * cosd(eq.dec) - cosd(sq.dec) * sind(eq.dec) * cosd(sq.ra - eq.ra)) / DEG;
  const h = lst - eq.ra;
  const q = Math.atan2(sind(h), Math.tan(lat * DEG) * cosd(eq.dec) - sind(eq.dec) * cosd(h)) / DEG;
  const waxing = norm360(mo.lon - su.lon) < 180;
  return { alt, az: geo.az, k, phaseAngle: i, waxing, limbAngle: norm360(chi), parallactic: q, radius: Math.asin(1737.4 / mo.dist) / DEG, dist: mo.dist, ra: eq.ra, dec: eq.dec };
}

/**
 * Illuminance of the moon on a surface facing it, outside the atmosphere (lux), Krisciunas & Schaefer 1991 eq. 9:
 * m = −12.73 + 0.026 |i| + 4·10⁻⁹ i⁴ (V magnitude at mean distance), scaled by (mean distance / Δ)² and 2.54 µlx per
 * magnitude 0. Full moon ≈ 0.31 lx above the atmosphere (≈ 0.25 lx at 60° altitude), half moon ≈ 0.03 lx.
 */
export function moonIlluminanceTop(phaseAngle: number, dist = 384400): number {
  const i = Math.abs(phaseAngle);
  const m = -12.73 + 0.026 * i + 4e-9 * i ** 4;
  return 2.54e-6 * 10 ** (-0.4 * m) * (384400 / dist) ** 2;
}

/** V-band extinction of a hazy July night (mag per air mass) [I; 0.2–0.3 at low sites, Krisciunas & Schaefer use 0.172 for Mauna Kea]. */
export const NIGHT_EXTINCTION_MAG = 0.25;

/** Moonlight on a surface facing the moon at the ground (lux): above-atmosphere value × extinction, faded while it sets. */
export function moonIlluminance(m: MoonState): number {
  if (m.alt < -1) return 0;
  const set = Math.min(1, Math.max(0, (m.alt + 1) / 1.5));
  return moonIlluminanceTop(m.phaseAngle, m.dist) * 10 ** (-0.4 * NIGHT_EXTINCTION_MAG * airmass(m.alt)) * set * set * (3 - 2 * set);
}

/** Star brightness at the ground (lux) for a V magnitude at an altitude. */
export function starIlluminance(vmag: number, altDeg: number): number {
  if (altDeg < 0) return 0;
  return 2.54e-6 * 10 ** (-0.4 * (vmag + NIGHT_EXTINCTION_MAG * airmass(altDeg)));
}

/**
 * The nearest full moon (phase angle minimum) to a Julian Day, within ±16 days, by golden-section search on the phase
 * angle sampled every 6 h. Returns its Julian Day.
 */
export function nearestFullMoon(jd: number): number {
  const phase = (x: number): number => {
    const mo = moonEcliptic(x);
    const su = sunEcliptic(x);
    return Math.abs(((mo.lon - su.lon - 180 + 540) % 360) - 180);
  };
  let best = jd;
  let bestV = Infinity;
  for (let x = jd - 16; x <= jd + 16; x += 0.25) {
    const v = phase(x);
    if (v < bestV) {
      bestV = v;
      best = x;
    }
  }
  let a = best - 0.25;
  let b = best + 0.25;
  for (let n = 0; n < 40; n++) {
    const c = b - (b - a) * 0.618034;
    const d = a + (b - a) * 0.618034;
    if (phase(c) < phase(d)) b = d;
    else a = c;
  }
  return (a + b) / 2;
}

/** The viewer's date: a Gregorian day of 1789 (or any year) and the observer. */
export interface SkyDate {
  year: number;
  month: number;
  day: number;
}

/**
 * The evening of the full moon nearest a date: the calendar day whose 23:00 local mean time lies closest to the
 * instant of full moon (phase angle minimum).
 */
export function fullMoonEvening(d: SkyDate, lonEast: number): SkyDate & { fullJd: number } {
  const jd0 = jdLocal(d.year, d.month, d.day, 23, lonEast);
  const full = nearestFullMoon(jd0);
  // the evening whose 23:00 is nearest the instant
  const off = Math.round(full - jd0);
  const c = calendarDate(julianDay(d.year, d.month, d.day) + off);
  return { year: c.year, month: c.month, day: Math.floor(c.day), fullJd: full };
}

/**
 * Moonrise and moonset (local mean time, hours 0…24 of that calendar day, or null), scanned in 5-minute steps on the
 * topocentric altitude (upper limb ignored, no refraction).
 */
export function moonRiseSet(d: SkyDate, lat: number, lonEast: number): { rise: number | null; set: number | null } {
  let rise: number | null = null;
  let set: number | null = null;
  let prev = moonState(jdLocal(d.year, d.month, d.day, 0, lonEast), lat, lonEast).alt;
  for (let m = 5; m <= 24 * 60; m += 5) {
    const h = m / 60;
    const a = moonState(jdLocal(d.year, d.month, d.day, h, lonEast), lat, lonEast).alt;
    if (prev < 0 && a >= 0 && rise === null) rise = h - (5 / 60) * (a / (a - prev));
    if (prev >= 0 && a < 0 && set === null) set = h - (5 / 60) * (a / (a - prev));
    prev = a;
  }
  return { rise, set };
}

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** German date label, e.g. "15. Juli 1789". */
export function dateLabelDe(d: SkyDate): string {
  return `${d.day}. ${MONTHS_DE[d.month - 1]} ${d.year}`;
}

const hhmm = (h: number): string => {
  const m = Math.round(h * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * German one-line moon note for the time panel, e.g. "Mond: abnehmend, 46 % beleuchtet, unter dem Horizont (Aufgang
 * 23:10 Uhr)". `hour` = the viewer's clock (local mean time).
 */
export function moonLabelDe(d: SkyDate, hour: number, lat: number, lonEast: number): string {
  const m = moonState(jdLocal(d.year, d.month, d.day, hour, lonEast), lat, lonEast);
  const pct = Math.round(m.k * 100);
  const phase = pct >= 98 ? 'Vollmond' : pct <= 2 ? 'Neumond' : `${m.waxing ? 'zunehmend' : 'abnehmend'}, ${pct} % beleuchtet`;
  if (m.alt >= 0) return `Mond: ${phase}, ${Math.round(m.alt)}° hoch`;
  const rs = moonRiseSet(d, lat, lonEast);
  const next = rs.rise !== null && rs.rise > hour ? ` (Aufgang ${hhmm(rs.rise)} Uhr)` : rs.set !== null && rs.set <= hour ? ` (Untergang ${hhmm(rs.set)} Uhr)` : '';
  return `Mond: ${phase}, unter dem Horizont${next}`;
}
