/**
 * Camera handover between the Saar LiDAR Explorer and this viewer (docs/explorer-integration.md §4). Pure: no DOM,
 * no three.js runtime, so it is unit-tested in Node.
 *
 *   explorer → viewer:  ?src=explorer&E=…&N=…&h=…&heading=…&pitch=…&mode=fliegen|gehen&back=<encoded explorer URL>
 *   viewer → explorer:  <back or EXPLORER_DEFAULT_URL> with hash fields 1–5 replaced by E,N,h,heading,pitch
 *
 * Conventions (shared with the explorer hash): E/N in EPSG:25832, h = true height m DHHN2016, heading = degrees
 * clockwise from GRID north (+N = local −z), pitch = degrees, negative = looking down.
 * Viewer controls: camera Euler (pitch, yaw, 0, 'YXZ'), forward = (−sin yaw·cos pitch, sin pitch, −cos yaw·cos pitch).
 */
import { E0, N0 } from '@model/frame.ts';

/**
 * Explorer to return to without a valid `back`: local dev server, or the build-time `VITE_EXPLORER_URL`
 * (public GitHub Pages build: the explorer one level up, e.g. https://open-kirrberg.github.io/saar-lidar-explorer/).
 */
export const EXPLORER_DEFAULT_URL = explorerDefaultUrl(
  (import.meta.env as Record<string, string | undefined> | undefined)?.VITE_EXPLORER_URL,
  typeof location !== 'undefined' ? location?.href : undefined,
);

/** `raw` (relative ones resolved against `href`) when it parses as http(s), else the local explorer. */
export function explorerDefaultUrl(raw: string | undefined, href: string | undefined): string {
  if (raw) {
    try {
      const u = href ? new URL(raw, href) : new URL(raw);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch {
      /* fall through */
    }
  }
  return 'http://localhost:5240/';
}
const DEG = Math.PI / 180;

export type HandoverMode = 'fliegen' | 'gehen';

export interface Pose {
  E: number;
  N: number;
  h: number;
  heading: number;
  pitch: number;
}

export interface Handover {
  pose: Pose;
  mode: HandoverMode;
  /** Validated return URL (absolute), or null. */
  back: string | null;
  src: string | null;
}

/** Strict number: '' / whitespace / non-numeric / missing → NaN. */
function num(v: string | null | undefined): number {
  return v === null || v === undefined || v.trim() === '' ? NaN : Number(v);
}

/** Degrees in [0, 360), no −0 (same rule as the explorer's normDeg). */
export function normDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r + 0;
}

export const clampPitch = (p: number): number => Math.max(-89, Math.min(89, p));

/** Round like the explorer's formatHash: String(Math.round(v·10^d) / 10^d). */
export function fmt(v: number, d = 1): string {
  const k = 10 ** d;
  return String(Math.round(v * k) / k + 0);
}

/** Origin of the current page (browser), for the same-origin rule of the public build. */
function pageOrigin(): string | undefined {
  return typeof location !== 'undefined' && location?.origin && location.origin !== 'null' ? location.origin : undefined;
}

/**
 * Accept only local http(s) URLs as the return target (no open redirect): hostname localhost, 127.0.0.1, [::1]
 * or ending in .localhost / .test — or a URL on the same origin as this page (public build: the explorer and
 * the viewer share https://open-kirrberg.github.io). Returns the normalised absolute URL or null.
 */
export function validateBackUrl(raw: string | null | undefined, origin: string | undefined = pageOrigin()): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost') || host.endsWith('.test');
  return local || (!!origin && u.origin === origin) ? u.href : null;
}

/** Parse the viewer's query string. Returns null unless E, N, h, heading and pitch are all present and finite. */
export function parseHandover(search: string): Handover | null {
  const q = new URLSearchParams(search);
  const [E, N, h, heading, pitch] = ['E', 'N', 'h', 'heading', 'pitch'].map((k) => num(q.get(k)));
  if (![E, N, h, heading, pitch].every(Number.isFinite)) return null;
  const m = (q.get('mode') ?? '').toLowerCase();
  return {
    pose: { E, N, h, heading: normDeg(heading), pitch: clampPitch(pitch) },
    mode: m === 'gehen' ? 'gehen' : 'fliegen',
    back: validateBackUrl(q.get('back')),
    src: q.get('src'),
  };
}

/** The five leading hash fields `E,N,h,heading,pitch` (0.1 m / 0.1°, heading in [0, 360), pitch in [−89, 89]). */
export function poseFields(p: Pose): string[] {
  return [fmt(p.E), fmt(p.N), fmt(p.h), fmt(normDeg(Math.round(p.heading * 10) / 10)), fmt(clampPitch(p.pitch))];
}

/**
 * Replace the first five comma-separated hash fields of `hash` (with or without '#') by the pose and keep the
 * remaining fields. A hash with fewer than five fields (or none) becomes just the five pose fields.
 */
export function replaceHashPose(hash: string, p: Pose): string {
  const body = hash.replace(/^#/, '');
  const parts = body ? body.split(',') : [];
  const rest = parts.length >= 5 ? parts.slice(5) : [];
  return `#${[...poseFields(p), ...rest].join(',')}`;
}

/** Return URL: validated `back` (else the explorer default) with the pose written into its hash. */
export function backTarget(back: string | null, p: Pose, fallback = EXPLORER_DEFAULT_URL): string {
  const base = validateBackUrl(back) ?? fallback;
  const u = new URL(base);
  u.hash = replaceHashPose(u.hash, p);
  return u.href;
}

// ---------------------------------------------------------------------------------------------
// Angles: grid heading / pitch <-> viewer yaw / pitch (radians)
// ---------------------------------------------------------------------------------------------

/** Viewer yaw (rad) for a grid heading (deg cw from grid north). forward = (sin hd, 0, −cos hd) in local. */
export function headingToYaw(headingDeg: number): number {
  return -headingDeg * DEG;
}

export function yawToHeading(yaw: number): number {
  return normDeg(-yaw / DEG);
}

export function pitchToRad(pitchDeg: number): number {
  return clampPitch(pitchDeg) * DEG;
}

export function radToPitch(p: number): number {
  return clampPitch(p / DEG);
}

/** Local frame position of a pose. */
export function poseToLocal(p: Pick<Pose, 'E' | 'N' | 'h'>): { x: number; y: number; z: number } {
  return { x: p.E - E0, y: p.h, z: -(p.N - N0) };
}

/** Pose from the viewer camera state (local position, yaw/pitch in radians). */
export function poseFromCamera(pos: { x: number; y: number; z: number }, yaw: number, pitch: number): Pose {
  return { E: pos.x + E0, N: N0 - pos.z, h: pos.y, heading: yawToHeading(yaw), pitch: radToPitch(pitch) };
}

// ---------------------------------------------------------------------------------------------
// mode=gehen: where to start walking
// ---------------------------------------------------------------------------------------------

export interface WalkPoi {
  id: string;
  kind: string;
  position: { x: number; y: number; z: number };
  lookAt?: { x: number; y: number; z: number };
  buildingId?: string;
  /** Entrances: false when the generator found the threshold unreachable on foot (model/src/site/access.ts). */
  walkable?: boolean;
}

/**
 * Preference tiers: an entrance (portal / Durchfahrt) that can be reached on foot, then a building view POI (the
 * walker drops to the open ground there), and only then an entrance flagged `walkable: false` (behind a terrace wall
 * or above a step higher than 0.35 m, where the walker would be stuck). Within a tier the nearest POI wins.
 */
const WALK_TIERS: readonly ((p: WalkPoi) => boolean)[] = [
  (p) => p.kind === 'entrance' && p.walkable !== false,
  (p) => p.kind === 'building',
  (p) => p.kind === 'entrance' && p.walkable === false,
];

/**
 * Walk start for (x, z): the nearest POI of the best tier within maxDist (horizontal); null if nothing is within
 * maxDist (the caller then drops to the ground at (x, z), facing walkFallbackYaw()).
 */
export function pickWalkStart<P extends WalkPoi>(pois: readonly P[], x: number, z: number, maxDist = 200): P | null {
  for (const inTier of WALK_TIERS) {
    let best: P | null = null;
    let bd = Infinity;
    for (const p of pois) {
      if (!inTier(p)) continue;
      const d = Math.hypot(p.position.x - x, p.position.z - z);
      if (d <= maxDist && d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) return best;
  }
  return null;
}

/** Viewer yaw (rad) that looks horizontally from (x, z) towards (tx, tz); forward = (−sin yaw, 0, −cos yaw). */
export function yawTowards(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

/**
 * Walk fallback (no POI within range): face the nearest building centre horizontally, else the anchor. Returns null
 * when there is nothing to face (no centres, no anchor, or standing on it), so the caller can keep the heading.
 */
export function walkFallbackYaw(x: number, z: number, centres: readonly { x: number; z: number }[], anchor?: { x: number; z: number }): number | null {
  let best: { x: number; z: number } | undefined;
  let bd = Infinity;
  for (const c of centres) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d > 0.5 && d < bd) {
      bd = d;
      best = c;
    }
  }
  best ??= anchor && Math.hypot(anchor.x - x, anchor.z - z) > 0.5 ? anchor : undefined;
  return best ? yawTowards(x, z, best.x, best.z) : null;
}

/** Fly start height: lift to ground + clearance when the pose is below it (NaN ground = keep h). */
export function liftAboveGround(h: number, ground: number, clearance = 1.5): number {
  return Number.isFinite(ground) && h < ground + clearance ? ground + clearance : h;
}
