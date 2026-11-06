/**
 * Built twins: the short guided tour (zone contract „Tour“, catalogue `tour`). Pure parts, no three.js, no DOM:
 *
 * - `parseTour`: tolerant parse of the catalogue's `tour` block (a broken stop is dropped; < 2 stops → no tour).
 * - `tourMove` / `tourNav`: step sequencing (start, next, back, end) and what the panel shows.
 * - `lookAngles`, `glideVia`, `makeGlide`, `glideAt`: the camera glide from wherever the visitor is to a stop.
 *
 * Stop texts are package data (the bakery's `catalogue/tour.json`), never UI code. The runtime wiring is
 * `runtime/twinInteract.ts` (state, highlight), `runtime/twinUi.ts` (panel) and `runtime/gltfZone.ts` (glide).
 */

export type Vec3 = readonly [number, number, number];
export type XZ = readonly [number, number];

export interface TourStop {
  id: string;
  title_de: string;
  text_de: string;
  /** Catalogue object highlighted at this stop (null = none). */
  target: string | null;
  /** Standing point, zone frame (package, unscaled); y = eye height when floating. */
  eye: Vec3;
  /** The point the camera looks at. */
  look: Vec3;
  /** [x, z] waypoints of the glide in from the previous stop (reversed on the way back). */
  via: XZ[];
}

export interface ZoneTour {
  name_de: string;
  stops: TourStop[];
}

export const TOUR_MAX_STOPS = 12;
export const TOUR_MAX_VIA = 4;
/** Zone frame bound (m) for x and z: anything larger is raw UTM or garbage. */
export const TOUR_MAX_XZ = 5000;

const STOP_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function text(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function vec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(num)) return null;
  const [x, y, z] = v as number[];
  return Math.abs(x!) <= TOUR_MAX_XZ && Math.abs(z!) <= TOUR_MAX_XZ && Math.abs(y!) <= 10_000 ? [x!, y!, z!] : null;
}

/**
 * The catalogue's `tour` block → a tour, or null (missing, or fewer than 2 valid stops). A stop needs a unique id,
 * a title, a text, `eye` ≠ `look` (zone frame); an unknown `target` only loses its highlight, bad `via` points
 * are dropped. Strings are text, never HTML.
 */
export function parseTour(raw: unknown, objects: { has(id: string): boolean }, warn: (m: string) => void = () => {}): ZoneTour | null {
  if (raw === undefined || raw === null) return null;
  const stops: TourStop[] = [];
  let dropped = 0;
  const list = isObj(raw) && Array.isArray(raw.stops) ? raw.stops.slice(0, TOUR_MAX_STOPS) : [];
  for (const r of list) {
    const id = isObj(r) && typeof r.id === 'string' && STOP_ID_RE.test(r.id) ? r.id : '';
    const title_de = isObj(r) ? text(r.title_de, 60) : '';
    const text_de = isObj(r) ? text(r.text_de, 300) : '';
    const eye = isObj(r) ? vec3(r.eye) : null;
    const look = isObj(r) ? vec3(r.look) : null;
    if (!id || !title_de || !text_de || !eye || !look || stops.some((s) => s.id === id) || Math.hypot(look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]) < 1e-3) {
      dropped++;
      continue;
    }
    const tgt = (r as Record<string, unknown>).target;
    const target = typeof tgt === 'string' && objects.has(tgt) ? tgt : null;
    const via: XZ[] = [];
    const rv = (r as Record<string, unknown>).via;
    if (Array.isArray(rv)) {
      for (const q of rv.slice(0, TOUR_MAX_VIA)) {
        const p = Array.isArray(q) && q.length === 2 ? vec3([q[0], 0, q[1]]) : null;
        if (p) via.push([p[0], p[2]]);
      }
    }
    stops.push({ id, title_de, text_de, target, eye, look, via });
  }
  if (dropped) warn(`catalogue: tour: ${dropped} invalid stop(s) dropped`);
  if (stops.length < 2) {
    warn('catalogue: tour needs at least 2 valid stops, no tour');
    return null;
  }
  return { name_de: isObj(raw) ? text(raw.name_de, 40) || 'Führung' : 'Führung', stops };
}

// ---- sequencing ------------------------------------------------------------------------------------------

export type TourAction = 'start' | 'next' | 'back' | 'end';

/** The stop index after `action` (null = the tour is not running). „Weiter“ on the last stop ends the tour. */
export function tourMove(cur: number | null, action: TourAction, n: number): number | null {
  if (n <= 0 || action === 'end') return null;
  if (action === 'start' || cur === null) return action === 'back' ? null : 0;
  const i = Math.min(Math.max(0, cur), n - 1);
  if (action === 'next') return i + 1 < n ? i + 1 : null;
  return Math.max(0, i - 1);
}

export interface TourNav {
  /** „2 / 6“ */
  counter: string;
  /** „Zurück“ is enabled. */
  back: boolean;
  /** Label of the forward button: „Weiter“, on the last stop „Fertig“. */
  next: 'Weiter' | 'Fertig';
}

export function tourNav(i: number, n: number): TourNav {
  return { counter: `${i + 1} / ${n}`, back: i > 0, next: i + 1 >= n ? 'Fertig' : 'Weiter' };
}

// ---- glide -----------------------------------------------------------------------------------------------

export interface GlidePose {
  x: number;
  y: number;
  z: number;
  /** Degrees clockwise from grid north. */
  heading: number;
  /** Degrees, negative = down. */
  pitch: number;
}

/** Heading (grid, clockwise from north = −z) and pitch from `eye` towards `look` (zone frame). */
export function lookAngles(eye: Vec3, look: Vec3): { heading: number; pitch: number } {
  const dx = look[0] - eye[0];
  const dy = look[1] - eye[1];
  const dz = look[2] - eye[2];
  const heading = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  return { heading, pitch };
}

/**
 * Waypoints of the glide from stop `from` (null: not on the tour yet) to stop `to`: the target's `via` on the way
 * forward by one, the leaving stop's `via` reversed on the way back by one, else none (a straight glide).
 */
export function glideVia(from: number | null, to: number, stops: readonly Pick<TourStop, 'via'>[]): XZ[] {
  if (from !== null && to === from + 1) return [...(stops[to]?.via ?? [])];
  if (from !== null && to === from - 1) return [...(stops[from]?.via ?? [])].reverse();
  return [];
}

export interface Glide {
  /** Path points (x, y, z): the start, the waypoints (height eased along the way), the end. */
  points: Vec3[];
  /** Cumulative horizontal length at each point. */
  at: number[];
  length: number;
  /** Seconds. */
  duration: number;
  from: GlidePose;
  to: GlidePose;
}

export const GLIDE_MIN_S = 1;
export const GLIDE_MAX_S = 3;

/** Shortest signed heading difference b − a in degrees (−180 … 180]. */
export function headingDelta(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function makeGlide(from: GlidePose, to: GlidePose, via: readonly XZ[] = []): Glide {
  const xz: XZ[] = [[from.x, from.z], ...via, [to.x, to.z]];
  const at = [0];
  for (let i = 1; i < xz.length; i++) at.push(at[i - 1]! + Math.hypot(xz[i]![0] - xz[i - 1]![0], xz[i]![1] - xz[i - 1]![1]));
  const length = at[at.length - 1]!;
  const points: Vec3[] = xz.map(([x, z], i) => {
    const f = length > 0 ? at[i]! / length : i / Math.max(1, xz.length - 1);
    return [x, from.y + (to.y - from.y) * f, z];
  });
  const turn = Math.abs(headingDelta(from.heading, to.heading)) + Math.abs(to.pitch - from.pitch);
  const duration = Math.min(GLIDE_MAX_S, Math.max(GLIDE_MIN_S, 0.8 + length / 12 + turn / 240));
  return { points, at, length, duration, from, to };
}

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Pose at time `t` (s) into the glide: eased along the path; heading the short way round. */
export function glideAt(g: Glide, t: number): GlidePose {
  const e = easeInOutCubic(Math.min(1, Math.max(0, t / g.duration)));
  const s = e * g.length;
  let i = 1;
  while (i < g.at.length - 1 && g.at[i]! < s) i++;
  const a = g.points[i - 1]!;
  const b = g.points[i]!;
  const seg = g.at[i]! - g.at[i - 1]!;
  const f = seg > 0 ? (s - g.at[i - 1]!) / seg : e;
  const heading = (g.from.heading + headingDelta(g.from.heading, g.to.heading) * e + 360) % 360;
  return {
    x: a[0] + (b[0] - a[0]) * f,
    y: a[1] + (b[1] - a[1]) * f,
    z: a[2] + (b[2] - a[2]) * f,
    heading,
    pitch: g.from.pitch + (g.to.pitch - g.from.pitch) * e,
  };
}
