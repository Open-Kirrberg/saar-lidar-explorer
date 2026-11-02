/**
 * Pure helpers for F20 "Mein Standort" (no DOM, no three.js): AOI inside/outside test, nearest
 * point on the AOI, German distance/accuracy texts, error messages, accuracy-ring geometry and the
 * compass heading from a DeviceOrientation event.
 *
 * PRIVACY: nothing in here stores or logs a position; callers keep it in memory only.
 */

/** AOI rectangle in EPSG:25832 metres (contract: origin = lower-left corner). */
export interface AoiRect {
  Emin: number;
  Nmin: number;
  Emax: number;
  Nmax: number;
}

export function aoiRect(m: { origin: { E0: number; N0: number }; size: { width: number; height: number }; cellSize?: number }): AoiRect {
  const cs = m.cellSize ?? 1;
  return { Emin: m.origin.E0, Nmin: m.origin.N0, Emax: m.origin.E0 + m.size.width * cs, Nmax: m.origin.N0 + m.size.height * cs };
}

export function insideRect(r: AoiRect, E: number, N: number): boolean {
  return E >= r.Emin && E <= r.Emax && N >= r.Nmin && N <= r.Nmax;
}

/**
 * Nearest point of the rectangle to (E, N) (the point itself when inside), pulled `inset` metres
 * into the rectangle so a flight there lands on loaded terrain, not on its very edge.
 */
export function nearestPointInRect(r: AoiRect, E: number, N: number, inset = 0): { E: number; N: number } {
  const ix = Math.min(Math.max(inset, 0), (r.Emax - r.Emin) / 2);
  const iy = Math.min(Math.max(inset, 0), (r.Nmax - r.Nmin) / 2);
  return {
    E: Math.min(Math.max(E, r.Emin + ix), r.Emax - ix),
    N: Math.min(Math.max(N, r.Nmin + iy), r.Nmax - iy),
  };
}

/** Distance (m) from (E, N) to the rectangle; 0 inside. */
export function distanceToRect(r: AoiRect, E: number, N: number): number {
  const dx = E < r.Emin ? r.Emin - E : E > r.Emax ? E - r.Emax : 0;
  const dy = N < r.Nmin ? r.Nmin - N : N > r.Nmax ? N - r.Nmax : 0;
  return Math.hypot(dx, dy);
}

const de1 = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const de0 = (v: number) => Math.round(v).toLocaleString('de-DE');

/** "850 m" below 1 km, "12,3 km" up to 100 km, "245 km" beyond. */
export function formatDistanceDe(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '–';
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100_000) return `${de1(Math.round(m / 100) / 10)} km`;
  return `${de0(m / 1000)} km`;
}

/** "± 12 m" / "± 1,2 km". */
export function formatAccuracyDe(m: number): string {
  if (!Number.isFinite(m) || m < 0) return 'unbekannt';
  return `± ${formatDistanceDe(Math.max(1, m))}`;
}

export function outsideMessageDe(distanceM: number): string {
  return `Sie sind ${formatDistanceDe(distanceM)} außerhalb des Gebiets.`;
}

/** Why a location request failed (GeolocationPositionError codes 1–3 + our own pre-checks). */
export type LocateErrorKind = 'denied' | 'unavailable' | 'timeout' | 'insecure' | 'unsupported';

export function errorKindFromCode(code: number): LocateErrorKind {
  return code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable';
}

const HTTPS_HINT =
  'Handys geben den Standort nur über HTTPS frei: am Rechner im Ordner app/ „pnpm run dev:lan“ starten und die angezeigte https://…-Adresse öffnen.';

export function errorMessageDe(kind: LocateErrorKind): string {
  switch (kind) {
    case 'denied':
      return 'Standortzugriff abgelehnt. Erlauben Sie ihn in den Browser- bzw. Systemeinstellungen und versuchen Sie es erneut.';
    case 'unavailable':
      return 'Standort nicht verfügbar (kein GPS-/Netzsignal). Versuchen Sie es im Freien oder später erneut.';
    case 'timeout':
      return 'Standortbestimmung hat zu lange gedauert (15 s). Versuchen Sie es erneut.';
    case 'insecure':
      return `Standort braucht eine sichere Verbindung. ${HTTPS_HINT}`;
    case 'unsupported':
      return 'Dieser Browser kann den Standort nicht bestimmen.';
  }
}

/**
 * Closed ring (world x/z, first point repeated at the end) of radius r around (cx, cz).
 * Segment count follows the circumference (~`maxSeg` m per segment), clamped to [minSegs, maxSegs].
 */
export function ringPoints(cx: number, cz: number, r: number, maxSeg = 4, minSegs = 48, maxSegs = 1024): number[] {
  if (!(r > 0) || !Number.isFinite(r)) return [];
  const n = Math.min(maxSegs, Math.max(minSegs, Math.ceil((2 * Math.PI * r) / Math.max(maxSeg, 1e-3))));
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    const a = ((k % n) / n) * 2 * Math.PI;
    out.push(cx + r * Math.sin(a), cz - r * Math.cos(a));
  }
  return out;
}

/**
 * Radius actually drawn for an accuracy value: at least `min` m (a 3 m ring disappears under the
 * dot), capped at `max` m (cell-tower fixes can be several km; the ring would only be noise).
 */
export function ringRadius(accuracy: number, min = 5, max = 3000): number {
  if (!Number.isFinite(accuracy) || accuracy <= 0) return min;
  return Math.min(max, Math.max(min, accuracy));
}

/** Subset of DeviceOrientationEvent (+ Safari's webkitCompassHeading). */
export interface OrientationLike {
  alpha: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number;
}

const norm360 = (d: number) => ((d % 360) + 360) % 360;

/**
 * Compass heading (deg clockwise from north, of the top edge of the device in portrait) from a
 * DeviceOrientation event, corrected for the screen orientation angle; null when the event has
 * no absolute reference (relative `alpha` only says how far the phone turned since page load).
 * iOS: `webkitCompassHeading` is already clockwise from north (portrait). Absolute `alpha` is
 * counter-clockwise, hence 360 − alpha.
 */
export function compassHeading(e: OrientationLike, screenAngle = 0): number | null {
  let h: number | null = null;
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) h = 360 - e.alpha;
  if (h === null) return null;
  return norm360(h + (Number.isFinite(screenAngle) ? screenAngle : 0));
}

/** True bearing → heading relative to UTM grid north (camera/world headings are grid headings). */
export function trueToGridHeading(trueDeg: number, convergenceDeg: number): number {
  return norm360(trueDeg - convergenceDeg);
}

/**
 * Screen-space rotation (deg, clockwise from screen-up) of a world direction given two projected
 * points in CSS px (y down): the anchor and a point a few metres ahead.
 */
export function screenAngleDeg(ax: number, ay: number, bx: number, by: number): number {
  return norm360((Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI);
}

/** Should a follow-mode update recentre the camera? Only after a real move (> `minMove` m). */
export function shouldRecenter(last: { E: number; N: number } | null, E: number, N: number, minMove = 15): boolean {
  return !last || Math.hypot(E - last.E, N - last.N) > minMove;
}

/** Camera pose as it appears in the URL hash / share link (store fields, true scale). */
export interface PoseLike {
  E: number;
  N: number;
  /** Camera height (m ü. NN, true scale). */
  h: number;
  /** Degrees clockwise from grid north. */
  heading: number;
  /** Degrees, negative = looking down. */
  pitch: number;
}

/**
 * Privacy radius (m): while the camera or the ground point in the view centre is closer than this
 * to the user's position, the pose is not written to the URL hash or a share link.
 */
export const PRIVACY_RADIUS_M = 1000;

/**
 * Would publishing `pose` (URL hash, "Ansicht teilen") reveal the private point (E, N)? True when
 * the camera, or the ground point under the view centre (centre ray intersected with the plane at
 * `groundH`), lies within `radius` m. Fails closed (true) on non-finite input.
 */
export function poseRevealsPoint(pose: PoseLike, E: number, N: number, groundH: number, radius = PRIVACY_RADIUS_M): boolean {
  const vals = [pose.E, pose.N, pose.h, pose.heading, pose.pitch, E, N, groundH, radius];
  if (!vals.every(Number.isFinite)) return true;
  if (Math.hypot(pose.E - E, pose.N - N) < radius) return true;
  const drop = pose.h - groundH;
  const down = Math.tan((-pose.pitch * Math.PI) / 180);
  if (!(drop > 0) || !(down > 1e-6)) return false; // camera below the plane or looking at/above the horizon
  const reach = drop / down;
  const hd = (pose.heading * Math.PI) / 180;
  const tE = pose.E + reach * Math.sin(hd);
  const tN = pose.N + reach * Math.cos(hd);
  return Math.hypot(tE - E, tN - N) < radius;
}
