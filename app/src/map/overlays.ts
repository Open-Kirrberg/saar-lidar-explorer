/**
 * Pure minimap overlay descriptions (no Leaflet): manifest XYZ layers (relief vs. historic-map
 * images, F14) and the live TrueDOP20 WMS (F13, 2D only).
 */
import type { ImageLayerSource, LayerSource, Manifest, XyzSource } from '../data/manifest';

/** Live WMS of the Saarland TrueDOP20 2025 (EPSG:3857 supported, CORS *, Fees none, noLimitations). */
export const DOP_WMS = {
  url: 'https://geoportal.saarland.de/freewms/truedop?',
  layer: 'sl_dop20_rgb',
  label: 'Luftbild (DOP20)',
  attribution: 'Luftbild: &copy; GeoBasis-DE/LVGL-SL (2026), <a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a> (DOP20)',
  /** Layer EX_GeographicBoundingBox (WGS84 [[S, W], [N, E]]) from GetCapabilities. */
  bounds: [
    [49.082884, 6.340597],
    [49.659757, 7.438171],
  ] as [[number, number], [number, number]],
  /** Below this zoom the 20 cm imagery is pointless and only costs the service. */
  minZoom: 12,
} as const;

export interface XyzOverlay {
  key: string;
  /** Layer-control name (German). */
  name: string;
  /** Colour map image (historic map) vs. relief tiles (share the relief opacity slider). */
  image: boolean;
  /** Attribution HTML-escaped text or undefined (caller falls back to the AOI attribution). */
  attribution?: string;
}

/** Is this `xyz` entry a colour map image (historic maps) rather than a relief overlay? */
export function isImageXyz(key: string, x: Pick<XyzSource, 'kind'>): boolean {
  return x.kind === 'image' || /^hist_/.test(key);
}

/**
 * Overlay name + kind for `xyz.<key>`. Images: `xyz.label_de`, else the `rgb` layer's label, else
 * the key (contract "xyz.hist_*"). Relief: "Relief: <u8 layer label>" (unchanged names, so saved
 * minimap prefs keep working).
 */
export function xyzOverlay(
  key: string,
  x: XyzSource,
  layers: Record<string, LayerSource>,
  imageLayers: Record<string, ImageLayerSource> | undefined,
): XyzOverlay {
  if (isImageXyz(key, x)) {
    const name = x.label_de || imageLayers?.[key]?.label_de || key;
    const attribution = x.attribution ?? imageLayers?.[key]?.attribution;
    return { key, name, image: true, ...(attribution ? { attribution } : {}) };
  }
  return { key, name: `Relief: ${layers[key]?.label_de ?? key}`, image: false, ...(x.attribution ? { attribution: x.attribution } : {}) };
}

/**
 * Catalog mode: overlay of a place's `xyz.<key>`. A v3 place has no baked level-0 `vat` u8 layer but
 * a `derived.vat` with the label, so the name matches the single-AOI one („Relief: VAT (Kombination)“)
 * and saved minimap prefs keep working. Every place's tiles of one key stack in one overlay (alpha 0
 * outside each place's own tiles, contract rule 7).
 */
export function placeXyzOverlay(key: string, x: XyzSource, m: Pick<Manifest, 'layers' | 'imageLayers' | 'derived'>): XyzOverlay {
  const d = m.derived?.[key];
  const layers = m.layers[key] || !d ? m.layers : { ...m.layers, [key]: { path: '', encoding: 'u8', min: 0, max: 1, label_de: d.label_de } as LayerSource };
  return xyzOverlay(key, x, layers, m.imageLayers);
}

/**
 * Minimap overlay prefs are global (all AOIs share them). On load, overlays this AOI defines that
 * the prefs have never seen and that are on by default are switched on once. `knownOverlays` is
 * merged (union), never replaced, so visiting an AOI without e.g. the VAT xyz layer doesn't make
 * it "new" again on the next AOI that has it.
 */
export function mergeOverlayPrefs(
  saved: { overlays: readonly string[]; knownOverlays?: readonly string[] },
  defined: readonly string[],
  defaults: readonly string[],
  legacyUnknown: readonly string[] = [],
): { overlays: string[]; knownOverlays: string[] } {
  // Prefs saved before knownOverlays existed knew everything except `legacyUnknown`.
  const known = saved.knownOverlays ?? defined.filter((n) => !legacyUnknown.includes(n));
  const overlays = [...saved.overlays];
  for (const name of defaults) if (defined.includes(name) && !known.includes(name) && !overlays.includes(name)) overlays.push(name);
  return { overlays, knownOverlays: [...new Set([...(saved.knownOverlays ?? []), ...defined])] };
}

/** Saved active overlays after a toggle: active ones of this AOI + saved ones this AOI doesn't define. */
export function syncOverlayPrefs(saved: readonly string[], defined: readonly string[], active: readonly string[]): string[] {
  return [...saved.filter((n) => !defined.includes(n)), ...active];
}
