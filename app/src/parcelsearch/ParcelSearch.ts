/**
 * Flurstücksuche (card at the top of the „Orte“ drawer).
 *
 * Local search: the parcel label points (`vectors.flurstuecke.labels`) of every place with detailed
 * 3D (catalog mode: all catalog places with status '3d', fetched once on first use, ≤ 3 in flight;
 * single-AOI mode: the AOI's own file). The labels are clipped to each place's tiles (contract rule 6),
 * so no parcel is listed twice. Online search (explicit button only, never per keystroke): the
 * ALKIS Saarland WFS 414 by Gemarkung + Flurnummer or Kennzeichen — covers the whole Saarland,
 * also places without 3D data. Only the typed search goes to the service; no owner data exists there.
 *
 * Picking a hit flies there (oblique view sized to the parcel) and outlines the parcel in 3D
 * (DrapedLines, exaggeration in the shader) and on the minimap. Outline geometry: the place's
 * `flurstuecke.polygons` (point-in-polygon at the label point) or the WFS geometry.
 */
import L from 'leaflet';
import type { Vector3 } from 'three';
import type { ParcelLabelProps } from '../data/manifest';
import { utmToWgs84, utmToWorld } from '../geo';
import type { AppContext } from '../main';
import type { Minimap } from '../map/Minimap';
import { flyToSite } from '../pois/PoiPanel';
import { createPanelSection } from '../ui/panelSection';
import { densifyLine } from '../vectors/drape';
import type { LocalLine } from '../vectors/drape';
import { DrapedLines } from '../vectors/DrapedLines';
import { formatParcel } from '../vectors/labels';
import { ParcelPolygonIndex, featureRings } from '../vectors/parcelPolygons';
import { loadParcelPolygons } from '../vectors/vectorLoader';
import {
  canSearchOnline,
  fmtArea,
  gemarkungListUrl,
  indexRecord,
  isUsableQuery,
  matchGemarkungen,
  parseGemarkungList,
  parseLabelRecords,
  parseParcelQuery,
  parseWfsRecords,
  ringsBbox,
  searchParcels,
  wfsSearchUrl,
} from './query';
import type { Gemarkung, IndexedRecord, ParcelHit, ParcelRecord } from './query';
import './parcelsearch.css';

type Ring = Array<[number, number]>;

interface Source {
  /** Catalog place id, or '' in single-AOI mode. */
  id: string;
  name: string;
  labelsUrl: string;
  polygonsUrl?: string;
}

const OUTLINE_RGB: [number, number, number] = [1.0, 0.82, 0.18]; // amber: distinct from teal place outlines, red parcels, OSM
const OUTLINE_HEX = '#ffd02e';
const MAX_PARALLEL = 3;
const ONLINE_SOURCE = 'Flurstücke online: © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0 (ALKIS WFS)';

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Places (or the AOI) that publish parcel labels. */
async function findSources(ctx: AppContext): Promise<Source[]> {
  if (!ctx.catalog) {
    const f = ctx.manifest.vectors?.flurstuecke;
    if (!f?.labels) return [];
    const base = ctx.terrain.baseUrl;
    return [{ id: '', name: ctx.manifest.name, labelsUrl: base + f.labels, ...(f.polygons ? { polygonsUrl: base + f.polygons } : {}) }];
  }
  const places = ctx.catalog.catalog.places.filter((p) => p.status === '3d' && p.dataUrl);
  const out = await mapLimited(places, MAX_PARALLEL, async (p): Promise<Source | null> => {
    // A place already loaded by the PlaceManager: reuse its manifest.
    const ready = ctx.catalog!.places.ready().find((r) => r.place.id === p.id);
    let vec = ready?.manifest.vectors?.flurstuecke as { labels?: unknown; polygons?: unknown } | undefined;
    if (!ready) {
      const res = await fetch(`${p.dataUrl}manifest.json`, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = JSON.parse(await res.text()) as { vectors?: { flurstuecke?: { labels?: unknown; polygons?: unknown } } };
      vec = m.vectors?.flurstuecke;
    }
    if (typeof vec?.labels !== 'string') return null;
    return {
      id: p.id,
      name: p.name_de,
      labelsUrl: p.dataUrl + vec.labels,
      ...(typeof vec.polygons === 'string' ? { polygonsUrl: p.dataUrl + vec.polygons } : {}),
    };
  });
  return out.filter((s): s is Source => !!s);
}

/** Map with at most `n` promises in flight; a rejected item becomes null (logged). */
async function mapLimited<T, R>(items: readonly T[], n: number, fn: (t: T) => Promise<R | null>): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        console.warn('[parcel-search]', err);
        out[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export interface ParcelSearchApi {
  /** Run a search as if typed (for tests / deep links). */
  search(text: string): Promise<ParcelHit[]>;
  /** Fly to and outline a record. */
  show(rec: ParcelRecord): Promise<void>;
  clear(): void;
  dispose(): void;
}

export function initParcelSearch(ctx: AppContext, parent: HTMLElement, minimap: () => Minimap | null): ParcelSearchApi {
  const sec = createPanelSection(parent, 'parcel-search', 'Flurstück suchen', true);
  sec.body.innerHTML = `
    <form class="sle-ps-form" role="search">
      <input type="search" class="sle-input" name="q" autocomplete="off" spellcheck="false"
        placeholder="z. B. Kirrberg 100/2 · Hassel Flur 6 1405/1" aria-label="Flurstück suchen: Gemarkung, Flur, Flurstücksnummer">
    </form>
    <p class="sle-dim sle-small sle-ps-status" aria-live="polite"></p>
    <div class="sle-list sle-ps-list" role="list"></div>
    <div class="sle-ps-online" hidden>
      <button type="button" class="sle-btn sle-ps-online-btn">Im ganzen Saarland suchen (Geoportal)</button>
      <p class="sle-dim sle-small">Schickt nur den Suchtext an den ALKIS-Dienst des Saarlands.</p>
    </div>
    <div class="sle-ps-sel" hidden></div>`;
  const form = sec.body.querySelector<HTMLFormElement>('form')!;
  const input = sec.body.querySelector<HTMLInputElement>('input')!;
  const status = sec.body.querySelector<HTMLElement>('.sle-ps-status')!;
  const list = sec.body.querySelector<HTMLElement>('.sle-ps-list')!;
  const online = sec.body.querySelector<HTMLElement>('.sle-ps-online')!;
  const onlineBtn = sec.body.querySelector<HTMLButtonElement>('.sle-ps-online-btn')!;
  const selBox = sec.body.querySelector<HTMLElement>('.sle-ps-sel')!;

  // ---- index -----------------------------------------------------------------------------------
  let sources: Source[] = [];
  let index: IndexedRecord[] = [];
  let loading: Promise<void> | null = null;
  let loadNote = '';
  const ensureIndex = (): Promise<void> => {
    loading ??= (async () => {
      status.textContent = 'Lade Flurstücke …';
      try {
        sources = await findSources(ctx);
      } catch (err) {
        console.warn('[parcel-search] sources', err);
        sources = [];
      }
      const lists = await mapLimited(sources, MAX_PARALLEL, async (s) => {
        const res = await fetch(s.labelsUrl, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`${s.name}: HTTP ${res.status}`);
        return parseLabelRecords(JSON.parse(await res.text()), s.id);
      });
      const failed = sources.filter((_, i) => !lists[i]).map((s) => s.name);
      index = lists.flatMap((l) => l ?? []).map(indexRecord);
      const ok = sources.filter((_, i) => lists[i]).map((s) => s.name);
      loadNote = ok.length
        ? `${index.length.toLocaleString('de-DE')} Flurstücke in ${ok.join(', ')}${failed.length ? ` (nicht geladen: ${failed.join(', ')})` : ''}.`
        : 'Hier sind keine Flurstücke mit 3D-Daten verfügbar.';
    })();
    return loading;
  };

  // ---- results -----------------------------------------------------------------------------------
  let lastHits: ParcelHit[] = [];
  let generation = 0;
  const nameOf = (id: string) => sources.find((s) => s.id === id)?.name ?? '';

  const renderHits = (hits: ParcelHit[], total: number, note: string) => {
    lastHits = hits;
    list.replaceChildren();
    sec.setCount(total);
    for (const [i, h] of hits.entries()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sle-item sle-ps-item';
      b.dataset.i = String(i);
      const p = h.rec.props;
      const where = h.rec.source === 'wfs' ? 'online' : ctx.catalog ? nameOf(h.rec.source) : '';
      b.innerHTML = `<span class="sle-item-name"></span><span class="sle-dim sle-small sle-ps-meta"></span>`;
      b.querySelector('.sle-item-name')!.textContent = formatParcel({ ...p, lage: undefined } as ParcelLabelProps);
      b.querySelector('.sle-ps-meta')!.textContent = [p.lage, where].filter(Boolean).join(' · ');
      b.addEventListener('click', () => void show(h.rec));
      list.appendChild(b);
    }
    status.textContent = note;
  };

  const runLocal = async (text: string): Promise<ParcelHit[]> => {
    const my = ++generation;
    const q = parseParcelQuery(text);
    online.hidden = !canSearchOnline(q);
    if (!isUsableQuery(q)) {
      renderHits([], 0, text.trim() ? 'Gemarkung und Flurstücksnummer eingeben, z. B. „Kirrberg 100/2“.' : loadNote);
      return [];
    }
    await ensureIndex();
    if (my !== generation) return lastHits;
    const { hits, total } = searchParcels(index, q, 50);
    const note = !total
      ? `Keine Treffer in den 3D-Orten.${online.hidden ? '' : ' Online suchen?'}`
      : total > hits.length
        ? `${total.toLocaleString('de-DE')} Treffer, die ersten ${hits.length} – genauer suchen (Gemarkung, Flur).`
        : `${total} Treffer.`;
    renderHits(hits, total, note);
    return hits;
  };

  /** Saarland Gemarkung names → keys (loaded once, on the first online search). */
  let gemList: Promise<Gemarkung[]> | null = null;
  const loadGemarkungen = (signal: AbortSignal): Promise<Gemarkung[]> => {
    gemList ??= fetch(gemarkungListUrl(), { signal, mode: 'cors', credentials: 'omit' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseGemarkungList(await res.text());
      })
      .catch((err) => {
        gemList = null; // retry next time
        throw err;
      });
    return gemList;
  };

  const runOnline = async (): Promise<void> => {
    const text = input.value;
    const q = parseParcelQuery(text);
    if (!canSearchOnline(q)) return;
    const my = ++generation;
    onlineBtn.disabled = true;
    status.textContent = 'Frage das Geoportal Saarland … (dauert oft 10–30 s)';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    try {
      let gems: Gemarkung[] = [];
      if (!q.kennz) {
        gems = matchGemarkungen(await loadGemarkungen(ac.signal), q.words ?? '');
        if (my !== generation) return;
        if (!gems.length) {
          renderHits([], 0, `Gemarkung „${q.words}“ gibt es im Saarland nicht – Schreibweise prüfen.`);
          return;
        }
      }
      const url = wfsSearchUrl(q, gems);
      if (!url) return;
      const res = await fetch(url, { signal: ac.signal, mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Content-Type is the non-standard "geojson" → parse manually.
      const recs = parseWfsRecords(JSON.parse(await res.text()));
      if (my !== generation) return;
      const hits = recs.map((rec) => ({ rec, score: 0 }));
      const inGem = gems.length ? ` (Gemarkung ${gems.map((g) => `${g.name}${g.gemeinde && g.gemeinde !== g.name ? `, ${g.gemeinde}` : ''}`).join(' / ')})` : '';
      renderHits(hits, hits.length, hits.length ? `${hits.length} Treffer online${inGem}. ${ONLINE_SOURCE}.` : `Online keine Treffer${inGem}.`);
    } catch (err) {
      console.warn('[parcel-search] WFS', err);
      if (my === generation) status.textContent = 'Das Geoportal Saarland antwortet gerade nicht. Später noch einmal versuchen.';
    } finally {
      clearTimeout(timer);
      onlineBtn.disabled = false;
    }
  };

  let debounce = 0;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void runLocal(input.value), 180);
  });
  input.addEventListener('focus', () => void ensureIndex().then(() => { if (!input.value.trim()) status.textContent = loadNote; }), { once: true });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(debounce);
    void runLocal(input.value).then((hits) => {
      if (hits.length === 1) void show(hits[0].rec);
    });
  });
  input.addEventListener('keydown', (e) => {
    // Keys typed here never reach the flight controls (isTyping), but Esc should clear first.
    if (e.key === 'Escape' && input.value) {
      e.stopPropagation();
      input.value = '';
      void runLocal('');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list.querySelector<HTMLButtonElement>('button')?.focus();
    }
  });
  list.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key === 'ArrowDown') (t.nextElementSibling as HTMLElement | null)?.focus();
    else if (e.key === 'ArrowUp') ((t.previousElementSibling as HTMLElement | null) ?? input).focus();
    else return;
    e.preventDefault();
  });
  onlineBtn.addEventListener('click', () => void runOnline());

  // ---- outline + fly -----------------------------------------------------------------------------
  const polys = new Map<string, Promise<ParcelPolygonIndex | null>>();
  const polygonsOf = (sourceId: string): Promise<ParcelPolygonIndex | null> => {
    let p = polys.get(sourceId);
    if (!p) {
      const url = sources.find((s) => s.id === sourceId)?.polygonsUrl;
      p = url
        ? loadParcelPolygons(url).then((d) => new ParcelPolygonIndex(d), (err) => {
            console.warn('[parcel-search] polygons', err);
            return null;
          })
        : Promise.resolve(null);
      polys.set(sourceId, p);
    }
    return p;
  };

  let outline3d: DrapedLines | null = null;
  let mapLayer: L.Layer | null = null;
  let selected: ParcelRecord | null = null;
  const offFrame = ctx.onFrame(() => outline3d?.update(ctx.camera, ctx.renderer));

  const clearOutline = () => {
    if (outline3d) {
      ctx.scene.remove(outline3d);
      outline3d.dispose();
      outline3d = null;
    }
    mapLayer?.remove();
    mapLayer = null;
  };

  const drawOutline = (rings: Ring[]) => {
    clearOutline();
    const origin = ctx.manifest.origin;
    const lines: LocalLine[] = [];
    for (const r of rings) {
      const xz: number[] = [];
      for (const [E, N] of r) {
        const w = utmToWorld(E, N, origin);
        xz.push(w.x, w.z);
      }
      if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) xz.push(xz[0], xz[1]);
      lines.push({ xz: Float64Array.from(densifyLine(xz, 2)), style: 0 });
    }
    if (lines.length) {
      const dl = new DrapedLines({ lines }, ctx.terrain, {
        fade: [6000, 9000],
        lift: 0.6,
        renderOrder: 8,
        perFrameBudget: 12,
        casingPx: 1.4,
        casingAlpha: 0.95,
        depthBias: 0.002,
      });
      (dl.material.uniforms.uColors.value[0] as Vector3).set(...OUTLINE_RGB);
      dl.material.uniforms.uWidths.value[0] = 3.6;
      dl.userData.reportHide = true;
      outline3d = dl;
      ctx.scene.add(dl);
    }
    const mm = minimap()?.map;
    if (mm) {
      const lls = rings.map((r) => r.map(([E, N]) => {
        const ll = utmToWgs84(E, N);
        return [ll.lat, ll.lon] as L.LatLngTuple;
      }));
      mapLayer = L.polygon(lls, { color: OUTLINE_HEX, weight: 3, fill: true, fillOpacity: 0.15, interactive: false }).addTo(mm);
    }
  };

  const renderSelection = (rec: ParcelRecord, area: number | undefined, outlined: boolean) => {
    selBox.hidden = false;
    selBox.innerHTML = `
      <div class="sle-ps-sel-title"></div>
      <div class="sle-dim sle-small sle-ps-sel-meta"></div>
      <div class="sle-row">
        <button type="button" class="sle-btn" data-a="fly">Hinfliegen</button>
        <button type="button" class="sle-btn" data-a="clear">Markierung aus</button>
      </div>`;
    selBox.querySelector('.sle-ps-sel-title')!.textContent = formatParcel(rec.props);
    const meta = [
      area !== undefined ? `Fläche ${fmtArea(area)} (amtlich)` : '',
      rec.props.flstkennz ? `Kennzeichen ${rec.props.flstkennz}` : '',
      outlined ? '' : 'Umriss nicht verfügbar – Punkt im Flurstück angeflogen',
    ].filter(Boolean);
    selBox.querySelector('.sle-ps-sel-meta')!.innerHTML = meta.map(esc).join('<br>');
    selBox.querySelector('[data-a=fly]')!.addEventListener('click', () => void show(rec));
    selBox.querySelector('[data-a=clear]')!.addEventListener('click', () => clear());
  };

  /** Stand-off for a parcel: the whole parcel in frame, at least 120 m (60 m span when unknown). */
  const standOff = (rings: Ring[]) => {
    const bb = ringsBbox(rings);
    const span = bb ? Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) : 60;
    return Math.min(1500, Math.max(120, span * 1.3));
  };

  async function show(rec: ParcelRecord): Promise<void> {
    selected = rec;
    for (const b of list.querySelectorAll('.active')) b.classList.remove('active');
    const i = lastHits.findIndex((h) => h.rec === rec);
    if (i >= 0) list.querySelector(`[data-i="${i}"]`)?.classList.add('active');
    let rings: Ring[] = rec.rings ?? [];
    let area = rec.flaeche_m2;
    const needPolygons = !rings.length && rec.source !== 'wfs';
    if (rings.length) drawOutline(rings);
    else clearOutline();
    renderSelection(rec, area, rings.length > 0 || needPolygons);
    // Fly at once (the polygons file of a place is a few MB); outline and stand-off follow when it is in.
    let dist = standOff(rings);
    let flight = flyToSite(ctx, rec.E, rec.N, dist, dist * 0.6);
    if (needPolygons) {
      const idx = await polygonsOf(rec.source);
      if (selected !== rec) return;
      const f = idx ? idx.find(rec.E, rec.N) : -1;
      if (idx && f >= 0) {
        rings = featureRings(idx.data, f);
        area = idx.data.props[f].flaeche_m2;
        drawOutline(rings);
      }
      renderSelection(rec, area, rings.length > 0);
      const d2 = standOff(rings);
      // A large parcel needs a wider view: re-aim (supersedes the running flight).
      if (d2 > dist * 1.5) {
        dist = d2;
        flight = flyToSite(ctx, rec.E, rec.N, dist, dist * 0.6);
      }
    }
    await flight;
  }

  function clear(): void {
    selected = null;
    clearOutline();
    selBox.hidden = true;
    selBox.replaceChildren();
    for (const b of list.querySelectorAll('.active')) b.classList.remove('active');
  }

  const api: ParcelSearchApi = {
    async search(text) {
      input.value = text;
      return runLocal(text);
    },
    show,
    clear,
    dispose() {
      clear();
      offFrame();
      clearTimeout(debounce);
    },
  };
  window.sleParcelSearch = api;
  return api;
}

declare global {
  interface Window {
    sleParcelSearch?: ParcelSearchApi;
  }
}
