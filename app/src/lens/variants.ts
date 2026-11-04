/**
 * Relikt-Blick lens variants (V2.5): what the lens blends over the aerial ground. Standard always
 * uses `relief`; Entdecker chooses among three relief variants and the *Zeitreise* maps.
 * Each variant names layer keys in order of preference; the first one the AOI has wins.
 */
export type LensVariantId = 'relief' | 'lrm' | 'slope' | 'hist_1840' | 'hist_1935';

export interface LensVariant {
  id: LensVariantId;
  /** German chip label. */
  label: string;
  /** German tooltip. */
  title: string;
  group: 'relief' | 'zeitreise';
  /** Lowest tier that may pick it. */
  tier: 'standard' | 'entdecker';
  /** Layer keys (manifest or live) in order of preference. */
  keys: readonly string[];
  /** Maximum lens mix over the aerial ground (1 = lens only). */
  strength: number;
  /** Colour tint of the lens channel. */
  tint: readonly [number, number, number];
}

const PAPER: readonly [number, number, number] = [1.0, 0.95, 0.86];
const NEUTRAL: readonly [number, number, number] = [1, 1, 1];

export const LENS_VARIANTS: readonly LensVariant[] = [
  { id: 'relief', label: 'Relief', title: 'Geländerelief unter dem Wald (VAT)', group: 'relief', tier: 'standard', keys: ['vat', 'live-hillshade'], strength: 0.92, tint: PAPER },
  { id: 'lrm', label: 'Senken & Wälle', title: 'Lokales Relief: Senken blau, Erhebungen rot', group: 'relief', tier: 'entdecker', keys: ['slrm', 'live-lrm'], strength: 0.88, tint: NEUTRAL },
  { id: 'slope', label: 'Hangkanten', title: 'Hangneigung: Kanten von Gräben, Wällen und Terrassen', group: 'relief', tier: 'entdecker', keys: ['slope', 'live-slope'], strength: 0.88, tint: NEUTRAL },
  { id: 'hist_1840', label: '1840', title: 'Zeitreise: Karte 1836–41 über dem Gelände', group: 'zeitreise', tier: 'entdecker', keys: ['hist_1840'], strength: 0.9, tint: NEUTRAL },
  { id: 'hist_1935', label: '1935', title: 'Zeitreise: Karte 1935–40 über dem Gelände', group: 'zeitreise', tier: 'entdecker', keys: ['hist_1935'], strength: 0.9, tint: NEUTRAL },
];

export const DEFAULT_VARIANT: LensVariantId = 'relief';

export interface ResolvedVariant extends LensVariant {
  /** The layer key this AOI uses. */
  key: string;
}

/** Variants whose data exists (`has(key)`), each with its first available key. */
export function resolveVariants(has: (key: string) => boolean, list: readonly LensVariant[] = LENS_VARIANTS): ResolvedVariant[] {
  const out: ResolvedVariant[] = [];
  for (const v of list) {
    const key = v.keys.find(has);
    if (key) out.push({ ...v, key });
  }
  return out;
}

export const isVariantId = (x: unknown): x is LensVariantId => LENS_VARIANTS.some((v) => v.id === x);

/** `wanted` if available and allowed in this tier, else the first Standard variant (or null). */
export function pickVariant(resolved: readonly ResolvedVariant[], wanted: unknown, entdecker: boolean): ResolvedVariant | null {
  const ok = (v: ResolvedVariant) => entdecker || v.tier === 'standard';
  return resolved.find((v) => v.id === wanted && ok(v)) ?? resolved.find((v) => v.tier === 'standard') ?? resolved.find(ok) ?? null;
}
