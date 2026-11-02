/**
 * Pure styling + preferences for the F16 point clouds (no three/DOM): class palette, colour modes,
 * class groups for the panel, persisted settings with tolerant parsing.
 */

import { QUALITY_PRESETS } from '../ui/quality';

export type ColorMode = 'class' | 'height' | 'agl' | 'intensity';

export const COLOR_MODES: ReadonlyArray<{ key: ColorMode; label: string; title: string }> = [
  { key: 'class', label: 'Klasse', title: 'Farbe nach LAS-Klasse (Boden, Gebäude, Vegetation …)' },
  { key: 'height', label: 'Höhe', title: 'Farbverlauf über die Geländehöhe (m ü. NN) der Punkte' },
  { key: 'agl', label: 'ü. Grund', title: 'Höhe über dem Gelände (DGM): Boden dunkel, Kronen hell' },
  { key: 'intensity', label: 'Intensität', title: 'Reflexionsstärke des Laserechos (relativ)' },
];

export const COLOR_MODE_INDEX: Record<ColorMode, number> = { class: 0, height: 1, agl: 2, intensity: 3 };

/** Classes with their own palette slot in the shader (codes 0 … MAX_CLASS_SLOTS − 1). */
export const MAX_CLASS_SLOTS = 32;

/** Display-space RGB (0–1) per LAS class code; anything else uses OTHER_CLASS_COLOR. */
export const CLASS_COLORS: Readonly<Record<number, readonly [number, number, number]>> = {
  1: [0.78, 0.62, 0.9], // Unklassifiziert: lilac
  2: [0.76, 0.58, 0.36], // Boden: tan
  6: [0.9, 0.33, 0.27], // Gebäude: red
  8: [0.45, 0.7, 1.0], // Wasser (synthetisch)
  9: [0.25, 0.5, 0.95], // Wasser
  14: [1.0, 0.86, 0.2], // Leitungen: yellow
  17: [0.62, 0.62, 0.7], // Brücke
  20: [0.38, 0.74, 0.32], // Sonstige (v. a. Vegetation): green
  24: [1.0, 0.55, 0.12], // Keller: orange
  30: [0.95, 0.35, 0.85], // Füllpunkte (synthetisch): magenta
};
export const OTHER_CLASS_COLOR: readonly [number, number, number] = [0.85, 0.85, 0.85];

export function classColor(code: number): readonly [number, number, number] {
  return CLASS_COLORS[code] ?? OTHER_CLASS_COLOR;
}

/** CSS colour for a class swatch. */
export function classColorCss(code: number): string {
  const [r, g, b] = classColor(code).map((v) => Math.round(v * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Extra hint for class labels whose meaning is not obvious in the field (shown in brackets). */
export const CLASS_HINTS_DE: Readonly<Record<number, string>> = {
  20: 'v. a. Vegetation',
};

/**
 * Class codes to offer as toggles: codes with points in any area's `classCounts`, sorted; when no
 * area has counts, every code of the label table. Always non-empty when the table is.
 */
export function presentClasses(
  areas: ReadonlyArray<{ classCounts?: Record<string, number> }>,
  table: Readonly<Record<string, string>>,
): number[] {
  const codes = new Set<number>();
  let anyCounts = false;
  for (const a of areas) {
    if (!a.classCounts) continue;
    anyCounts = true;
    for (const [k, n] of Object.entries(a.classCounts)) if (/^\d+$/.test(k) && n > 0 && Number(k) <= 255) codes.add(Number(k));
  }
  if (!anyCounts) for (const k of Object.keys(table)) if (/^\d+$/.test(k)) codes.add(Number(k));
  return [...codes].sort((a, b) => a - b);
}

export interface PointPrefs {
  on: boolean;
  mode: ColorMode;
  /** Hidden LAS class codes. */
  hidden: number[];
  /** Global point budget (points), 0.5–8 M. */
  budget: number;
  /** The user set `budget` with the slider: quality presets then leave it alone. */
  budgetUser: boolean;
  /** Point size multiplier, 0.5–3. */
  size: number;
  /** Röntgen-Linse: hide points more than this many metres above ground; null = off. */
  aglMax: number | null;
  /** Hide the terrain surface while points are shown. */
  hideTerrain: boolean;
}

export const BUDGET_RANGE = { min: 500_000, max: 8_000_000, step: 500_000 } as const;
export const SIZE_RANGE = { min: 0.5, max: 3, step: 0.1 } as const;
/** Slider range of the height-above-ground clip (m); the max slider position means "aus". */
export const AGL_RANGE = { min: 0.5, max: 40, step: 0.5 } as const;

export const DEFAULT_PREFS: PointPrefs = {
  on: false,
  mode: 'class',
  hidden: [],
  budget: 3_000_000,
  budgetUser: false,
  size: 1,
  aglMax: null,
  hideTerrain: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Tolerant parse of stored prefs (unknown/invalid fields fall back to the defaults). */
export function parsePrefs(raw: unknown): PointPrefs {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  return {
    on: typeof p.on === 'boolean' ? p.on : d.on,
    mode: COLOR_MODES.some((m) => m.key === p.mode) ? (p.mode as ColorMode) : d.mode,
    hidden: Array.isArray(p.hidden) ? [...new Set(p.hidden.filter((c): c is number => Number.isInteger(c) && c >= 0 && c <= 255))] : [],
    budget: isNum(p.budget) ? clamp(p.budget, BUDGET_RANGE.min, BUDGET_RANGE.max) : d.budget,
    // v1.0 prefs had no flag: a saved budget no quality preset produces was the user's own.
    budgetUser:
      typeof p.budgetUser === 'boolean'
        ? p.budgetUser
        : isNum(p.budget) && !Object.values(QUALITY_PRESETS).some((k) => k.pointBudget === p.budget),
    size: isNum(p.size) ? clamp(p.size, SIZE_RANGE.min, SIZE_RANGE.max) : d.size,
    aglMax: p.aglMax === null ? null : isNum(p.aglMax) ? clamp(p.aglMax, AGL_RANGE.min, AGL_RANGE.max) : d.aglMax,
    hideTerrain: typeof p.hideTerrain === 'boolean' ? p.hideTerrain : d.hideTerrain,
  };
}

/** "3,5 Mio." / "820 Tsd." / "940" — German compact point counts. */
export function formatPoints(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.`;
  if (n >= 1e4) return `${Math.round(n / 1e3).toLocaleString('de-DE')} Tsd.`;
  return Math.round(n).toLocaleString('de-DE');
}

/** "12,3 MB" / "1,2 GB" (decimal units, de-DE). */
export function formatBytes(b: number): string {
  if (!(b > 0)) return '0 MB';
  if (b >= 1e9) return `${(b / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 2 })} GB`;
  return `${(b / 1e6).toLocaleString('de-DE', { maximumFractionDigits: b >= 1e8 ? 0 : 1 })} MB`;
}

/** Combined true-height range of the areas (fallback when none carries `heightRange`). */
export function heightRangeOf(
  areas: ReadonlyArray<{ heightRange?: { min: number; max: number } }>,
  fallback: { min: number; max: number },
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const a of areas) {
    if (!a.heightRange) continue;
    min = Math.min(min, a.heightRange.min);
    max = Math.max(max, a.heightRange.max);
  }
  return min < max ? { min, max } : { ...fallback };
}
