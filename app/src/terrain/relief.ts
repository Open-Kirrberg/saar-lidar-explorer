/**
 * Pure relief-display logic (no three.js): display modes, colormaps, contrast stretch,
 * blend presets. Shared by Terrain (uniforms), the relief panel (UI) and tests.
 *
 * Every display source yields a *physical* value per pixel (hillshade 0–1, slope in °,
 * local relief in m, manifest layers decoded with their manifest min/max). A channel maps
 * that value through a stretch [lo, hi] + gamma and a colormap.
 */
import type { ImageLayerSource, LayerSource } from '../data/manifest';

// ---- colormaps --------------------------------------------------------------------------------

/** Keep in sync with `applyColormap()` in terrain.frag.glsl. */
export const Colormap = {
  Gray: 0,
  GrayInv: 1,
  Diverging: 2,
  Viridis: 3,
  Canopy: 4,
  Mask: 5,
} as const;
export type Colormap = (typeof Colormap)[keyof typeof Colormap];

export const COLORMAP_LABELS: Record<Colormap, string> = {
  [Colormap.Gray]: 'Grau',
  [Colormap.GrayInv]: 'Grau invertiert',
  [Colormap.Diverging]: 'Blau–Weiß–Rot',
  [Colormap.Viridis]: 'Viridis',
  [Colormap.Canopy]: 'Grün (Vegetation)',
  [Colormap.Mask]: 'Kategorien (Maske)',
};

type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const DIV_NB: RGB = [0.13, 0.3, 0.62];
const DIV_NM: RGB = [0.56, 0.72, 0.87];
const DIV_Z: RGB = [0.96, 0.95, 0.92];
const DIV_PM: RGB = [0.94, 0.63, 0.47];
const DIV_PR: RGB = [0.68, 0.11, 0.15];

/** Blue – white – red for s ∈ [−1, 1] (negative = depressions). Mirrors the GLSL. */
export function diverging(s: number): RGB {
  s = Math.max(-1, Math.min(1, s));
  if (s < 0) {
    const t = -s;
    return t < 0.5 ? mixRgb(DIV_Z, DIV_NM, t * 2) : mixRgb(DIV_NM, DIV_NB, t * 2 - 1);
  }
  return s < 0.5 ? mixRgb(DIV_Z, DIV_PM, s * 2) : mixRgb(DIV_PM, DIV_PR, s * 2 - 1);
}

const CAN_STOPS: RGB[] = [
  [0.93, 0.91, 0.72],
  [0.66, 0.8, 0.42],
  [0.3, 0.6, 0.26],
  [0.1, 0.36, 0.17],
  [0.04, 0.2, 0.11],
];
/** Pale yellow-green (shrubs) → dark green (tall canopy), t ∈ [0, 1]. Mirrors the GLSL. */
export function canopyRamp(t: number): RGB {
  t = clamp01(t) * (CAN_STOPS.length - 1);
  const k = Math.min(Math.floor(t), CAN_STOPS.length - 2);
  return mixRgb(CAN_STOPS[k], CAN_STOPS[k + 1], t - k);
}

// Polynomial fit of matplotlib's viridis (same coefficients as the shader).
const VIR = [
  [0.2777273272234177, 0.005407344544966578, 0.3340998053353061],
  [0.1050930431085774, 1.404613529898575, 1.384590162594685],
  [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
  [-4.634230498983486, -5.799100973351585, -19.33244095627987],
  [6.228269936347081, 14.17993336680509, 56.69055260068105],
  [4.776384997670288, -13.74514537774601, -65.35303263337234],
  [-5.435455855934631, 4.645852612178535, 26.3124352495832],
];
export function viridis(t: number): RGB {
  t = clamp01(t);
  const out: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let v = VIR[6][c];
    for (let k = 5; k >= 0; k--) v = VIR[k][c] + t * v;
    out[c] = clamp01(v);
  }
  return out;
}

export const MASK_COLORS: RGB[] = [
  [0.85, 0.85, 0.85], // 0 = LVGL-SL 2025 (shown as plain hillshade)
  [0.95, 0.6, 0.2], // 0.5 = RLP 2022 fill
  [0.85, 0.15, 0.45], // 1 = interpolated gap
];

export interface Stretch {
  /** Physical value mapped to the bottom of the colormap. */
  lo: number;
  /** Physical value mapped to the top of the colormap. */
  hi: number;
  /** Display gamma: output = t^(1/gamma) (gamma > 1 brightens mid-tones). */
  gamma: number;
}

/**
 * Normalised colormap coordinate of physical value `v`.
 * Returns t ∈ [0, 1] for sequential maps and s ∈ [−1, 1] for diverging ones
 * (diverging: physical 0 is the centre when lo < 0 < hi, each side scaled separately).
 */
export function normalise(v: number, st: Stretch, cmap: Colormap): number {
  const g = 1 / Math.max(st.gamma, 1e-3);
  if (cmap === Colormap.Diverging) {
    let s: number;
    if (st.lo < 0 && st.hi > 0) s = v < 0 ? -v / st.lo : v / st.hi;
    else s = (2 * (v - st.lo)) / Math.max(st.hi - st.lo, 1e-9) - 1;
    s = Math.max(-1, Math.min(1, s));
    return Math.sign(s) * Math.abs(s) ** g;
  }
  const t = clamp01((v - st.lo) / Math.max(st.hi - st.lo, 1e-9));
  return t ** g;
}

/** Display colour (0–1 RGB, before hillshade modulation) of physical value `v`. */
export function colorFor(v: number, st: Stretch, cmap: Colormap): RGB {
  const n = normalise(v, st, cmap);
  switch (cmap) {
    case Colormap.GrayInv:
      return [1 - n, 1 - n, 1 - n];
    case Colormap.Diverging:
      return diverging(n);
    case Colormap.Viridis:
      return viridis(n);
    case Colormap.Canopy:
      return canopyRamp(n);
    case Colormap.Mask:
      return MASK_COLORS[Math.round(clamp01((v - st.lo) / Math.max(st.hi - st.lo, 1e-9)) * 2)];
    default:
      return [n, n, n];
  }
}

/** CSS linear-gradient for a legend bar. */
export function legendGradient(st: Stretch, cmap: Colormap, steps = 12): string {
  const css = (c: RGB) => `rgb(${c.map((x) => Math.round(clamp01(x) * 255)).join(',')})`;
  if (cmap === Colormap.Mask) {
    const [a, b, c] = MASK_COLORS.map(css);
    return `linear-gradient(90deg, ${a} 0 33%, ${b} 33% 67%, ${c} 67% 100%)`;
  }
  const stops: string[] = [];
  for (let k = 0; k <= steps; k++) {
    const v = st.lo + ((st.hi - st.lo) * k) / steps;
    stops.push(`${css(colorFor(v, st, cmap))} ${((100 * k) / steps).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// ---- percentile stretch ----------------------------------------------------------------------

export interface PercentileOptions {
  /** Lower percentile (0–100), default 2. */
  low?: number;
  /** Upper percentile (0–100), default 98. */
  high?: number;
  /** Symmetric about 0 (diverging data): ±max(|p_low|, |p_high|). */
  symmetric?: boolean;
  /** Subsample to at most this many values (default 250 000). */
  maxSamples?: number;
}

/** Nearest-rank-interpolated percentile of an ascending sorted array. */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const x = (clamp01(p / 100) * (n - 1));
  const k = Math.floor(x);
  const f = x - k;
  return k + 1 < n ? sorted[k] * (1 - f) + sorted[k + 1] * f : sorted[k];
}

/**
 * Percentile contrast stretch over `values` (NaN / non-finite values are ignored).
 * Returns null if fewer than 16 valid values or the range is degenerate.
 */
export function percentileStretch(
  values: ArrayLike<number>,
  opts: PercentileOptions = {},
): { lo: number; hi: number; count: number } | null {
  const { low = 2, high = 98, symmetric = false, maxSamples = 250_000 } = opts;
  const n = values.length;
  const step = Math.max(1, Math.floor(n / maxSamples));
  const buf = new Float32Array(Math.ceil(n / step));
  let m = 0;
  for (let k = 0; k < n; k += step) {
    const v = values[k];
    if (Number.isFinite(v)) buf[m++] = v;
  }
  if (m < 16) return null;
  const s = buf.subarray(0, m).sort();
  let lo = percentileSorted(s, low);
  let hi = percentileSorted(s, high);
  if (symmetric) {
    const a = Math.max(Math.abs(lo), Math.abs(hi));
    lo = -a;
    hi = a;
  }
  if (!(hi - lo > 1e-6)) return null;
  return { lo, hi, count: m };
}

// ---- display modes ----------------------------------------------------------------------------

export type SourceKind = 'live-hillshade' | 'live-slope' | 'live-lrm' | 'layer' | 'image';

/**
 * Shader source ids (`uBaseSrc` / `uOvlSrc`). Keep in sync with terrain.frag.glsl.
 * ImageA/ImageB: an `rgb` image layer (F13/F14) bound to slot A/B — a colour, not a value (no
 * stretch/colormap, never part of the auto-contrast value pass).
 */
export const ShaderSource = { Off: -1, Hillshade: 0, Slope: 1, LocalRelief: 2, LayerA: 3, LayerB: 4, ImageA: 5, ImageB: 6 } as const;

export const LIVE_SOURCES: Record<string, { kind: SourceKind; label: string; unit?: string }> = {
  'live-hillshade': { kind: 'live-hillshade', label: 'Schummerung (live)' },
  'live-slope': { kind: 'live-slope', label: 'Hangneigung (live)', unit: '°' },
  'live-lrm': { kind: 'live-lrm', label: 'Lokales Relief (live)', unit: 'm' },
};

export interface ModeEntry {
  /** Display key (live key or manifest layer key). */
  key: string;
  /** Keyboard shortcut ('1'…'9', '0'). */
  shortcut: string;
  /** Short button label (German). */
  label: string;
  /** Hint (German) shown under the legend. */
  hint: string;
}

/**
 * The relief switcher ("Darstellung"), in shortcut order. Manifest layers that are missing
 * are dropped by `availableModes()`; labels of manifest layers come from `label_de`.
 */
export const MODE_TABLE: ModeEntry[] = [
  { key: 'vat', shortcut: '1', label: 'VAT', hint: 'Kombination aus Schummerung, Neigung, Offenheit und Himmelssicht – Standard zum Suchen.' },
  { key: 'live-hillshade', shortcut: '2', label: 'Schummerung', hint: 'Live-Schummerung: Sonnenstand unter „Sonne“. Flach einfallendes Licht zeigt feine Kanten.' },
  { key: 'live-slope', shortcut: '3', label: 'Hangneigung', hint: 'Steile Stellen dunkel: Böschungen, Terrassenkanten, Wälle.' },
  { key: 'slrm', shortcut: '4', label: 'Lokales Relief', hint: 'DGM minus geglättetes DGM (vorberechnet). Rot = Erhebung, Blau = Senke.' },
  { key: 'live-lrm', shortcut: '5', label: 'Relief live', hint: 'Wie Lokales Relief, Radius frei wählbar (Relief-Radius).' },
  { key: 'svf', shortcut: '6', label: 'Himmelssicht', hint: 'Sky-View Factor: Gräben, Gruben und Fundamentgräben dunkel.' },
  { key: 'opns_pos', shortcut: '7', label: 'Offenheit +', hint: 'Positive Offenheit: Mauern, Wälle, Kanten hell.' },
  { key: 'opns_neg', shortcut: '8', label: 'Offenheit −', hint: 'Negative Offenheit (invertiert): Gräben, Hohlwege, Gruben dunkel.' },
  { key: 'chm', shortcut: '9', label: 'Vegetation', hint: 'Vegetations-/Objekthöhe (DOM − DGM).' },
  { key: 'mask', shortcut: '0', label: 'Ergänzt', hint: 'Grau = LVGL-SL 2025 · Orange = aus RLP 2022 ergänzt · Magenta = interpoliert.' },
];

export function isLiveKey(key: string): boolean {
  return key in LIVE_SOURCES;
}

/** Modes whose source exists (live modes always; layers only if in the manifest). */
export function availableModes(layers: Record<string, LayerSource>): ModeEntry[] {
  return MODE_TABLE.filter((m) => isLiveKey(m.key) || layers[m.key]?.encoding === 'u8');
}

/** Hints for the image modes (F13/F14); other `rgb` keys use their manifest label only. */
const IMAGE_HINTS: Record<string, string> = {
  ortho: 'Luftbild (Orthophoto) auf dem Gelände. Kombination „Luftbild × Relief“ legt das VAT darüber.',
  hist_1840: 'Bayerische Originalpositionsblätter 1:25 000, 1836–41. „Karte ↔ Relief“ überblendet sie mit dem Relief.',
};

/**
 * Image modes ("Bilder"): one entry per manifest `rgb` layer, `ortho` first, then `hist_*` by
 * key. They have no number shortcut (`shortcut` = ''); labels come from `label_de`.
 */
export function imageModes(images: Record<string, ImageLayerSource> | undefined): ModeEntry[] {
  const keys = Object.keys(images ?? {}).sort((a, b) => (a === 'ortho' ? -1 : b === 'ortho' ? 1 : a.localeCompare(b)));
  return keys.map((key) => ({
    key,
    shortcut: '',
    label: shortImageLabel(key, images![key].label_de),
    hint: IMAGE_HINTS[key] ?? `${images![key].label_de} (Farbbild, keine Farbskala).`,
  }));
}

/** Compact button label for an image layer: 'Luftbild', 'Karte 1840', else the manifest label. */
export function shortImageLabel(key: string, label: string): string {
  if (key === 'ortho') return 'Luftbild';
  const m = /^hist_(\d{4})$/.exec(key);
  if (m) return `Karte ${m[1]}`;
  return label || key;
}

/**
 * Image ↔ relief mixing slider (F13/F14). t ∈ [0, 1]: 0 = only the image, 1 = only the relief.
 * When the image is the overlay, t = 1 − opacity; when it is the base under a relief overlay,
 * t = opacity. Returns the overlay opacity, or null when no image is involved.
 */
export function mixToOpacity(t: number, imageIs: 'base' | 'overlay' | null): number | null {
  const c = clamp01(t);
  if (imageIs === 'overlay') return 1 - c;
  if (imageIs === 'base') return c;
  return null;
}

/**
 * Texts for the image ↔ relief slider: `label` above it, `lo`/`hi` at its ends (t = 0 / t = 1).
 * With the image as base under a non-Normal relief overlay (Multiply/Screen/…), t = 1 is
 * “image × relief” at full strength, never relief alone — so the slider is a relief strength.
 */
export function mixTexts(imageLabel: string, imageIs: 'base' | 'overlay', overlayBlend: BlendMode): { label: string; lo: string; hi: string } {
  if (imageIs === 'base' && overlayBlend !== BlendMode.Normal) {
    const op = overlayBlend === BlendMode.Multiply ? '×' : '+';
    return { label: 'Relief-Stärke', lo: imageLabel, hi: `${imageLabel} ${op} Relief` };
  }
  return { label: `${imageLabel} ↔ Relief`, lo: imageLabel, hi: 'Relief' };
}

/** Inverse of `mixToOpacity` (slider position for the current overlay opacity). */
export function opacityToMix(opacity: number, imageIs: 'base' | 'overlay' | null): number | null {
  return mixToOpacity(opacity, imageIs);
}

/** Physical value range a source can take (slider bounds). */
export function sourceRange(key: string, layer?: LayerSource): { min: number; max: number; unit: string } {
  if (key === 'live-hillshade') return { min: 0, max: 1, unit: '' };
  if (key === 'live-slope') return { min: 0, max: 90, unit: '°' };
  if (key === 'live-lrm') return { min: -3, max: 3, unit: 'm' };
  if (layer) return { min: layer.min, max: layer.max, unit: unitLabel(layer.unit) };
  return { min: 0, max: 1, unit: '' };
}

function unitLabel(u?: string): string {
  if (!u) return '';
  return u === 'deg' ? '°' : u;
}

/** Default colormap per display key, derived from the key and the manifest range. */
export function defaultColormap(key: string, layer?: LayerSource): Colormap {
  if (key === 'live-lrm') return Colormap.Diverging;
  if (key === 'live-slope' || key === 'slope') return Colormap.GrayInv;
  if (key === 'opns_neg') return Colormap.GrayInv;
  if (key === 'chm') return Colormap.Canopy;
  if (key === 'mask') return Colormap.Mask;
  if (layer && layer.min < 0 && layer.max > 0) return Colormap.Diverging;
  return Colormap.Gray;
}

/**
 * Default stretch per display key. Signed layers (local relief) start with a ±30 % window of
 * the manifest range, since relicts are usually ±0.2–1 m features; others use the full range.
 */
export function defaultStretch(key: string, layer?: LayerSource): Stretch {
  if (key === 'live-hillshade') return { lo: 0, hi: 1, gamma: 1 };
  if (key === 'live-slope') return { lo: 0, hi: layer?.max ?? 40, gamma: 1.25 };
  if (key === 'live-lrm') return { lo: -0.6, hi: 0.6, gamma: 1 };
  if (!layer) return { lo: 0, hi: 1, gamma: 1 };
  if (layer.min < 0 && layer.max > 0) {
    const a = 0.3 * Math.max(-layer.min, layer.max);
    return { lo: -a, hi: a, gamma: 1 };
  }
  return { lo: layer.min, hi: layer.max, gamma: 1 };
}

// ---- overlay blending + presets --------------------------------------------------------------------

/** Keep in sync with `blendColor()` in terrain.frag.glsl. */
export const BlendMode = { Normal: 0, Multiply: 1, Screen: 2, Overlay: 3, SoftLight: 4 } as const;
export type BlendMode = (typeof BlendMode)[keyof typeof BlendMode];
export const BLEND_LABELS: Record<BlendMode, string> = {
  [BlendMode.Normal]: 'Normal',
  [BlendMode.Multiply]: 'Multiplizieren',
  [BlendMode.Screen]: 'Negativ multiplizieren',
  [BlendMode.Overlay]: 'Ineinanderkopieren',
  [BlendMode.SoftLight]: 'Weiches Licht',
};

/** Blend in display space, all values 0–1. Mirrors the GLSL (used by tests / docs). */
export function blendColor(b: number, o: number, mode: BlendMode): number {
  switch (mode) {
    case BlendMode.Multiply:
      return b * o;
    case BlendMode.Screen:
      return 1 - (1 - b) * (1 - o);
    case BlendMode.Overlay:
      return b < 0.5 ? 2 * b * o : 1 - 2 * (1 - b) * (1 - o);
    case BlendMode.SoftLight:
      return (1 - 2 * o) * b * b + 2 * o * b;
    default:
      return o;
  }
}

export interface ChannelSettings {
  colormap: Colormap;
  stretch: Stretch;
  /** Hillshade modulation of colour maps, 0 = flat colours, 1 = strongly shaded. */
  shade: number;
}

export interface OverlaySettings extends ChannelSettings {
  /** Display key of the overlay source, or '' for none. */
  key: string;
  opacity: number;
  blend: BlendMode;
}

export interface Preset {
  id: string;
  label: string;
  hint: string;
  base: string;
  baseOverride?: { colormap?: Colormap; stretch?: Partial<Stretch>; shade?: number };
  overlay: { key: string; opacity: number; blend: BlendMode; colormap?: Colormap; stretch?: Partial<Stretch>; shade?: number } | null;
  sun?: { azimuth?: number; elevation?: number; directions?: number };
  /** Radius (m) for the live local relief. */
  lrmRadius?: number;
  /** Label of the image ↔ relief slider shown while this preset is active (image presets). */
  mixLabel?: string;
}

/**
 * Blend presets. Unspecified stretch fields fall back to the mode's default stretch,
 * so presets follow the manifest ranges.
 */
export const PRESETS: Preset[] = [
  {
    id: 'relikte',
    label: 'Relikte suchen',
    hint: 'VAT × Lokales Relief (multipliziert): Erhebungen rötlich, Senken bläulich auf VAT.',
    base: 'vat',
    overlay: { key: 'slrm', opacity: 0.6, blend: BlendMode.Multiply, colormap: Colormap.Diverging, stretch: { gamma: 0.8 } },
  },
  {
    id: 'graeben',
    label: 'Gräben & Gruben',
    hint: 'Himmelssicht × Offenheit − (invertiert): Gräben, Hohlwege, Gruben, Keller dunkel.',
    base: 'svf',
    baseOverride: { stretch: { gamma: 1.4 } },
    overlay: { key: 'opns_neg', opacity: 0.6, blend: BlendMode.Multiply, colormap: Colormap.GrayInv },
  },
  {
    id: 'mauern',
    label: 'Mauern & Kanten',
    hint: 'Offenheit + mit Hangneigung (multipliziert): Mauerzüge hell, Kanten dunkel umrandet.',
    base: 'opns_pos',
    overlay: { key: 'live-slope', opacity: 0.55, blend: BlendMode.Multiply, colormap: Colormap.GrayInv, stretch: { lo: 0, hi: 35 } },
  },
  {
    id: 'schummer-lrm',
    label: 'Schummerung × Relief',
    hint: 'Flache Live-Schummerung (NW, 25°) × Live-Lokalrelief mit 10 m Radius: feine Mauern und Gruben farbcodiert.',
    base: 'live-hillshade',
    overlay: { key: 'live-lrm', opacity: 0.5, blend: BlendMode.Multiply, colormap: Colormap.Diverging, stretch: { lo: -0.5, hi: 0.5 } },
    sun: { azimuth: 315, elevation: 25, directions: 1 },
    lrmRadius: 10,
  },
];

/**
 * Image presets (F13/F14), offered after PRESETS when the manifest has the keys (Umschalt + 5/6 …).
 * The overlay opacity is driven by the image ↔ relief slider (`mixToOpacity`).
 */
export const IMAGE_PRESETS: Preset[] = [
  {
    id: 'luftbild-relief',
    label: 'Luftbild × Relief',
    hint: 'Luftbild mit VAT multipliziert: Farben aus dem Luftbild, Relief unter dem Wald sichtbar. Regler: Relief-Stärke.',
    base: 'ortho',
    overlay: { key: 'vat', opacity: 0.6, blend: BlendMode.Multiply },
    mixLabel: 'Relief-Stärke',
  },
  {
    id: 'karte-relief',
    label: 'Karte 1840 ↔ Relief',
    hint: 'Bayer. Positionsblätter 1836–41 über dem VAT: Wege, Gebäude und Waldgrenzen von damals mit dem Relief vergleichen. Regler: Karte ↔ Relief.',
    base: 'vat',
    overlay: { key: 'hist_1840', opacity: 0.6, blend: BlendMode.Normal },
    mixLabel: 'Karte ↔ Relief',
  },
];
