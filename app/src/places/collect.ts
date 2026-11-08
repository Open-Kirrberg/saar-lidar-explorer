/**
 * 🏆 Orte im Vergleich — local collecting („Riesen entdeckt x/y“, „Orte besucht x/9“), plan §8 Phase 1.
 *
 * Local-first (ADR 0022): the progress lives only in this browser (localStorage `sle.orteCollect.v1`),
 * nothing leaves the device, no account, no server. Pure apart from the injected key-value storage
 * (unit-tested in tests/places.test.ts); every storage access is wrapped in try/catch, a private
 * window or blocked storage simply forgets the progress on reload.
 *
 * Rules:
 *  - A Riese counts as discovered when the camera came within `DISCOVER_RADIUS_M` (150 m, 3D: the
 *    horizontal distance to the top and the height difference between the camera's height above
 *    ground and the tree height) or when its Baum-Steckbrief was opened. Only Riesen inside the 3D
 *    area count (the others cannot be reached).
 *  - A place counts as visited when the camera flew over its outline below `VISIT_MAX_AGL_M`.
 *  - Automatic flights and the start do not collect places (`collectGate`): nothing counts while a
 *    fly-to animation runs (it passes over other places and Riesen); after it, and likewise after the
 *    app start (the default or shared start pose is not a visit) and after a reset, no place counts until
 *    the camera has moved `ARRIVAL_MOVE_M` away from that pose (the framed arrival pose often hovers over
 *    the neighbouring Gemarkung). Riesen wait too, until the camera moved `RIESE_ARRIVAL_MOVE_M` (30 m)
 *    from the arrival pose: the list's fly-to frames a Riese from ≥ 160 m (on phones ≈ 170 m, closer to
 *    the ground), and the arrival pose often lies within 150 m of *neighbouring* Riesen (they stand in
 *    groups) — those counted without any own flying (user report, 2026-11-08). So flying there alone
 *    discovers nothing: fly closer or open the Baum-Steckbrief (Riesen in the tree layer).
 * Only ids are stored, with the date of the first discovery (no positions, no track).
 */

export const COLLECT_KEY = 'sle.orteCollect.v1';
export const DISCOVER_RADIUS_M = 150;
export const VISIT_MAX_AGL_M = 1500;
export const ARRIVAL_MOVE_M = 100;
/** After an automatic flight (or the start), Riesen count once the camera moved this far from the arrival pose. */
export const RIESE_ARRIVAL_MOVE_M = 30;

/**
 * German hint shown after the Riesen list flew to a Riese that is not discovered yet. Only Riesen in
 * the 3D tree layer (`in_trees`) can be tapped (their Baum-Steckbrief counts); the others have only a
 * pin, which flies there, so they are discovered by flying closer alone.
 */
export function rieseDiscoverHint(r: { rank: number; in_trees: boolean }): string {
  const near = `näher als etwa ${DISCOVER_RADIUS_M} m heranfliegen`;
  return r.in_trees
    ? `Riese Nr. ${r.rank}: zum Entdecken ${near} oder den Baum antippen.`
    : `Riese Nr. ${r.rank}: zum Entdecken ${near} – dieser Baum steht nicht im 3D-Wald und lässt sich nicht antippen.`;
}

/** State of `collectGate` (one per panel). */
export interface CollectGate {
  /** A fly-to animation ran since the last gate check (set from the frame loop, so short flights are seen). */
  flew: boolean;
  /** Where the last automatic flight ended; null once the camera moved away (or none ran). */
  arrival: { E: number; N: number } | null;
}

/**
 * A new gate is armed: the first check records the current (start) pose like the end of a flight, so the
 * place under the start pose does not count until the camera moved away (review 2026-11-08: every app start
 * collected Homburg, the default start, and undid a reset on reload).
 */
export const newCollectGate = (): CollectGate => ({ flew: true, arrival: null });

/** Treat the current pose as an arrival again (after a reset: the place under the camera must be re-earned). */
export function armCollectGate(g: CollectGate): void {
  g.flew = true;
  g.arrival = null;
}

/**
 * Which kinds may be collected now. `flying` = the controller runs a fly-to animation. Mutates `g`:
 * the end of a flight records the arrival point; moving `ARRIVAL_MOVE_M` away from it clears it.
 */
export function collectGate(
  g: CollectGate,
  flying: boolean,
  cam: { E: number; N: number },
  moveM = ARRIVAL_MOVE_M,
  rieseMoveM = RIESE_ARRIVAL_MOVE_M,
): { riesen: boolean; places: boolean } {
  if (flying) {
    g.flew = true;
    return { riesen: false, places: false };
  }
  if (g.flew) {
    if (!Number.isFinite(cam.E) || !Number.isFinite(cam.N)) return { riesen: false, places: false }; // pose not known yet
    g.flew = false;
    g.arrival = { E: cam.E, N: cam.N };
  }
  const known = Number.isFinite(cam.E) && Number.isFinite(cam.N);
  const moved = g.arrival && known ? Math.hypot(cam.E - g.arrival.E, cam.N - g.arrival.N) : 0;
  if (g.arrival && moved >= moveM) g.arrival = null;
  return { riesen: g.arrival === null ? known : moved >= rieseMoveM, places: g.arrival === null };
}

/** Minimal Storage subset (localStorage-compatible), injectable for tests. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface CollectStore {
  version: 1;
  /** Tree id (decimal string) → ISO date of the discovery. */
  riesen: Record<string, string>;
  /** Place id → ISO date of the first visit. */
  places: Record<string, string>;
}

export const emptyCollect = (): CollectStore => ({ version: 1, riesen: {}, places: {} });

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const cleanMap = (v: unknown, keyOk: (k: string) => boolean): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, d] of Object.entries(v as Record<string, unknown>)) {
    if (keyOk(k) && typeof d === 'string' && ISO_DAY.test(d)) out[k] = d.slice(0, 10);
  }
  return out;
};

export function loadCollect(kv: KV | null | undefined): CollectStore {
  try {
    const raw = kv?.getItem(COLLECT_KEY);
    if (!raw) return emptyCollect();
    const v = JSON.parse(raw) as { version?: unknown; riesen?: unknown; places?: unknown };
    if (v?.version !== 1) return emptyCollect();
    return {
      version: 1,
      riesen: cleanMap(v.riesen, (k) => /^\d{1,10}$/.test(k)),
      places: cleanMap(v.places, (k) => /^[a-z0-9-]{1,64}$/.test(k)),
    };
  } catch (err) {
    console.warn('[places] collecting progress not readable, starting fresh', err);
    return emptyCollect();
  }
}

/** False when storage is unavailable or full (the progress then lasts until reload). */
export function saveCollect(kv: KV | null | undefined, s: CollectStore): boolean {
  try {
    if (!kv) return false;
    kv.setItem(COLLECT_KEY, JSON.stringify(s));
    return true;
  } catch (err) {
    console.warn('[places] collecting progress not saved', err);
    return false;
  }
}

export function clearCollect(kv: KV | null | undefined): CollectStore {
  try {
    if (kv?.removeItem) kv.removeItem(COLLECT_KEY);
    else kv?.setItem(COLLECT_KEY, JSON.stringify(emptyCollect()));
  } catch (err) {
    console.warn('[places] collecting progress not cleared', err);
  }
  return emptyCollect();
}

const today = (now: Date) => now.toISOString().slice(0, 10);

/** Mark a Riese discovered; true when it is new. */
export function markRiese(s: CollectStore, id: number, now = new Date()): boolean {
  const k = String(id >>> 0);
  if (s.riesen[k]) return false;
  s.riesen[k] = today(now);
  return true;
}

/** Mark a place visited; true when it is new. */
export function markPlace(s: CollectStore, id: string, now = new Date()): boolean {
  if (s.places[id]) return false;
  s.places[id] = today(now);
  return true;
}

export const isDiscovered = (s: CollectStore, id: number | null): boolean => id !== null && !!s.riesen[String(id >>> 0)];

/**
 * Riesen within `radius` of the camera (3D): horizontal distance to the top and the difference
 * between the camera's height above ground and the tree height (ground at the tree ≈ ground under
 * the camera, fine within 150 m).
 */
export function riesenNear<T extends { E: number; N: number; h: number; id: number | null }>(
  riesen: readonly T[],
  cam: { E: number; N: number; agl: number },
  radius = DISCOVER_RADIUS_M,
): T[] {
  if (![cam.E, cam.N, cam.agl].every(Number.isFinite)) return [];
  return riesen.filter((r) => r.id !== null && Math.hypot(r.E - cam.E, r.N - cam.N, cam.agl - r.h) <= radius);
}

/** Counts for the progress row, against the current lists (ids no longer published do not count). */
export function collectProgress(
  s: CollectStore,
  riesenIds: ReadonlyArray<number>,
  placeIds: ReadonlyArray<string>,
): { riesen: [found: number, total: number]; places: [visited: number, total: number] } {
  return {
    riesen: [riesenIds.filter((id) => isDiscovered(s, id)).length, riesenIds.length],
    places: [placeIds.filter((id) => !!s.places[id]).length, placeIds.length],
  };
}
