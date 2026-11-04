/**
 * User settings that are not (or not only) in the URL hash — final polish.
 *
 * One versioned localStorage key (`sle.settings.v1`) holds the start-up defaults the app applies
 * when the URL hash doesn't say otherwise (display, exaggeration, sun), plus pure preferences
 * (quality preset, flight tempo, HUD help, onboarding seen). The hash always wins over these.
 *
 * Feature modules keep their own existing keys (`sle.buildings.v1`, `sle.vectors.v1`, …) — this
 * module only knows their names so "Einstellungen zurücksetzen" can clear them in one go. Private
 * user data (Fundmarker, Verdachtsflächen-Bewertungen, Messungen) is never touched by a reset.
 *
 * Pure logic (parse/migrate/validate/reset plan) is DOM-free and unit-tested; storage is injected.
 */
import { FOREST_MODES, clampExaggeration, clampSunDirections, clampSunElevation, normDeg } from '../state';
import type { AppState, ForestMode } from '../state';

export const SETTINGS_KEY = 'sle.settings.v1';
export const SETTINGS_VERSION = 1;

export type QualityLevel = 'hoch' | 'mittel' | 'niedrig' | 'mobil';
/** 'mobil' (F20) is appended so the Hoch → Mittel → Niedrig order stays the first three. */
export const QUALITY_LEVELS: readonly QualityLevel[] = ['hoch', 'mittel', 'niedrig', 'mobil'];

/** F20 layout: 'auto' = simple on touch/narrow screens, else full ("Ansicht: Einfach / Vollständig"). */
export type UiModePref = 'auto' | 'simple' | 'full';
export const UI_MODE_PREFS: readonly UiModePref[] = ['auto', 'simple', 'full'];

export interface Settings {
  v: 1;
  /** Display defaults (the hash overrides them). Undefined = app default. */
  layer?: string;
  overlay?: string;
  overlayOpacity?: number;
  forest?: ForestMode;
  exaggeration?: number;
  sunAzimuth?: number;
  sunElevation?: number;
  sunDirections?: number;
  quality: QualityLevel;
  /** True once the user picked a quality preset (F20: phones auto-select 'mobil' until then). */
  qualityPicked?: boolean;
  /** F20 layout preference; undefined = 'auto'. */
  uiMode?: UiModePref;
  /** Flight: base speed (m/s) and minimum clearance (m), as in "Flug & Technik". */
  baseSpeed?: number;
  minClearance?: number;
  /** HUD "Steuerung" block shown (H toggles). */
  hudHelp: boolean;
  /** First-run introduction dismissed with "nicht mehr zeigen". */
  onboardingSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = { v: 1, quality: 'hoch', hudHelp: true, onboardingSeen: false };

/**
 * localStorage keys that hold *preferences* (cleared by "Einstellungen zurücksetzen"). A key also
 * matches its per-AOI variants (`<key>.<aoi>`, e.g. `sle.candidates.prefs.v1.karlsberg`).
 */
export const PREF_KEYS: readonly string[] = [
  SETTINGS_KEY,
  'sle.ui.v1', // panel sections open/closed
  'sle.disclaimer.v1', // "Schauen, nicht graben" hidden → shown again after a reset
  'sle.buildings.v1',
  'sle.vectors.v1',
  'sle.map.v1',
  'sle.map.v2', // V2.3 game minimap (mode, zoom, Labor layers)
  'sle.pointcloud.v1',
  'sle.pois.v1',
  'sle.candidates.prefs.v1',
  'sle.tier.v1', // v2 shell: feature tier (Standard / Entdecker / Labor)
  'sle.shell.v1', // v2 shell: last open drawer
  'sle.tutorial.v1', // v2 shell: first-flight tutorial done (V2.9) → shown again after a reset
];

/** Keys (or key prefixes) with private user data that a settings reset must never delete. */
export const PRIVATE_KEY_PREFIXES: readonly string[] = ['sle.markers.', 'sle.candidates.v1', 'sle.measure.'];

/** Minimal Storage subset (localStorage-compatible), injectable for tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Enumeration (as in Storage); lets a reset find per-AOI variants of preference keys. */
  readonly length?: number;
  key?(index: number): string | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (v: unknown, lo: number, hi: number): number | undefined => (isNum(v) ? Math.max(lo, Math.min(hi, v)) : undefined);

/**
 * Validate (and migrate) a parsed settings object. Unknown/invalid fields fall back to defaults;
 * never throws. Accepts `v: 1` and unversioned objects (treated as v1); other versions → defaults.
 */
export function parseSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  if (r.v !== undefined && r.v !== SETTINGS_VERSION) return { ...DEFAULT_SETTINGS };
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof r.layer === 'string' && r.layer) out.layer = r.layer;
  if (typeof r.overlay === 'string') out.overlay = r.overlay;
  const op = inRange(r.overlayOpacity, 0, 1);
  if (op !== undefined) out.overlayOpacity = op;
  if (typeof r.forest === 'string' && (FOREST_MODES as readonly string[]).includes(r.forest)) out.forest = r.forest as ForestMode;
  if (isNum(r.exaggeration) && r.exaggeration > 0) out.exaggeration = clampExaggeration(r.exaggeration);
  if (isNum(r.sunAzimuth)) out.sunAzimuth = normDeg(r.sunAzimuth);
  if (isNum(r.sunElevation)) out.sunElevation = clampSunElevation(r.sunElevation);
  if (isNum(r.sunDirections)) out.sunDirections = clampSunDirections(r.sunDirections);
  if (typeof r.quality === 'string' && (QUALITY_LEVELS as readonly string[]).includes(r.quality)) out.quality = r.quality as QualityLevel;
  if (typeof r.qualityPicked === 'boolean') out.qualityPicked = r.qualityPicked;
  if (typeof r.uiMode === 'string' && (UI_MODE_PREFS as readonly string[]).includes(r.uiMode)) out.uiMode = r.uiMode as UiModePref;
  const bs = inRange(r.baseSpeed, 2, 60);
  if (bs !== undefined) out.baseSpeed = bs;
  const mc = inRange(r.minClearance, 0.5, 50);
  if (mc !== undefined) out.minClearance = mc;
  if (typeof r.hudHelp === 'boolean') out.hudHelp = r.hudHelp;
  if (typeof r.onboardingSeen === 'boolean') out.onboardingSeen = r.onboardingSeen;
  return out;
}

export function loadSettings(kv: KeyValueStore | null): Settings {
  if (!kv) return { ...DEFAULT_SETTINGS };
  try {
    const text = kv.getItem(SETTINGS_KEY);
    return parseSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(kv: KeyValueStore | null, s: Settings): boolean {
  if (!kv) return false;
  try {
    kv.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** Store fields mirrored into the settings (start-up defaults when the hash lacks them). */
export const SETTINGS_STATE_KEYS = [
  'layer',
  'overlay',
  'overlayOpacity',
  'forest',
  'exaggeration',
  'sunAzimuth',
  'sunElevation',
  'sunDirections',
] as const satisfies ReadonlyArray<keyof AppState & keyof Settings>;

/** Store patch for the saved display defaults; layers the validator rejects are skipped. */
export function settingsStatePatch(s: Settings, isValidLayer: (key: string) => boolean = () => true): Partial<AppState> {
  const patch: Partial<AppState> = {};
  if (s.layer && isValidLayer(s.layer)) patch.layer = s.layer;
  if (s.overlay !== undefined) patch.overlay = s.overlay === '' || isValidLayer(s.overlay) ? s.overlay : '';
  if (s.overlayOpacity !== undefined) patch.overlayOpacity = s.overlayOpacity;
  if (s.forest !== undefined) patch.forest = s.forest;
  if (s.exaggeration !== undefined) patch.exaggeration = s.exaggeration;
  if (s.sunAzimuth !== undefined) patch.sunAzimuth = s.sunAzimuth;
  if (s.sunElevation !== undefined) patch.sunElevation = s.sunElevation;
  if (s.sunDirections !== undefined) patch.sunDirections = s.sunDirections;
  return patch;
}

/** Copy the mirrored store fields into the settings (returns a new object). */
export function settingsFromState(s: Settings, st: Readonly<AppState>): Settings {
  const out: Settings = { ...s };
  for (const k of SETTINGS_STATE_KEYS) (out as unknown as Record<string, unknown>)[k] = st[k];
  return out;
}

/** True for keys a settings reset may delete (a preference key, never private data). */
export function isResettableKey(key: string): boolean {
  if (PRIVATE_KEY_PREFIXES.some((p) => key === p.replace(/\.$/, '') || key.startsWith(p.endsWith('.') ? p : `${p}.`))) return false;
  return PREF_KEYS.some((k) => key === k || key.startsWith(`${k}.`));
}

/** Delete all preference keys; returns the keys removed. Private data stays. */
export function resetSettings(kv: KeyValueStore | null): string[] {
  if (!kv) return [];
  const removed: string[] = [];
  const all = new Set(PREF_KEYS);
  try {
    const n = kv.length ?? 0;
    for (let i = 0; i < n; i++) {
      const k = kv.key?.(i);
      if (k) all.add(k);
    }
  } catch {
    /* enumeration blocked: fixed keys only */
  }
  for (const k of all) {
    if (!isResettableKey(k)) continue;
    try {
      if (kv.getItem(k) !== null) {
        kv.removeItem(k);
        removed.push(k);
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/** The pose part of a hash (first 5 fields): after a reset the camera stays, the look resets. */
export function poseOnlyHash(hash: string): string {
  const parts = hash.replace(/^#/, '').split(',');
  return parts.length >= 5 ? `#${parts.slice(0, 5).join(',')}` : '';
}

/** localStorage, or null where it's unavailable (private mode, blocked storage). */
export function browserStorage(): KeyValueStore | null {
  try {
    const s = window.localStorage;
    const probe = '__sle_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
