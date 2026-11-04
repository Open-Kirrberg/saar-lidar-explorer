/**
 * Pure maths of the game minimap (V2.3, ADR 0036): camera heading → map bearing incl. grid
 * convergence, north-up / heading-up rotation, FOV-correct view cone, and the inverse rotation for
 * click-to-fly on a CSS-rotated Leaflet container. No Leaflet, no DOM.
 *
 * Angles are degrees, clockwise. `heading` (store / DroneController) is relative to UTM grid north;
 * The on-map bearing (`mapBearingDeg`) is the on-screen angle on a north-up Leaflet map.
 */
import { utmToWgs84 } from '../geo';

export type MapMode = 'north' | 'heading';

/** Normalise to [0, 360). */
export function normDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r === 0 ? 0 : r;
}

/** Signed smallest difference a − b in (−180, 180]. */
export function diffDeg(a: number, b: number): number {
  const d = normDeg(a - b);
  return d > 180 ? d - 360 : d;
}

/** Web Mercator (EPSG:3857, Leaflet's CRS) metres, y up. */
function mercator(lat: number, lon: number): { x: number; y: number } {
  const R = 6378137;
  return { x: (R * lon * Math.PI) / 180, y: R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) };
}

/**
 * On-map bearing (clockwise from map north, i.e. screen-up on a north-up Leaflet map) of a grid
 * heading at (E, N). Projects a 10 m step along the heading into Web Mercator, so it includes the
 * grid convergence (≈ −1.2° here) and the small ellipsoid-vs-sphere skew of Web Mercator
 * (≤ 0.1°) that `heading + gridConvergenceDeg` alone misses.
 */
export function mapBearingDeg(gridHeading: number, E: number, N: number): number {
  const h = (gridHeading * Math.PI) / 180;
  const a = utmToWgs84(E, N);
  const b = utmToWgs84(E + 10 * Math.sin(h), N + 10 * Math.cos(h));
  const pa = mercator(a.lat, a.lon);
  const pb = mercator(b.lat, b.lon);
  return normDeg((Math.atan2(pb.x - pa.x, pb.y - pa.y) * 180) / Math.PI);
}

/** CSS rotation of the map container: heading-up turns the map so the view direction points up. */
export function mapRotationDeg(mode: MapMode, bearing: number): number {
  return mode === 'heading' ? -bearing : 0;
}

/**
 * Pose of the minimap for a camera: `mapRotation` (CSS rotate of the Leaflet container),
 * `arrow` (rotation of the player arrow + cone inside the map) and `screen` (resulting on-screen
 * angle of the arrow = arrow + mapRotation; heading-up → 0, north-up → true bearing).
 */
export function minimapPose(mode: MapMode, gridHeading: number, E: number, N: number) {
  const bearing = mapBearingDeg(gridHeading, E, N);
  const mapRotation = mapRotationDeg(mode, bearing);
  return { bearing, mapRotation, arrow: bearing, screen: normDeg(bearing + mapRotation) };
}

/** Horizontal field of view (deg) from a vertical FOV (deg) and the aspect ratio (w / h). */
export function horizontalFovDeg(vfovDeg: number, aspect: number): number {
  const v = (vfovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(v / 2) * aspect) * 180) / Math.PI;
}

/**
 * SVG path of a view cone pointing up (−y) from (0, 0): circular sector with the given full opening
 * angle (deg, clamped to 1…179) and radius (px).
 */
export function wedgePath(fovDeg: number, radius: number): string {
  const half = (Math.min(Math.max(fovDeg, 1), 179) / 2) * (Math.PI / 180);
  const x = radius * Math.sin(half);
  const y = -radius * Math.cos(half);
  const f = (n: number) => Number(n.toFixed(2));
  return `M0,0 L${f(-x)},${f(y)} A${f(radius)},${f(radius)} 0 0 1 ${f(x)},${f(y)} Z`;
}

/**
 * Click on a rotated map → Leaflet container point. `dx`, `dy` = click offset (screen px) from the
 * container centre (rotation keeps the centre); `rotation` = the container's CSS rotation (deg);
 * `w`, `h` = the container's own (unrotated) size.
 */
export function unrotatePoint(dx: number, dy: number, rotation: number, w: number, h: number): { x: number; y: number } {
  const r = (-rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // CSS rotate(θ) maps (x, y) → (x cosθ − y sinθ, x sinθ + y cosθ) in y-down screen space.
  return { x: w / 2 + dx * c - dy * s, y: h / 2 + dx * s + dy * c };
}

/** Screen position (relative to the dial centre) of the north badge on the rim for a map rotation. */
export function northBadgeOffset(rotation: number, radius: number): { x: number; y: number } {
  const a = (rotation * Math.PI) / 180;
  return { x: radius * Math.sin(a), y: -radius * Math.cos(a) };
}
