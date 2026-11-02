/**
 * F15 panel preferences (layer on/off + filter) per AOI: localStorage `sle.candidates.prefs.v1.<aoi>`.
 * Up to v0.12 one shared key `sle.candidates.prefs.v1` held them for every AOI, so a min score set
 * on one AOI leaked into the others. Migration: the first AOI opened without its own key takes the
 * legacy prefs (except `minScore`, which belongs to that AOI's detector threshold) and the legacy
 * key is removed. Pure apart from the injected storage; unit-tested.
 */
import { defaultFilter, sanitizeFilter } from './candidateData';
import type { CandidateFilter } from './candidateData';

export const LEGACY_PREFS_KEY = 'sle.candidates.prefs.v1';
export const candidatePrefsKey = (aoi: string): string => `${LEGACY_PREFS_KEY}.${aoi}`;

export interface CandidatePrefs {
  on: boolean;
  filter: CandidateFilter;
}

/** localStorage subset; `removeItem` optional (tests). */
export interface PrefsKV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function parse(raw: string | null, base: CandidateFilter): CandidatePrefs | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { on?: unknown; filter?: unknown } | null;
    if (!p || typeof p !== 'object') return null;
    return { on: p.on === true, filter: sanitizeFilter(p.filter, base) };
  } catch {
    return null;
  }
}

/**
 * Prefs for `aoi` (defaults with `defaultMin` when nothing is stored). `migrated` is true when the
 * legacy shared key was consumed (and written to the AOI key, legacy key removed).
 */
export function loadCandidatePrefs(kv: PrefsKV | null | undefined, aoi: string, defaultMin: number): { prefs: CandidatePrefs; migrated: boolean } {
  const base = defaultFilter(defaultMin);
  const fresh = (): CandidatePrefs => ({ on: false, filter: base });
  if (!kv) return { prefs: fresh(), migrated: false };
  let own: string | null = null;
  let legacy: string | null = null;
  try {
    own = kv.getItem(candidatePrefsKey(aoi));
    if (own === null) legacy = kv.getItem(LEGACY_PREFS_KEY);
  } catch {
    return { prefs: fresh(), migrated: false };
  }
  const mine = parse(own, base);
  if (mine) return { prefs: mine, migrated: false };
  const old = parse(legacy, base);
  if (!old) return { prefs: fresh(), migrated: false };
  const prefs: CandidatePrefs = { on: old.on, filter: { ...old.filter, minScore: defaultMin } };
  saveCandidatePrefs(kv, aoi, prefs);
  try {
    kv.removeItem?.(LEGACY_PREFS_KEY);
  } catch {
    /* ignore */
  }
  return { prefs, migrated: true };
}

export function saveCandidatePrefs(kv: PrefsKV | null | undefined, aoi: string, prefs: CandidatePrefs): boolean {
  try {
    if (!kv) return false;
    kv.setItem(candidatePrefsKey(aoi), JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
