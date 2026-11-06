/**
 * Built twins: the short guided tour (zone contract „Tour“, catalogue `tour`). Pure parts, no three.js, no DOM:
 *
 * - `parseTour`: tolerant parse of the catalogue's `tour` block (a broken stop is dropped; < 2 stops → no tour).
 * - `tourMove` / `tourNav`: step sequencing (start, next, back, end) and what the panel shows.
 * - `lookAngles`, `glideVia`, `makeGlide`, `glideAt`: the camera glide from wherever the visitor is to a stop.
 * - `legClear`, `planRoute`, `routePool`: keep the glide off the shell — a leg that would cross a wall (a floor
 *   step the visitor could not walk, or a long stretch without floor) is replaced by a route over the tour's own
 *   points (stop eyes and `via` points, e.g. the shop door), found by a shortest path over the clear legs.
 * - `tourFill`: the fill a stop needs (a product stop in an empty fill switches back to the default fill).
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

// ---- route: keep the glide off the shell -------------------------------------------------------------------

/** A route point: x / z in the zone frame and the feet height there (NaN = unknown: the first floor found). */
export interface RoutePoint {
  x: number;
  z: number;
  feet: number;
}

/** Floor height near `feet` at (x, z), or NaN (no floor: a wall, furniture, the world's edge). */
export type FloorAt = (x: number, z: number, feet: number) => number;

/** Sample spacing along a leg (m). */
export const ROUTE_SAMPLE_M = 0.1;
/** Largest floor step along a leg (m; the walker's step up): the shop floor 0.7 m above the street is a wall. */
export const ROUTE_STEP_M = 0.45;
/** Longest stretch without floor along a leg (m): furniture and a stop in front of a window are fine, a house is not. */
export const ROUTE_GAP_M = 3;
/** At most this many waypoints in a planned route. */
export const ROUTE_MAX_POINTS = 8;

/**
 * Could the visitor walk the straight leg a → b? Samples every `ROUTE_SAMPLE_M`: each floor found must be within
 * `ROUTE_STEP_M` of the last one (from `a.feet`), stretches without floor are tolerated up to `ROUTE_GAP_M`, and the
 * last floor must match `b.feet` (when known). Pure: `floorAt` is the walker's floor probe.
 */
export function legClear(a: RoutePoint, b: RoutePoint, floorAt: FloorAt, step = ROUTE_STEP_M, gapMax = ROUTE_GAP_M): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / ROUTE_SAMPLE_M));
  const ds = len / n;
  let feet = a.feet;
  let gap = 0;
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const g = floorAt(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, Number.isFinite(feet) ? feet : b.feet);
    if (!Number.isFinite(g)) {
      gap += ds;
      if (gap > gapMax) return false;
      continue;
    }
    if (Number.isFinite(feet) && Math.abs(g - feet) > step) return false;
    feet = g;
    gap = 0;
  }
  if (gap + ds > gapMax && n > 1) return false;
  return !(Number.isFinite(feet) && Number.isFinite(b.feet) && Math.abs(b.feet - feet) > step);
}

/**
 * Waypoints of a glide from `start` to `goal` that stays off the shell. The authored waypoints (`preferred`, the
 * stop's `via`) win when every leg of start → preferred → goal is `clear`; else the shortest chain of clear legs
 * over `pool` (the tour's own points) — e.g. from inside the shop out through the door; if there is none, the
 * preferred waypoints as before (a straight glide at worst). Pure: `clear` is `legClear` with the floor probe.
 */
export function planRoute(
  start: RoutePoint,
  goal: RoutePoint,
  preferred: readonly RoutePoint[],
  pool: readonly RoutePoint[],
  clear: (a: RoutePoint, b: RoutePoint) => boolean,
): RoutePoint[] {
  const chain = [start, ...preferred, goal];
  let ok = true;
  for (let i = 1; i < chain.length && ok; i++) ok = clear(chain[i - 1]!, chain[i]!);
  if (ok) return [...preferred];
  // Dijkstra over start, goal and the pool (same spot twice = one node), legs checked lazily
  const nodes: RoutePoint[] = [start, goal];
  for (const p of [...pool, ...preferred]) {
    if (!nodes.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.05)) nodes.push(p);
  }
  const n = nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      const d = dist[u]! + Math.hypot(nodes[v]!.x - nodes[u]!.x, nodes[v]!.z - nodes[u]!.z);
      if (d < dist[v]! && clear(nodes[u]!, nodes[v]!)) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (!(dist[1]! < Infinity)) return [...preferred];
  const path: RoutePoint[] = [];
  for (let v = prev[1]!; v > 0; v = prev[v]!) path.unshift(nodes[v]!);
  return path.length <= ROUTE_MAX_POINTS ? path : [...preferred];
}

/** A point a route may pass: x / z, the eye height of its stop, and whether it is the stop's eye (else a `via`). */
export interface PoolPoint {
  x: number;
  z: number;
  eyeY: number;
  eye: boolean;
}

/** The tour's own points a route may use: every stop's eye and `via` points. */
export function routePool(stops: readonly Pick<TourStop, 'eye' | 'via'>[]): PoolPoint[] {
  const out: PoolPoint[] = [];
  for (const s of stops) {
    out.push({ x: s.eye[0], z: s.eye[2], eyeY: s.eye[1], eye: true });
    for (const [x, z] of s.via) out.push({ x, z, eyeY: s.eye[1], eye: false });
  }
  return out;
}

/** The walkable floor, as the runtime's walker sees it. */
export interface RouteFloor {
  /** Floor within about a step of `feet` at (x, z), NaN = none. */
  near(x: number, z: number, feet: number): number;
  /** Floor under an eye at `eyeY` (like a spawn settles), NaN = none. */
  under(x: number, z: number, eyeY: number): number;
}

/**
 * The glide's waypoints from the visitor (`start`, feet known) to a stop (`goal`, its eye) given the authored `via`:
 * `planRoute` over the tour's `pool` with `legClear` on `floor`. Stops without floor under them (in front of a
 * window) stand at `eyeY − eyeM`. `cache` keeps leg results between calls (the floor does not change).
 */
export function routeGlide(
  start: RoutePoint,
  goal: { x: number; z: number; eyeY: number },
  via: readonly XZ[],
  pool: readonly PoolPoint[],
  floor: RouteFloor,
  eyeM: number,
  cache?: Map<string, boolean>,
): XZ[] {
  const at = (x: number, z: number, eyeY: number, eye: boolean): RoutePoint => {
    const g = floor.under(x, z, eyeY);
    return { x, z, feet: Number.isFinite(g) ? g : eye ? eyeY - eyeM : NaN };
  };
  const end = at(goal.x, goal.z, goal.eyeY, true);
  const pre = via.map(([x, z]) => at(x, z, goal.eyeY, false));
  const pts = pool.map((p) => at(p.x, p.z, p.eyeY, p.eye));
  const key = (p: RoutePoint) => `${p.x.toFixed(2)},${p.z.toFixed(2)},${p.feet.toFixed(2)}`;
  const clear = (a: RoutePoint, b: RoutePoint): boolean => {
    if (!cache || a === start || b === start) return legClear(a, b, floor.near);
    const k = `${key(a)}>${key(b)}`;
    let v = cache.get(k);
    if (v === undefined) cache.set(k, (v = legClear(a, b, floor.near)));
    return v;
  };
  return planRoute(start, end, pre, pts, clear).map((p): XZ => [p.x, p.z]);
}

// ---- fills ------------------------------------------------------------------------------------------------

/**
 * The fill to switch to when the tour reaches a stop (null: stay). A *product stop* — its `target` holds product
 * slots (`slots`: the fill nodes, slot id + the fills that show it) — shown in a fill where none of them is placed
 * (the empty *Feierabend* shop) switches to `def`, the default fill, so „Brot anklicken“ can be followed.
 */
export function tourFill(
  target: string | null,
  slots: readonly { id: string; fills: readonly string[] }[],
  current: string | null,
  def: string | null,
): string | null {
  if (!target || current === null || def === null || current === def) return null;
  const mine = slots.filter((s) => s.id === target || s.id.startsWith(`${target}/`));
  if (!mine.length || mine.some((s) => s.fills.includes(current))) return null;
  return mine.some((s) => s.fills.includes(def)) ? def : null;
}
