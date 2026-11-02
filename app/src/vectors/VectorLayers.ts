/**
 * F10 "Wege (OSM)" + F12 "Flurstücke" in 3D: lazy loading from `manifest.vectors`, panel card
 * with toggles (keys O / F), per-frame update via `scene.onBeforeRender` (so it also runs for
 * `window.sle.step()` without touching main.ts's loop), and the local parcel lookup for markers.
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
import { ParcelLabels } from './ParcelLabels';
import { PointIndex, SegmentIndex, findParcelLabel } from './spatial';
import { STYLES } from './styles';
import { ParcelPolygonIndex } from './parcelPolygons';
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
  parcels: boolean;
  numbers: boolean;
}

function readPrefs(): Prefs {
  const d: Prefs = { osm: false, parcels: false, numbers: true };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      osm: typeof p.osm === 'boolean' ? p.osm : d.osm,
      parcels: typeof p.parcels === 'boolean' ? p.parcels : d.parcels,
      numbers: typeof p.numbers === 'boolean' ? p.numbers : d.numbers,
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

interface ParcelData {
  lines: DrapedLines;
  labels: ParcelLabels;
  props: ParcelLabelProps[];
  pointIndex: PointIndex;
  /** Parcel boundary index for the local lookup — built lazily on the first lookup. */
  boundaries(): SegmentIndex;
}

export interface VectorLayersApi {
  osm: DrapedLines | null;
  parcels: ParcelData | null;
  setOsm(on: boolean): Promise<void>;
  setParcels(on: boolean): Promise<void>;
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
export function initVectorLayers(ctx: AppContext, panel: HTMLElement, viewport: HTMLElement): VectorLayersApi | null {
  const vec = ctx.manifest.vectors;
  if (!vec?.osm && !vec?.flurstuecke) return null;
  const { terrain, camera, renderer, scene, manifest } = ctx;
  const base = terrain.baseUrl;
  const origin = manifest.origin;
  const prefs = readPrefs();

  // ---- panel ------------------------------------------------------------------------------
  const sec = createPanelSection(panel, 'vectors', 'Wege & Flurstücke', true);
  const legend = STYLES.filter((s) => s.key !== 'parcel')
    .map((s) => `<span class="sle-vec-key"><i style="background:rgb(${s.color.map((c) => Math.round(c * 255)).join(',')})"></i>${s.label_de}</span>`)
    .join('');
  sec.body.innerHTML = `
    <div class="sle-row" data-row="osm">
      <label title="OpenStreetMap-Wege auf dem Gelände (Taste O)"><input type="checkbox" data-k="osm"> Wege (OSM) <kbd>O</kbd></label>
      <span class="sle-dim sle-vec-status" data-s="osm"></span>
    </div>
    <div class="sle-vec-legend sle-dim" data-row="osm">${legend}</div>
    <div class="sle-row" data-row="parcels">
      <label title="Flurstücksgrenzen (ALKIS) auf dem Gelände (Taste F)"><input type="checkbox" data-k="parcels"> Flurstücke <kbd>F</kbd></label>
      <label title="Flurnummern im Umkreis von ca. 300 m"><input type="checkbox" data-k="numbers"> Nummern</label>
      <span class="sle-dim sle-vec-status" data-s="parcels"></span>
    </div>
    <p class="sle-dim sle-small" data-row="attr"></p>`;
  const q = <T extends HTMLElement>(sel: string) => sec.body.querySelector<T>(sel)!;
  const cbOsm = q<HTMLInputElement>('[data-k=osm]');
  const cbParcels = q<HTMLInputElement>('[data-k=parcels]');
  const cbNumbers = q<HTMLInputElement>('[data-k=numbers]');
  const status = (k: 'osm' | 'parcels', t: string) => (q(`[data-s=${k}]`).textContent = t);
  for (const el of sec.body.querySelectorAll<HTMLElement>('[data-row=osm]')) el.hidden = !vec.osm;
  for (const el of sec.body.querySelectorAll<HTMLElement>('[data-row=parcels]')) el.hidden = !vec.flurstuecke;
  const attrs = [
    vec.osm ? 'Wege: © OpenStreetMap-Mitwirkende, ODbL' : '',
    vec.flurstuecke ? `Flurstücke: ${vec.flurstuecke.source || 'ALKIS'}, dl-de/by-2-0` : '',
  ].filter(Boolean);
  q('[data-row=attr]').textContent = attrs.join(' · ') + '. Grenzen und Nummern ohne Gewähr.';

  // ---- per-frame hook ---------------------------------------------------------------------
  const api: VectorLayersApi = {
    osm: null,
    parcels: null,
    setOsm,
    setParcels,
    lookupLocal,
    polygons: () => polyIndex,
  };
  const prev = scene.onBeforeRender.bind(scene);
  (scene as Scene).onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
    prev(...args);
    if (args[2] !== camera) return; // other cameras/passes are not ours
    api.osm?.update(camera, renderer);
    if (api.parcels) {
      api.parcels.lines.update(camera, renderer);
      api.parcels.labels.update();
    }
  };
  window.addEventListener('sle:step', () => api.parcels?.labels.update(true));

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

  let parcelLoading: Promise<ParcelData | null> | null = null;
  function loadParcels(): Promise<ParcelData | null> {
    const layer = vec!.flurstuecke!;
    parcelLoading ??= (async () => {
      status('parcels', 'lädt …');
      try {
        const [lineData, pts] = await Promise.all([
          loadLineLayer(base + layer.path, origin, 'parcel', bucketSize, fallbackH),
          loadPointLayer(base + layer.labels, origin),
        ]);
        const dl = new DrapedLines(lineData.buckets, terrain, {
          fade: [900, 1600],
          casingPx: 0.6,
          casingAlpha: 0.55,
          renderOrder: 4,
        });
        dl.visible = false;
        scene.add(dl);
        const labels = new ParcelLabels(
          viewport,
          pts.props.map((props, k) => ({
            x: pts.xs[k],
            z: pts.zs[k],
            h: pts.hs[k],
            text: props.text,
            title: formatParcel(props),
          })),
          camera,
          terrain,
        );
        let boundaries: SegmentIndex | null = null;
        const data: ParcelData = {
          lines: dl,
          labels,
          props: pts.props,
          pointIndex: new PointIndex(pts.xs, pts.zs, 50),
          boundaries: () => (boundaries ??= SegmentIndex.fromRecords(lineData.buckets, SEG_STRIDE, 25)),
        };
        api.parcels = data;
        status('parcels', `${pts.props.length.toLocaleString('de-DE')} Flurstücke`);
        return data;
      } catch (err) {
        console.warn('[vectors] flurstuecke', err);
        status('parcels', `nicht verfügbar (${err instanceof Error ? err.message : String(err)})`);
        parcelLoading = null; // allow a retry on the next toggle
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

  async function setParcels(on: boolean): Promise<void> {
    prefs.parcels = on;
    cbParcels.checked = on;
    writePrefs(prefs);
    if (!vec?.flurstuecke) return;
    const d = on ? await loadParcels() : api.parcels;
    if (d) {
      d.lines.visible = prefs.parcels;
      d.labels.setVisible(prefs.parcels && prefs.numbers);
    }
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
  cbParcels.checked = prefs.parcels;
  cbNumbers.checked = prefs.numbers;
  cbOsm.addEventListener('change', () => void setOsm(cbOsm.checked));
  cbParcels.addEventListener('change', () => void setParcels(cbParcels.checked));
  cbNumbers.addEventListener('change', () => {
    prefs.numbers = cbNumbers.checked;
    writePrefs(prefs);
    api.parcels?.labels.setVisible(prefs.parcels && prefs.numbers);
  });
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyO' && vec.osm) void setOsm(!prefs.osm);
    else if (e.code === 'KeyF' && vec.flurstuecke) void setParcels(!prefs.parcels);
  });

  // Restore persisted toggles (both off by default) once the terrain heights are there.
  const restore = () => {
    if (prefs.osm) void setOsm(true);
    if (prefs.parcels) void setParcels(true);
  };
  if (terrain.heights.loadedCount > 0) restore();
  else window.addEventListener('sle:ready', restore, { once: true });

  return api;
}
