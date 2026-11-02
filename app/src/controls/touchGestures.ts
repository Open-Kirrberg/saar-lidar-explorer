/**
 * Pure gesture math for the F20 touch navigation (TouchController). No three.js / DOM imports.
 *
 * World frame as everywhere in the app: +x east, +y up (display metres, exaggeration applied),
 * −z north. Headings are degrees clockwise from grid north (seen from above), pitch negative = down.
 * Screen coordinates are CSS pixels with y pointing down.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface XZ {
  x: number;
  z: number;
}

export interface Pt {
  x: number;
  y: number;
}

const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle in degrees to (−180, 180]. */
export function wrapDeg180(d: number): number {
  const w = ((((d + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

/**
 * Where a ray meets the horizontal plane `y = planeY` (x/z only). If the ray points away from the
 * plane or meets it further than `maxDist` horizontally, the point at horizontal distance `maxDist`
 * along the ray's horizontal direction is returned instead (keeps near-horizon drags bounded).
 * Returns null only for a vertical ray that can't reach the plane.
 */
export function rayPlaneHit(o: V3, d: V3, planeY: number, maxDist: number): XZ | null {
  const hl = Math.hypot(d.x, d.z);
  const t = d.y !== 0 ? (planeY - o.y) / d.y : Number.POSITIVE_INFINITY;
  if (t > 0 && Number.isFinite(t) && t * hl <= maxDist) return { x: o.x + d.x * t, z: o.z + d.z * t };
  if (hl < 1e-9) return null;
  return { x: o.x + (d.x / hl) * maxDist, z: o.z + (d.z / hl) * maxDist };
}

/**
 * One-finger "grab" pan: the horizontal camera offset that puts the grabbed ground point `anchor`
 * back under the finger whose current view ray is (o, d). The plane through the anchor is kept
 * below the camera so the ray can reach it.
 */
export function panOffset(o: V3, d: V3, anchor: V3, maxDist: number): XZ | null {
  const planeY = Math.min(anchor.y, o.y - 0.5);
  const hit = rayPlaneHit(o, d, planeY, maxDist);
  if (!hit) return null;
  return { x: anchor.x - hit.x, z: anchor.z - hit.z };
}

/** Pinch zoom factor for the camera→pivot distance: fingers apart (cur > prev) → < 1 (closer). */
export function pinchScale(prevDist: number, curDist: number): number {
  if (!(prevDist > 1) || !(curDist > 1)) return 1;
  return prevDist / curDist;
}

/** Move `pos` along the line to `pivot` so its distance becomes `dist·s`, clamped to [minDist, maxDist]. */
export function zoomToward(pos: V3, pivot: V3, s: number, minDist: number, maxDist: number): V3 {
  const vx = pos.x - pivot.x;
  const vy = pos.y - pivot.y;
  const vz = pos.z - pivot.z;
  const len = Math.hypot(vx, vy, vz);
  if (len < 1e-9) return { ...pos };
  // Clamp to [minDist, maxDist], but never push the camera the "wrong" way if it already is outside
  // (e.g. closer than minDist after a flyTo): zooming in can't move out, zooming out can't move in.
  const nl = s < 1 ? Math.max(len * s, Math.min(minDist, len)) : Math.min(len * s, Math.max(maxDist, len));
  const k = nl / len;
  return { x: pivot.x + vx * k, y: pivot.y + vy * k, z: pivot.z + vz * k };
}

/** Screen-space angle change (deg, clockwise on screen positive) of the finger vector a→b. */
export function twistDelta(prevA: Pt, prevB: Pt, curA: Pt, curB: Pt): number {
  const a0 = Math.atan2(prevB.y - prevA.y, prevB.x - prevA.x);
  const a1 = Math.atan2(curB.y - curA.y, curB.x - curA.x);
  return wrapDeg180((a1 - a0) / DEG);
}

/** Rotate a horizontal vector clockwise (seen from above) by `deg` — same sense as a heading change. */
export function rotateCW(v: XZ, deg: number): XZ {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}

/** Orbit `pos` around the vertical axis through `pivot` by a heading change `dHeading` (deg). */
export function orbitYaw(pos: V3, pivot: XZ, dHeading: number): V3 {
  const r = rotateCW({ x: pos.x - pivot.x, z: pos.z - pivot.z }, dHeading);
  return { x: pivot.x + r.x, y: pos.y, z: pivot.z + r.z };
}

/** Unit view direction for heading/pitch (matches DroneController: rotation order YXZ). */
export function forward(headingDeg: number, pitchDeg: number): V3 {
  const h = headingDeg * DEG;
  const p = pitchDeg * DEG;
  const c = Math.cos(p);
  return { x: Math.sin(h) * c, y: Math.sin(p), z: -Math.cos(h) * c };
}

/** Camera position looking at `pivot` from distance `r` with the given heading/pitch. */
export function orbitPosition(pivot: V3, r: number, headingDeg: number, pitchDeg: number): V3 {
  const f = forward(headingDeg, pitchDeg);
  return { x: pivot.x - f.x * r, y: pivot.y - f.y * r, z: pivot.z - f.z * r };
}

/** Tilt (pitch) limits while orbiting a ground pivot with two fingers. */
export const TILT_MIN = -89;
export const TILT_MAX = -4;
/** Pitch change per pixel of a two-finger vertical drag (drag up → towards the horizon). */
export const TILT_DEG_PER_PX = 0.25;

export function tiltPitch(pitch: number, dyPx: number, degPerPx = TILT_DEG_PER_PX): number {
  // Upper limit: TILT_MAX, or the current pitch if it is already higher (never tilt further up).
  return clamp(pitch - dyPx * degPerPx, TILT_MIN, Math.max(TILT_MAX, pitch));
}

export type TwoFingerKind = 'undecided' | 'tilt' | 'transform';

/**
 * Decide what a two-finger gesture is once the fingers have moved `threshold` px:
 * - 'tilt': both fingers move vertically in the same direction, roughly side by side, without
 *   much spreading (Google-Maps-style tilt);
 * - 'transform': anything else (pinch zoom + twist rotate + two-finger pan).
 */
export function classifyTwoFinger(startA: Pt, startB: Pt, curA: Pt, curB: Pt, threshold = 12): TwoFingerKind {
  const dA = { x: curA.x - startA.x, y: curA.y - startA.y };
  const dB = { x: curB.x - startB.x, y: curB.y - startB.y };
  const moved = Math.max(Math.hypot(dA.x, dA.y), Math.hypot(dB.x, dB.y));
  if (moved < threshold) return 'undecided';
  const spread = Math.abs(Math.hypot(curB.x - curA.x, curB.y - curA.y) - Math.hypot(startB.x - startA.x, startB.y - startA.y));
  const sameDir = Math.sign(dA.y) === Math.sign(dB.y) && dA.y !== 0;
  const vertical = Math.abs(dA.y) > 1.5 * Math.abs(dA.x) && Math.abs(dB.y) > 1.5 * Math.abs(dB.x);
  const sideBySide = Math.abs(startB.y - startA.y) < Math.abs(startB.x - startA.x);
  const meanDy = (Math.abs(dA.y) + Math.abs(dB.y)) / 2;
  if (sameDir && vertical && sideBySide && spread < 0.5 * meanDy) return 'tilt';
  return 'transform';
}

// ---- inertia ----------------------------------------------------------------------------------

export interface Sample {
  /** ms */
  t: number;
  x: number;
  z: number;
}

/**
 * Release velocity (m/s) of a pan from position samples: the slope over the last `windowMs`.
 * Zero when the finger rested longer than `restMs` before release or there's too little data.
 */
export function releaseVelocity(samples: readonly Sample[], nowMs: number, windowMs = 90, restMs = 60): XZ {
  const last = samples[samples.length - 1];
  if (!last || nowMs - last.t > restMs) return { x: 0, z: 0 };
  let first = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = (last.t - first.t) / 1000;
  if (dt < 0.008) return { x: 0, z: 0 };
  return { x: (last.x - first.x) / dt, z: (last.z - first.z) / dt };
}

/** Cap a velocity's magnitude. */
export function capSpeed(v: XZ, max: number): XZ {
  const s = Math.hypot(v.x, v.z);
  return s > max && s > 0 ? { x: (v.x / s) * max, z: (v.z / s) * max } : v;
}

/**
 * Exponentially damped glide: v(t) = v0·e^(−rate·t). Returns the new velocity and the exact
 * displacement over `dt` seconds (∫v dt), so the glide distance doesn't depend on the frame rate.
 * Total glide distance from v0 is v0/rate.
 */
export function inertiaStep(v: XZ, dt: number, rate: number): { v: XZ; dx: number; dz: number } {
  const e = Math.exp(-rate * dt);
  const k = (1 - e) / rate;
  return { v: { x: v.x * e, z: v.z * e }, dx: v.x * k, dz: v.z * k };
}

// ---- taps -------------------------------------------------------------------------------------

export interface Tap {
  t: number;
  x: number;
  y: number;
}

export function isDoubleTap(prev: Tap | null, cur: Tap, maxMs = 320, maxPx = 30): boolean {
  return !!prev && cur.t - prev.t <= maxMs && cur.t >= prev.t && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= maxPx;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

/** Max horizontal reach of a pan ray (keeps near-horizon grabs bounded), from height above ground. */
export function panReach(agl: number): number {
  return clamp(Math.max(agl, 10) * 40, 400, 20000);
}
