/**
 * Catalog mode session (S2, contract "Many places (v3, S2)"), pure part: the session manifest that
 * the rest of the app sees as `ctx.manifest`. Its rectangle is the session rectangle on the global
 * grid (overview bbox ∪ 3D places, aligned at S_K) and its `origin` is the one float64 session
 * origin; chunk files come from the places / overview through the CatalogResolver, never from this
 * manifest's (empty) paths. No DOM, no three.
 */
import type { Catalog } from '../data/catalog';
import type { Rect } from '../data/globalGrid';
import { chunkSide } from '../data/globalGrid';
import type { DerivedMode, ImageLayerSource, LayerSource, Manifest, ManifestLevel } from '../data/manifest';
import type { Overview } from '../data/overview';

/** Fixed v3 u8 ranges (contract rule 5) with German labels: the mode table when no place is loaded yet. */
export const V3_LAYERS: Readonly<Record<string, LayerSource>> = {
  svf: { path: '', encoding: 'u8', min: 0.6, max: 1, label_de: 'Himmelssicht (SVF)', lossy: true },
  opns_pos: { path: '', encoding: 'u8', min: 60, max: 95, unit: 'deg', label_de: 'Offenheit positiv', lossy: true },
  opns_neg: { path: '', encoding: 'u8', min: 60, max: 95, unit: 'deg', label_de: 'Offenheit negativ', lossy: true },
  chm: { path: '', encoding: 'u8', min: 0, max: 40, unit: 'm', label_de: 'Vegetationshöhe' },
  mask: { path: '', encoding: 'u8', min: 0, max: 1, label_de: 'Ergänzte Daten (RLP/Lücke)' },
};

/** Default v3 derived modes (contract: a place declares all four). */
export const V3_DERIVED: Readonly<Record<string, DerivedMode>> = {
  hillshade: { method: 'live-hillshade', label_de: 'Schummerung' },
  slope: { method: 'live-slope', unit: 'deg', label_de: 'Hangneigung' },
  slrm: { method: 'live-lrm', params: { radius_m: 20 }, unit: 'm', label_de: 'Lokales Relief' },
  vat: { method: 'rvt-vat-combined-v1', inputs: ['svf', 'opns_pos'], label_de: 'VAT (Kombination)' },
};

/** Join '; '-separated attribution strings, keeping each entry once (order of first appearance). */
export function joinAttribution(...parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    for (const e of (p ?? '').split(';')) {
      const t = e.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out.join('; ');
}

/**
 * Build the session manifest. `first` = a ready place manifest (the start place) whose layer table,
 * labels and derived modes the session advertises (all v3 places share the fixed ranges); without
 * one the constant v3 table is used. Levels 0 … topLevel carry only geometry (paths are empty).
 */
export function buildSessionManifest(
  cat: Catalog,
  overview: Overview | null,
  rect: Rect,
  topLevel: number,
  first?: Manifest,
): Manifest {
  const layers: Record<string, LayerSource> = first ? { ...first.layers } : { ...V3_LAYERS };
  const imageLayers: Record<string, ImageLayerSource> = { ...(first?.imageLayers ?? {}) };
  const ovOrtho = overview?.levels[0]?.imageLayers.ortho;
  if (!imageLayers.ortho && ovOrtho) imageLayers.ortho = ovOrtho;
  const derived = { ...(first?.derived ?? V3_DERIVED) };
  if (derived.vat && !(layers.svf && layers.opns_pos)) delete derived.vat;
  const dtm = { path: '', encoding: 'terrarium' as const, apron: 1 };
  const levels: ManifestLevel[] = [];
  for (let k = 0; k <= topLevel; k++) {
    const f = 2 ** k;
    let lvLayers: Record<string, LayerSource> = layers;
    let lvImages: Record<string, ImageLayerSource> = imageLayers;
    if (k === 1) {
      lvLayers = first?.levels[1]?.layers ?? {};
      lvImages = first?.levels[1]?.imageLayers ?? {};
    } else if (k >= 2) {
      lvLayers = overview?.levels[k - 2]?.layers ?? {};
      lvImages = overview?.levels[k - 2]?.imageLayers ?? {};
    }
    levels.push({
      level: k,
      cellSize: f,
      chunkSize: 500,
      size: { width: rect.W / f, height: rect.H / f },
      chunks: { nx: rect.W / chunkSide(k), ny: rect.H / chunkSide(k) },
      height: { dtm },
      layers: lvLayers,
      imageLayers: lvImages,
    });
  }
  const hr = overview?.heightRange ?? first?.heightRange ?? { min: cat.height_ref_m, max: cat.height_ref_m + 300 };
  return {
    version: 3,
    gridOk: true,
    aoi: 'katalog',
    name: 'Orte (Katalog)',
    crs: 'EPSG:25832',
    origin: { E0: rect.E0, N0: rect.N0 },
    size: { width: rect.W, height: rect.H },
    cellSize: 1,
    chunkSize: 500,
    chunks: { nx: rect.W / 500, ny: rect.H / 500 },
    heightRange: { min: Math.min(hr.min, cat.height_ref_m), max: hr.max },
    height: { dtm },
    layers,
    imageLayers,
    ...(Object.keys(derived).length ? { derived } : {}),
    levels,
    attribution: joinAttribution(cat.attribution, overview?.attribution, first?.attribution),
  };
}
