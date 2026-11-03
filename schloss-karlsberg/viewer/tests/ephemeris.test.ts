/** Wave 10 (audit rank 5): the moon and the night sky of 1789 (viewer/src/ephemeris.ts, nightSky.ts). */
import { describe, expect, it } from 'vitest';
import { calendarDate, dateLabelDe, fullMoonEvening, jdLocal, julianDay, moonEcliptic, moonIlluminance, moonLabelDe, moonRiseSet, moonState, nearestFullMoon, starIlluminance } from '../src/ephemeris.ts';
import { KARLSBERG_LAT, KARLSBERG_LON } from '../src/sun.ts';
import { STAR_SPOT, starKelvin, starSpot } from '../src/nightSky.ts';
import { STAR_COUNT, STARS } from '../src/starCatalogue.ts';

const LAT = KARLSBERG_LAT;
const LON = KARLSBERG_LON;

describe('ephemeris (Meeus)', () => {
  it('Julian Day round trip (Meeus example 7.a: 1957 Oct 4.81 = JD 2436116.31)', () => {
    expect(julianDay(1957, 10, 4.81)).toBeCloseTo(2436116.31, 6);
    const c = calendarDate(2436116.31);
    expect(c.year).toBe(1957);
    expect(c.month).toBe(10);
    expect(c.day).toBeCloseTo(4.81, 6);
  });

  it('reproduces Meeus example 47.a (1992 April 12, 0h TD) with the truncated series', () => {
    const m = moonEcliptic(2448724.5);
    expect(m.lon).toBeCloseTo(133.162655, 1);
    expect(m.lat).toBeCloseTo(-3.229126, 2);
    expect(Math.abs(m.dist - 368409.7)).toBeLessThan(60);
  });

  it('illuminated fraction of Meeus example 48.a (k = 0.6786)', () => {
    expect(moonState(2448724.5, LAT, LON).k).toBeCloseTo(0.6786, 2);
  });

  it('15 July 1789: a waning moon (≈ 46 %), below the horizon at 22:00 and 23:00, rising ≈ 23:09', () => {
    for (const h of [22, 23]) {
      const m = moonState(jdLocal(1789, 7, 15, h, LON), LAT, LON);
      expect(m.alt).toBeLessThan(0);
      expect(m.waxing).toBe(false);
      expect(m.k).toBeGreaterThan(0.4);
      expect(m.k).toBeLessThan(0.52);
      expect(moonIlluminance(m)).toBe(0);
    }
    const rs = moonRiseSet({ year: 1789, month: 7, day: 15 }, LAT, LON);
    expect(rs.rise).not.toBeNull();
    expect(Math.abs(rs.rise! - (23 + 9 / 60))).toBeLessThan(0.25);
    expect(moonLabelDe({ year: 1789, month: 7, day: 15 }, 22, LAT, LON)).toMatch(/^Mond: abnehmend, 4\d % beleuchtet, unter dem Horizont \(Aufgang 23:\d\d Uhr\)$/);
  });

  it('the nearest full moon is 7 July 1789; its evening is 6 July, the moon well up at 23:00', () => {
    const full = nearestFullMoon(jdLocal(1789, 7, 15, 23, LON));
    const c = calendarDate(full);
    expect(c.year).toBe(1789);
    expect(c.month).toBe(7);
    expect(Math.floor(c.day)).toBe(7);
    const ev = fullMoonEvening({ year: 1789, month: 7, day: 15 }, LON);
    expect([ev.year, ev.month, ev.day]).toEqual([1789, 7, 6]);
    expect(dateLabelDe(ev)).toBe('6. Juli 1789');
    const m = moonState(jdLocal(1789, 7, 6, 23, LON), LAT, LON);
    expect(m.k).toBeGreaterThan(0.98);
    expect(m.alt).toBeGreaterThan(12);
    // full moon light: ≈ 0.05–0.3 lx at the ground
    const lux = moonIlluminance(m);
    expect(lux).toBeGreaterThan(0.05);
    expect(lux).toBeLessThan(0.3);
  });

  it('stars: Vega (V 0.03) gives ≈ 2 µlx overhead, nothing below the horizon', () => {
    expect(starIlluminance(0.03, 90)).toBeGreaterThan(1.8e-6);
    expect(starIlluminance(0.03, 90)).toBeLessThan(2.6e-6);
    expect(starIlluminance(0.03, -1)).toBe(0);
  });
});

describe('night sky', () => {
  it('star catalogue: the HYG stars brighter than V 5, finite J2000 positions', () => {
    expect(STAR_COUNT).toBeGreaterThan(1500);
    expect(STARS.length).toBe(STAR_COUNT * 4);
    for (let i = 0; i < STAR_COUNT; i++) {
      expect(STARS[i * 4 + 2]).toBeLessThan(5.01);
      expect(STARS[i * 4]).toBeGreaterThanOrEqual(0);
      expect(STARS[i * 4]).toBeLessThan(360);
      expect(Math.abs(STARS[i * 4 + 1])).toBeLessThanOrEqual(90);
    }
  });

  it('star colour from B−V (Ballesteros): the sun ≈ 5800 K, Vega (−0.0) ≈ 9600 K, red giants cool', () => {
    expect(starKelvin(0.65)).toBeGreaterThan(5500);
    expect(starKelvin(0.65)).toBeLessThan(6100);
    expect(starKelvin(0)).toBeGreaterThan(9000);
    expect(starKelvin(1.6)).toBeLessThan(3800);
  });

  it('star spots keep their energy: faint stars stay at the minimum size, bright ones grow up to the cap', () => {
    const faint = starSpot(0.5);
    expect(faint.size).toBe(STAR_SPOT.minPx);
    expect(faint.peak * 0.55 * faint.size ** 2).toBeCloseTo(0.5, 6);
    const bright = starSpot(200);
    expect(bright.size).toBeGreaterThan(STAR_SPOT.minPx);
    expect(bright.size).toBeLessThanOrEqual(STAR_SPOT.maxPx);
  });
});
