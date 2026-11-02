/**
 * F9 non-blocking loading UX helpers (pure, no DOM/three):
 * - how many terrain pieces are still pending (initial load progress + the terrain's streaming
 *   stats, read defensively because the terrain engine's stats evolve), for the HUD's
 *   "Lade Details … n";
 * - when a fly-to target height must be refined (coarse level first, finer data later).
 */

export interface LoadProgressLike {
  loaded: number;
  total: number;
  failed: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Pending chunk loads reported by the terrain (`terrain.stats` / `terrain.streamStats`).
 * Preferred field: `pending` (queued + in flight). Also understood: `queued` + `inFlight`/`loading`,
 * `wanted − resident`. Returns null if the terrain reports nothing usable.
 */
export function terrainPending(terrain: unknown): number | null {
  const t = terrain as { stats?: Record<string, unknown>; streamStats?: Record<string, unknown> | (() => Record<string, unknown>) } | null;
  if (!t || typeof t !== 'object') return null;
  const ss = typeof t.streamStats === 'function' ? t.streamStats() : t.streamStats;
  for (const s of [ss, t.stats]) {
    if (!s || typeof s !== 'object') continue;
    const p = num(s.pending);
    if (p !== null) return p;
    const q = num(s.queued);
    const f = num(s.inFlight) ?? num(s.loading);
    if (q !== null || f !== null) return (q ?? 0) + (f ?? 0);
    const w = num(s.wanted);
    const r = num(s.resident);
    if (w !== null && r !== null) return Math.max(0, w - r);
  }
  return null;
}

/** Chunks still outstanding from a `Terrain.load` progress report (null = load finished/unknown). */
export function progressPending(p: LoadProgressLike | null, done: boolean): number {
  if (!p || done) return 0;
  return Math.max(0, p.total - p.loaded - p.failed);
}

/** HUD text for n pending pieces ('' = hide). */
export function pendingText(n: number): string {
  return n > 0 ? `Lade Details … ${n.toLocaleString('de-DE')}` : '';
}

/**
 * Should a fly-to whose target ground was `g0` (display metres; NaN = unknown when it started)
 * be re-aimed now that the ground reads `g`? Unknown → known always refines; otherwise when the
 * change exceeds max(`minTol`, `rel` · requested height above ground).
 */
export function needsRefine(g0: number, g: number, agl: number, minTol = 3, rel = 0.15): boolean {
  if (!Number.isFinite(g)) return false;
  if (!Number.isFinite(g0)) return true;
  return Math.abs(g - g0) > Math.max(minTol, rel * Math.max(agl, 0));
}
