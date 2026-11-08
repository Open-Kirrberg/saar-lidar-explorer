/**
 * F10 "Wege (OSM)" in 3D: lazy loading from `manifest.vectors`, panel card with a toggle (key O),
 * per-frame update via `scene.onBeforeRender` (so it also runs for `window.sle.step()` without
 * touching main.ts's loop), and the F12 local parcel lookup for markers. Flurstücke are no longer
 * drawn in 3D (ADR 0020): the data stay for lookups, the minimap shows them as a 2D overlay.
 */
import type { Scene } from 'three';
import type { VectorLayer } from '../data/manifest';
import type { AppContext } from '../main';
import { setLocalParcelLookup } from '../markers/parcel';
import { isTyping } from '../ui/keys';
import { createPanelSection } from '../ui/panelSection';
import type { ParcelLabelProps } from '../data/manifest';
import { DrapedLines } from './DrapedLines';
import { SEG_STRIDE, toLocal } from './drape';
import { formatParcel } from './labels';
import { PointIndex, SegmentIndex, findParcelLabel } from './spatial';
import { STYLES } from './styles';
import { ParcelPolygonIndex } from './parcelPolygons';
import { initCatalogVectors } from './catalogVectors';
import { tileClipFor } from './parcelEdges';
import { loadLineLayer, loadParcelPolygons, loadPointLayer } from './vectorLoader';
import './vectors.css';

declare global {
  interface Window {
    sleVectors?: VectorLayersApi;
  }
}

const PREFS_KEY = 'sle.vectors.v1';
interface Prefs {
  osm: boolean;
}

function readPrefs(): Prefs {
  const d: Prefs = { osm: false };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      osm: typeof p.osm === 'boolean' ? p.osm : d.osm,
    };
  } catch {
    return d;
  }
}

function writePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Parcel label points + boundaries, loaded only for the label-nearest lookup fallback. */
interface ParcelData {
  props: ParcelLabelProps[];
  pointIndex: PointIndex;
  /** Parcel boundary index for the local lookup — built lazily on the first lookup. */
  boundaries(): SegmentIndex;
}

export interface VectorLayersApi {
  osm: DrapedLines | null;
  setOsm(on: boolean): Promise<void>;
  /**
   * Local parcel lookup: point-in-polygon on `flurstuecke.polygons` when the manifest lists it
   * (lazy, parsed in the worker); otherwise / if that file is missing, the nearest label point
   * within 60 m whose connecting line crosses no boundary. Null if nothing found.
   */
  lookupLocal(E: number, N: number): Promise<string | null>;
  /** Polygon index (null until loaded, or when absent/unavailable). */
  polygons(): ParcelPolygonIndex | null;
}

/** Returns null (and adds no UI) when the manifest has no vector layers. */
export function initVectorLayers(ctx: AppContext, panel: HTMLElement): VectorLayersApi | null {
  if (ctx.catalog) return initCatalogVectors(ctx, ctx.catalog, panel); // S2: per-place files, session frame
  const vec = ctx.manifest.vectors;
  if (!vec?.osm && !vec?.flurstuecke) return null;
  const { terrain, camera, renderer, scene, manifest } = ctx;
  const base = terrain.baseUrl;
  const origin = manifest.origin;
  const prefs = readPrefs();

  // ---- panel ------------------------------------------------------------------------------
  const sec = createPanelSection(panel, 'vectors', 'Wege', true);
  const legend = STYLES.filter((s) => s.key !== 'parcel')
    .map((s) => `<span class="sle-vec-key"><i style="background:rgb(${s.color.map((c) => Math.round(c * 255)).join(',')})"></i>${s.label_de}</span>`)
    .join('');
  sec.body.innerHTML = `
    <div class="sle-row" data-row="osm">
      <label title="OpenStreetMap-Wege auf dem Gelände (Taste O)"><input type="checkbox" data-k="osm"> Wege (OSM) <kbd>O</kbd></label>
      <span class="sle-dim sle-vec-status" data-s="osm"></span>
    </div>
    <div class="sle-vec-legend sle-dim" data-row="osm">${legend}</div>
    <p class="sle-dim sle-small" data-row="attr"></p>`;
  const q = <T extends HTMLElement>(sel: string) => sec.body.querySelector<T>(sel)!;
  const cbOsm = q<HTMLInputElement>('[data-k=osm]');
  const status = (k: 'osm', t: string) => (q(`[data-s=${k}]`).textContent = t);
  sec.root.hidden = !vec.osm; // parcels alone: lookup only, no card
  q('[data-row=attr]').textContent = 'Wege: © OpenStreetMap-Mitwirkende, ODbL.';

  // ---- per-frame hook ---------------------------------------------------------------------
  const api: VectorLayersApi = {
    osm: null,
    setOsm,
    lookupLocal,
    polygons: () => polyIndex,
  };
  const prev = scene.onBeforeRender.bind(scene);
  (scene as Scene).onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
    prev(...args);
    if (args[2] !== camera) return; // other cameras/passes are not ours
    api.osm?.update(camera, renderer);
  };

  // ---- loading ----------------------------------------------------------------------------
  const bucketSize = manifest.chunkSize * manifest.cellSize;
  const fallbackH = manifest.heightRange.min;
  let osmLoading: Promise<DrapedLines | null> | null = null;
  function loadOsm(layer: VectorLayer): Promise<DrapedLines | null> {
    osmLoading ??= (async () => {
      status('osm', 'lädt …');
      try {
        const data = await loadLineLayer(base + layer.path, origin, 'osm', bucketSize, fallbackH);
        const dl = new DrapedLines(data.buckets, terrain, { fade: [3500, 6000], renderOrder: 5 });
        dl.visible = false;
        scene.add(dl);
        api.osm = dl;
        status('osm', `${data.lineCount.toLocaleString('de-DE')} Linien`);
        return dl;
      } catch (err) {
        console.warn('[vectors] osm', err);
        status('osm', `nicht verfügbar (${err instanceof Error ? err.message : String(err)})`);
        osmLoading = null; // allow a retry on the next toggle (don't cache the failure)
        return null;
      }
    })();
    return osmLoading;
  }

  // v3 (S2): derived parcel lines are clipped to the present tiles (polygons are not clipped).
  const clip = manifest.presence ? tileClipFor({ E0: origin.E0, N0: origin.N0, H: manifest.size.height }, manifest.presence, origin) : undefined;
  let parcelLoading: Promise<ParcelData | null> | null = null;
  function loadParcels(): Promise<ParcelData | null> {
    const layer = vec!.flurstuecke!;
    parcelLoading ??= (async () => {
      try {
        const [lineData, pts] = await Promise.all([
          layer.lines === 'derived'
            ? loadLineLayer(base + layer.polygons!, origin, 'parcel', bucketSize, fallbackH, { derive: 'polygon-edges', ...(clip ? { clip } : {}) })
            : loadLineLayer(base + layer.path, origin, 'parcel', bucketSize, fallbackH),
          loadPointLayer(base + layer.labels, origin),
        ]);
        let boundaries: SegmentIndex | null = null;
        const data: ParcelData = {
          props: pts.props,
          pointIndex: new PointIndex(pts.xs, pts.zs, 50),
          boundaries: () => (boundaries ??= SegmentIndex.fromRecords(lineData.buckets, SEG_STRIDE, 25)),
        };
        return data;
      } catch (err) {
        console.warn('[vectors] flurstuecke', err);
        parcelLoading = null; // allow a retry on the next lookup
        return null;
      }
    })();
    return parcelLoading;
  }

  async function setOsm(on: boolean): Promise<void> {
    prefs.osm = on;
    cbOsm.checked = on;
    writePrefs(prefs);
    if (!vec?.osm) return;
    const dl = on ? await loadOsm(vec.osm) : api.osm;
    if (dl) dl.visible = prefs.osm;
  }

  // Point-in-polygon lookup (contract `flurstuecke.polygons`, optional). A failed load (404,
  // malformed) disables only this path; the label-nearest fallback below stays available.
  let polyIndex: ParcelPolygonIndex | null = null;
  let polyLoading: Promise<ParcelPolygonIndex | null> | null = null;
  function loadPolygons(): Promise<ParcelPolygonIndex | null> {
    const path = vec?.flurstuecke?.polygons;
    if (!path) return Promise.resolve(null);
    polyLoading ??= (async () => {
      try {
        const data = await loadParcelPolygons(base + path);
        polyIndex = new ParcelPolygonIndex(data);
        return polyIndex;
      } catch (err) {
        console.warn('[vectors] parcel polygons unavailable, using label points', err);
        return null;
      }
    })();
    return polyLoading;
  }

  async function lookupLocal(E: number, N: number): Promise<string | null> {
    if (!vec?.flurstuecke) return null;
    const poly = await loadPolygons();
    if (poly) {
      const p = poly.lookup(E, N);
      // Polygons are unclipped and cover the AOI: a miss means "no parcel here", not "unknown".
      return p ? formatParcel(p) : null;
    }
    const d = await loadParcels();
    if (!d) return null;
    const { x, z } = toLocal(E, N, origin);
    const k = findParcelLabel(x, z, d.pointIndex, d.boundaries(), 60);
    return k < 0 ? null : formatParcel(d.props[k]);
  }
  if (vec.flurstuecke) setLocalParcelLookup(lookupLocal);
  window.sleVectors = api; // debug/verification handle

  // ---- inputs -----------------------------------------------------------------------------
  cbOsm.checked = prefs.osm;
  cbOsm.addEventListener('change', () => void setOsm(cbOsm.checked));
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyO' && vec.osm) void setOsm(!prefs.osm);
  });

  // Restore the persisted toggle (off by default) once the terrain heights are there.
  const restore = () => {
    if (prefs.osm) void setOsm(true);
  };
  if (terrain.heights.loadedCount > 0) restore();
  else window.addEventListener('sle:ready', restore, { once: true });

  return api;
}
