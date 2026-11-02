import { describe, expect, it } from 'vitest';
import { utmToWgs84, utmToWorld, wgs84ToUtm } from '../src/geo';
import {
  aoiRect,
  compassHeading,
  distanceToRect,
  errorKindFromCode,
  errorMessageDe,
  formatAccuracyDe,
  formatDistanceDe,
  insideRect,
  nearestPointInRect,
  outsideMessageDe,
  PRIVACY_RADIUS_M,
  poseRevealsPoint,
  ringPoints,
  ringRadius,
  screenAngleDeg,
  shouldRecenter,
  trueToGridHeading,
} from '../src/locate/locateMath';

// Karlsberg AOI: origin = lower-left corner (contract), 3 × 3 km.
const KARLSBERG = { origin: { E0: 381000, N0: 5465000 }, size: { width: 3000, height: 3000 }, cellSize: 1 };
const R = aoiRect(KARLSBERG);

describe('aoiRect / insideRect', () => {
  it('uses origin as lower-left corner and size × cellSize', () => {
    expect(R).toEqual({ Emin: 381000, Nmin: 5465000, Emax: 384000, Nmax: 5468000 });
    expect(aoiRect({ ...KARLSBERG, cellSize: 2 }).Emax).toBe(387000);
  });
  it('inside incl. edges, outside beyond', () => {
    expect(insideRect(R, 382500, 5466500)).toBe(true);
    expect(insideRect(R, 381000, 5468000)).toBe(true);
    expect(insideRect(R, 380999.9, 5466000)).toBe(false);
    expect(insideRect(R, 382000, 5468000.1)).toBe(false);
  });
  it('a real WGS84 position (Schloss Karlsberg area) lands inside, in the world frame', () => {
    // GPS fix 500 m east / 2000 m north of the lower-left corner (via WGS84, as the browser delivers it)
    const ll = utmToWgs84(381500, 5467000);
    const { E, N } = wgs84ToUtm(ll.lat, ll.lon);
    expect(insideRect(R, E, N)).toBe(true);
    const w = utmToWorld(E, N, KARLSBERG.origin);
    expect(w.x).toBeCloseTo(500, 3);
    expect(w.z).toBeCloseTo(-2000, 3); // z = −(N − N0)
    // ~2 km further west is outside
    const west = wgs84ToUtm(ll.lat, ll.lon - 0.035);
    expect(insideRect(R, west.E, west.N)).toBe(false);
  });
});

describe('distance / nearest point', () => {
  it('is 0 inside and Euclidean to the nearest edge/corner outside', () => {
    expect(distanceToRect(R, 382000, 5466000)).toBe(0);
    expect(distanceToRect(R, 380000, 5466000)).toBe(1000); // west of the AOI
    expect(distanceToRect(R, 382000, 5470000)).toBe(2000); // north
    expect(distanceToRect(R, 384000 + 3000, 5465000 - 4000)).toBe(5000); // SE corner, 3-4-5
  });
  it('nearest point clamps onto the rectangle, inset pulls it inside', () => {
    expect(nearestPointInRect(R, 380000, 5466000)).toEqual({ E: 381000, N: 5466000 });
    expect(nearestPointInRect(R, 390000, 5460000, 150)).toEqual({ E: 383850, N: 5465150 });
    expect(nearestPointInRect(R, 382000, 5466000, 150)).toEqual({ E: 382000, N: 5466000 });
    // inset larger than half the AOI → centre
    expect(nearestPointInRect(R, 0, 0, 1e6)).toEqual({ E: 382500, N: 5466500 });
    const p = nearestPointInRect(R, 395000, 5480000, 150);
    expect(insideRect(R, p.E, p.N)).toBe(true);
  });
});

describe('German texts', () => {
  it('formats distances', () => {
    expect(formatDistanceDe(0)).toBe('0 m');
    expect(formatDistanceDe(849.6)).toBe('850 m');
    expect(formatDistanceDe(12_340)).toBe('12,3 km');
    expect(formatDistanceDe(1000)).toBe('1,0 km');
    expect(formatDistanceDe(245_400)).toBe('245 km');
    expect(formatDistanceDe(1_234_567)).toBe('1.235 km');
    expect(formatDistanceDe(NaN)).toBe('–');
  });
  it('outside message and accuracy', () => {
    expect(outsideMessageDe(12_300)).toBe('Sie sind 12,3 km außerhalb des Gebiets.');
    expect(formatAccuracyDe(12.4)).toBe('± 12 m');
    expect(formatAccuracyDe(0.3)).toBe('± 1 m');
    expect(formatAccuracyDe(1500)).toBe('± 1,5 km');
    expect(formatAccuracyDe(NaN)).toBe('unbekannt');
  });
  it('maps geolocation error codes and explains HTTPS', () => {
    expect(errorKindFromCode(1)).toBe('denied');
    expect(errorKindFromCode(2)).toBe('unavailable');
    expect(errorKindFromCode(3)).toBe('timeout');
    expect(errorKindFromCode(99)).toBe('unavailable');
    expect(errorMessageDe('insecure')).toMatch(/HTTPS/);
    expect(errorMessageDe('insecure')).toMatch(/dev:lan/);
    for (const k of ['denied', 'unavailable', 'timeout', 'insecure', 'unsupported'] as const) expect(errorMessageDe(k).length).toBeGreaterThan(10);
  });
});

describe('ring geometry', () => {
  it('is closed, has radius r and starts north (−z)', () => {
    const pts = ringPoints(100, -200, 50);
    const n = pts.length / 2;
    expect(n).toBeGreaterThan(48);
    expect(pts[0]).toBeCloseTo(100);
    expect(pts[1]).toBeCloseTo(-250); // north = −z
    expect(pts[pts.length - 2]).toBeCloseTo(pts[0]);
    expect(pts[pts.length - 1]).toBeCloseTo(pts[1]);
    for (let k = 0; k < n; k++) expect(Math.hypot(pts[2 * k] - 100, pts[2 * k + 1] + 200)).toBeCloseTo(50, 6);
    // a quarter turn clockwise (seen from above, north up) is east (+x): 48 segments at r = 5
    const small = ringPoints(100, -200, 5);
    expect(small[2 * 12]).toBeCloseTo(105);
    expect(small[2 * 12 + 1]).toBeCloseTo(-200);
  });
  it('segment count follows the circumference within limits', () => {
    expect(ringPoints(0, 0, 5).length / 2 - 1).toBe(48);
    expect(ringPoints(0, 0, 400, 4).length / 2 - 1).toBe(Math.ceil((2 * Math.PI * 400) / 4));
    expect(ringPoints(0, 0, 1e6).length / 2 - 1).toBe(1024);
    expect(ringPoints(0, 0, 0)).toEqual([]);
    expect(ringPoints(0, 0, NaN)).toEqual([]);
  });
  it('ring radius clamps tiny and huge accuracies', () => {
    expect(ringRadius(2)).toBe(5);
    expect(ringRadius(40)).toBe(40);
    expect(ringRadius(20000)).toBe(3000);
    expect(ringRadius(NaN)).toBe(5);
  });
});

describe('compass / headings', () => {
  it('prefers iOS webkitCompassHeading, else absolute alpha (counter-clockwise)', () => {
    expect(compassHeading({ alpha: 10, webkitCompassHeading: 90 })).toBe(90);
    expect(compassHeading({ alpha: 90, absolute: true })).toBe(270);
    expect(compassHeading({ alpha: 0, absolute: true })).toBe(0);
    expect(compassHeading({ alpha: 90, absolute: false })).toBeNull(); // relative only
    expect(compassHeading({ alpha: null, absolute: true })).toBeNull();
  });
  it('adds the screen orientation angle', () => {
    expect(compassHeading({ alpha: null, webkitCompassHeading: 350 }, 90)).toBe(80);
    expect(compassHeading({ alpha: 90, absolute: true }, -90)).toBe(180);
  });
  it('true → grid heading subtracts the convergence (≈ −1.2° here)', () => {
    expect(trueToGridHeading(0, -1.2)).toBeCloseTo(1.2);
    expect(trueToGridHeading(359.5, -1.2)).toBeCloseTo(0.7);
  });
  it('screen angle: up = 0, right = 90, down = 180, left = 270', () => {
    expect(screenAngleDeg(100, 100, 100, 50)).toBeCloseTo(0);
    expect(screenAngleDeg(100, 100, 150, 100)).toBeCloseTo(90);
    expect(screenAngleDeg(100, 100, 100, 150)).toBeCloseTo(180);
    expect(screenAngleDeg(100, 100, 50, 100)).toBeCloseTo(270);
  });
  it('follow mode recentres only after a real move', () => {
    expect(shouldRecenter(null, 0, 0)).toBe(true);
    expect(shouldRecenter({ E: 0, N: 0 }, 10, 10)).toBe(false);
    expect(shouldRecenter({ E: 0, N: 0 }, 12, 12)).toBe(true);
  });
});

describe('poseRevealsPoint (URL hash / share privacy)', () => {
  // The deterministic "Mein Standort" flight: 150 m south of the fix, 150 m above ground, pitch −45, heading 0.
  const fix = { E: 381789.73, N: 5462133.64, g: 300 };
  const flown = { E: fix.E, N: fix.N - 150, h: fix.g + 150, heading: 0, pitch: -45 };

  it('flags the pose right after the locate flight', () => {
    expect(poseRevealsPoint(flown, fix.E, fix.N, fix.g)).toBe(true);
  });

  it('flags a far camera whose view centre lands on the user', () => {
    // 2 km south, 2 km up, pitch −45 → centre ray hits the ground at the fix.
    const far = { E: fix.E, N: fix.N - 2000, h: fix.g + 2000, heading: 0, pitch: -45 };
    expect(poseRevealsPoint(far, fix.E, fix.N, fix.g)).toBe(true);
    // Same camera looking the other way (south): centre 4 km from the user.
    expect(poseRevealsPoint({ ...far, heading: 180 }, fix.E, fix.N, fix.g)).toBe(false);
  });

  it('releases once camera and view centre are beyond the radius', () => {
    const away = { E: fix.E + PRIVACY_RADIUS_M + 50, N: fix.N, h: fix.g + 150, heading: 90, pitch: -45 };
    expect(poseRevealsPoint(away, fix.E, fix.N, fix.g)).toBe(false);
    // Looking at the horizon (no ground target) from far away.
    expect(poseRevealsPoint({ ...away, heading: 270, pitch: 0 }, fix.E, fix.N, fix.g)).toBe(false);
  });

  it('fails closed on non-finite input', () => {
    expect(poseRevealsPoint({ ...flown, E: NaN }, fix.E, fix.N, fix.g)).toBe(true);
    expect(poseRevealsPoint({ ...flown, E: fix.E + 5000 }, fix.E, fix.N, NaN)).toBe(true);
  });
});
