import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { gridConvergenceDeg, utmToWgs84 } from '../src/geo';
import {
  diffDeg,
  horizontalFovDeg,
  minimapPose,
  northBadgeOffset,
  normDeg,
  unrotatePoint,
  wedgePath,
} from '../src/map/bearing';

/** Web Mercator (EPSG:3857) metres, y up. Independent of Leaflet and of src/map/bearing.ts. */
function mercator(lat: number, lon: number): { x: number; y: number } {
  const R = 6378137;
  return { x: (R * lon * Math.PI) / 180, y: R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) };
}

/**
 * Ground truth: orient a three.js camera exactly like DroneController (rotation YXZ = pitch, −heading),
 * take its forward vector in the world frame (x = E − E0, z = −(N − N0)), step 20 m along it in
 * UTM, project both ends to Web Mercator and measure the on-screen angle (clockwise from up).
 */
function screenAngleOfCameraForward(E: number, N: number, heading: number, pitch: number): number {
  const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  cam.rotation.set(pitch * MathUtils.DEG2RAD, -heading * MathUtils.DEG2RAD, 0, 'YXZ');
  cam.updateMatrixWorld();
  const f = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const len = Math.hypot(f.x, f.z);
  const dE = (f.x / len) * 20;
  const dN = (-f.z / len) * 20;
  const a = utmToWgs84(E, N);
  const b = utmToWgs84(E + dE, N + dN);
  const pa = mercator(a.lat, a.lon);
  const pb = mercator(b.lat, b.lon);
  return normDeg((Math.atan2(pb.x - pa.x, pb.y - pa.y) * 180) / Math.PI);
}

// Corners, centre and edges of the `overall` AOI (E0 378000, N0 5460000, 6 × 8 km) plus Homburg/RLP margins.
const SPOTS: Array<[number, number]> = [
  [378000, 5460000],
  [384000, 5468000],
  [381000, 5464000],
  [378000, 5468000],
  [384000, 5460000],
  [372000, 5455000],
  [392000, 5475000],
];
const HEADINGS = [0, 1.2, 37, 90, 179.5, 180, 223, 270, 358.8];

describe('game minimap: heading matches 3D within 1° (incl. grid convergence)', () => {
  it('north-up: player arrow on screen = camera forward on the map', () => {
    let worst = 0;
    for (const [E, N] of SPOTS)
      for (const h of HEADINGS)
        for (const pitch of [-89, -35, 0]) {
          const truth = screenAngleOfCameraForward(E, N, h, pitch);
          const pose = minimapPose('north', h, E, N);
          expect(pose.mapRotation).toBe(0);
          const err = Math.abs(diffDeg(pose.screen, truth));
          worst = Math.max(worst, err);
        }
    expect(worst).toBeLessThan(1);
    expect(worst).toBeLessThan(0.05); // in practice it is exact up to the 20 m chord
  });

  it('heading-up: rotated map puts the camera forward straight up, and so does the arrow', () => {
    let worst = 0;
    for (const [E, N] of SPOTS)
      for (const h of HEADINGS) {
        const truth = screenAngleOfCameraForward(E, N, h, -30);
        const pose = minimapPose('heading', h, E, N);
        // The map container is CSS-rotated by mapRotation: every map direction turns with it.
        const forwardOnScreen = normDeg(truth + pose.mapRotation);
        worst = Math.max(worst, Math.abs(diffDeg(forwardOnScreen, 0)), Math.abs(diffDeg(pose.screen, forwardOnScreen)));
      }
    expect(worst).toBeLessThan(1);
    expect(worst).toBeLessThan(0.05);
  });

  it('grid convergence matters: ignoring it would be off by > 1° here', () => {
    for (const [E, N] of SPOTS) {
      const c = gridConvergenceDeg(E, N);
      expect(c).toBeLessThan(-1);
      expect(c).toBeGreaterThan(-1.6);
      const truth = screenAngleOfCameraForward(E, N, 90, -30);
      expect(Math.abs(diffDeg(90, truth))).toBeGreaterThan(1);
    }
  });
});

describe('game minimap helpers', () => {
  it('normDeg / diffDeg', () => {
    expect(normDeg(-1)).toBe(359);
    expect(normDeg(720)).toBe(0);
    expect(diffDeg(1, 359)).toBeCloseTo(2);
    expect(diffDeg(359, 1)).toBeCloseTo(-2);
  });

  it('horizontal FOV from vertical FOV + aspect', () => {
    expect(horizontalFovDeg(60, 1)).toBeCloseTo(60, 6);
    expect(horizontalFovDeg(60, 16 / 9)).toBeCloseTo(91.49, 1);
    expect(horizontalFovDeg(60, 390 / 844)).toBeCloseTo(29.9, 0);
  });

  it('wedge path opens symmetrically to the given angle', () => {
    const p = wedgePath(90, 100);
    const m = p.match(/L(-?[\d.]+),(-?[\d.]+) A[\d.]+,[\d.]+ 0 0 1 (-?[\d.]+),(-?[\d.]+)/)!;
    const [x1, y1, x2, y2] = m.slice(1).map(Number);
    expect(x1).toBeCloseTo(-70.71, 1);
    expect(x2).toBeCloseTo(70.71, 1);
    expect(y1).toBeCloseTo(-70.71, 1);
    expect(y2).toBeCloseTo(y1, 6);
    const half = (Math.atan2(x2, -y2) * 180) / Math.PI;
    expect(half * 2).toBeCloseTo(90, 1);
  });

  it('click on a rotated map maps back to the unrotated container point', () => {
    const w = 180;
    const h = 180;
    for (const rot of [0, -37, 90, -200]) {
      // A container point p ends up on screen at centre + R(rot)·(p − centre).
      const p = { x: 140, y: 30 };
      const r = (rot * Math.PI) / 180;
      const ox = p.x - w / 2;
      const oy = p.y - h / 2;
      const sx = ox * Math.cos(r) - oy * Math.sin(r);
      const sy = ox * Math.sin(r) + oy * Math.cos(r);
      const q = unrotatePoint(sx, sy, rot, w, h);
      expect(q.x).toBeCloseTo(p.x, 6);
      expect(q.y).toBeCloseTo(p.y, 6);
    }
  });

  it('north badge sits where north is on screen', () => {
    const up = northBadgeOffset(0, 80);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-80);
    // Heading east → map rotated −90° → north is on the left.
    const left = northBadgeOffset(-90, 80);
    expect(Math.abs(diffDeg(minimapPose('heading', 90, 381000, 5464000).mapRotation, -90))).toBeLessThan(1.5);
    expect(left.x).toBeCloseTo(-80, 3);
    expect(left.y).toBeCloseTo(0, 3);
  });
});
