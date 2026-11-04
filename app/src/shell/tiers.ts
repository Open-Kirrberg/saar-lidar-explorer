/**
 * Feature tiers (ADR 0019): Standard ⊂ Entdecker ⊂ Labor. Pure: order, labels, parsing and
 * local persistence (one localStorage key, cleared by "Einstellungen zurücksetzen").
 */
import type { KeyValueStore } from '../ui/settings';

export type Tier = 'standard' | 'entdecker' | 'labor';
export const TIERS: readonly Tier[] = ['standard', 'entdecker', 'labor'];
export const TIER_KEY = 'sle.tier.v1';
export const DEFAULT_TIER: Tier = 'standard';

export const TIER_LABELS: Record<Tier, string> = { standard: 'Standard', entdecker: 'Entdecker', labor: 'Labor' };
export const TIER_HINTS: Record<Tier, string> = {
  standard: 'Fliegen, Orte, Karte, Teilen – das Wichtigste, sonst nichts.',
  entdecker: 'Dazu: Überhöhung, Qualität, Werkzeuge-Leiste (Rekonstruktion 1789, Tour).',
  labor: 'Alles: Relief-Labor, Verdachtsflächen prüfen, Fundmarker-Liste, Messen, Meldung. Für große Bildschirme.',
};

export const tierRank = (t: Tier): number => TIERS.indexOf(t);
/** Is a feature of tier `required` available when the user is on tier `current`? */
export const tierAllows = (current: Tier, required: Tier): boolean => tierRank(current) >= tierRank(required);

export function parseTier(v: unknown): Tier | null {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v) ? (v as Tier) : null;
}

/** `?tier=labor` (dev, screenshots, links in docs) wins over the stored tier but is not saved. */
export function tierFromQuery(search: string): Tier | null {
  try {
    return parseTier(new URLSearchParams(search).get('tier'));
  } catch {
    return null;
  }
}

export function loadTier(kv: KeyValueStore | null): Tier {
  try {
    return parseTier(kv?.getItem(TIER_KEY)) ?? DEFAULT_TIER;
  } catch {
    return DEFAULT_TIER;
  }
}

export function saveTier(kv: KeyValueStore | null, t: Tier): boolean {
  if (!kv) return false;
  try {
    kv.setItem(TIER_KEY, t);
    return true;
  } catch {
    return false;
  }
}
