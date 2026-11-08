/**
 * Catalog mode (S2): „Wege (OSM)“ and the local parcel lookup across all ready places. Each place's
 * OSM file (2D, `densified: false` → densified here) is loaded in the SESSION frame (lines draped
 * on the shared terrain, no per-place offset needed) and clipped to the place's owned tiles, so a
 * line on the border between two places is drawn once. Parcel lookup: the polygons of the place
 * that owns the tile under the point. Same panel card / key O / prefs as single-AOI mode.
 */
import type { Scene } from 'three';
import { tileIdAt } from '../data/globalGrid';
import type { CatalogSession } from '../catalog';
import type { Manifest } from '../data/manifest';
import type { AppContext } from '../main';
import { setLocalParcelLookup } from '../markers/parcel';
import { isTyping } from '../ui/keys';
import { createPanelSection } from '../ui/panelSection';
import { DrapedLines } from './DrapedLines';
import { formatParcel } from './labels';
import { tileClipFor } from './parcelEdges';
import { ParcelPolygonIndex } from './parcelPolygons';
import { STYLES } from './styles';
import { loadLineLayer, loadParcelPolygons } from './vectorLoader';
import type { VectorLayersApi } from './VectorLayers';

const PREFS_KEY = 'sle.vectors.v1';

function readOsm(): boolean {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { osm?: unknown };
    return typeof p.osm === 'boolean' ? p.osm : false;
  } catch {
    return false;
  }
}

function writeOsm(osm: boolean): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ osm }));
  } catch {
    /* ignore */
  }
}

/** The tiles a place draws: its v3 presence (tile resolution) — a subset of its catalog tiles. */
function placeClip(m: Manifest, sessionOrigin: { E0: number; N0: number }) {
  if (!m.presence) return undefined;
  return tileClipFor({ E0: m.origin.E0, N0: m.origin.N0, H: m.size.height }, m.presence, sessionOrigin);
}

export function initCatalogVectors(ctx: AppContext, cat: CatalogSession, panel: HTMLElement): VectorLayersApi {
  const { terrain, camera, renderer, scene } = ctx;
  const origin = ctx.manifest.origin;
  const bucketSize = 500;
  const fallbackH = ctx.manifest.heightRange.min;
  let on = readOsm();

  const sec = createPanelSection(panel, 'vectors', 'Wege', true);
  const legend = STYLES.filter((s) => s.key !== 'parcel')
    .map((s) => `<span class="sle-vec-key"><i style="background:rgb(${s.color.map((c) => Math.round(c * 255)).join(',')})"></i>${s.label_de}</span>`)
    .join('');
  sec.body.innerHTML = `
    <div class="sle-row">
      <label title="OpenStreetMap-Wege auf dem Gelände (Taste O)"><input type="checkbox" data-k="osm"> Wege (OSM) <kbd>O</kbd></label>
      <span class="sle-dim sle-vec-status"></span>
    </div>
    <div class="sle-vec-legend sle-dim">${legend}</div>
    <p class="sle-dim sle-small">Wege: © OpenStreetMap-Mitwirkende, ODbL.</p>`;
  const cb = sec.body.querySelector<HTMLInputElement>('[data-k=osm]')!;
  const status = sec.body.querySelector<HTMLElement>('.sle-vec-status')!;

  /** Place id → its OSM lines (null while loading / failed). */
  const osm = new Map<string, DrapedLines | null>();
  const polys = new Map<string, Promise<ParcelPolygonIndex | null>>();
  const showStatus = () => {
    let loading = 0;
    for (const d of osm.values()) if (!d) loading++;
    status.textContent = !on ? '' : loading ? 'lädt …' : `${osm.size} ${osm.size === 1 ? 'Ort' : 'Orte'}`;
  };

  const api: VectorLayersApi = {
    osm: null,
    async setOsm(v: boolean) {
      on = v;
      cb.checked = v;
      writeOsm(v);
      sync();
    },
    lookupLocal,
    polygons: () => null,
  };

  function sync(): void {
    const ready = new Map(cat.places.ready().map((r) => [r.place.id, r] as const));
    for (const [id, d] of osm) {
      if (ready.has(id)) continue;
      if (d) {
        scene.remove(d);
        d.dispose();
      }
      osm.delete(id);
      polys.delete(id);
    }
    for (const d of osm.values()) if (d) d.visible = on;
    if (on) {
      for (const [id, r] of ready) {
        const layer = r.manifest.vectors?.osm;
        if (!layer || osm.has(id)) continue;
        osm.set(id, null);
        const clip = placeClip(r.manifest, origin);
        loadLineLayer(r.baseUrl + layer.path, origin, 'osm', bucketSize, fallbackH, clip ? { clip } : undefined)
          .then((data) => {
            if (!osm.has(id)) return; // dropped meanwhile
            const dl = new DrapedLines(data.buckets, terrain, { fade: [3500, 6000], renderOrder: 5 });
            dl.visible = on;
            scene.add(dl);
            osm.set(id, dl);
            api.osm ??= dl;
            showStatus();
          })
          .catch((err) => {
            console.warn(`[vectors] osm ${id}`, err);
            osm.delete(id);
            showStatus();
          });
      }
    }
    showStatus();
  }

  function polygonsOf(id: string): Promise<ParcelPolygonIndex | null> {
    let p = polys.get(id);
    if (!p) {
      const r = cat.places.ready().find((x) => x.place.id === id);
      const path = r?.manifest.vectors?.flurstuecke?.polygons;
      p = path
        ? loadParcelPolygons(r.baseUrl + path).then((d) => new ParcelPolygonIndex(d), (err) => {
            console.warn(`[vectors] parcel polygons ${id}`, err);
            return null;
          })
        : Promise.resolve(null);
      polys.set(id, p);
    }
    return p;
  }

  async function lookupLocal(E: number, N: number): Promise<string | null> {
    const owner = cat.catalog.owners.get(tileIdAt(E, N));
    if (!owner) return null;
    const idx = await polygonsOf(owner);
    const hit = idx?.lookup(E, N);
    return hit ? formatParcel(hit) : null;
  }
  setLocalParcelLookup(lookupLocal);

  const prev = scene.onBeforeRender.bind(scene);
  (scene as Scene).onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
    prev(...args);
    if (args[2] !== camera) return;
    for (const d of osm.values()) d?.update(camera, renderer);
  };
  cat.places.onChange(sync);
  cb.checked = on;
  cb.addEventListener('change', () => void api.setOsm(cb.checked));
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyO') void api.setOsm(!on);
  });
  if (terrain.heights.loadedCount > 0) sync();
  else window.addEventListener('sle:ready', sync, { once: true });
  window.sleVectors = api;
  return api;
}
