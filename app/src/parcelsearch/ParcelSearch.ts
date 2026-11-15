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
 *
 * Merkliste: „☆ Merken“ in the selection box or on a hit row saves the parcel in this browser only
 * (`savedParcels.ts`, localStorage); the saved list is shown in the card and can be outlined all at
 * once on the minimap.
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
import { SAVED_PARCELS_KEY, SAVED_PARCELS_MAX, SavedParcels, browserStorage, parcelKey, savedToRecord } from './savedParcels';
import type { SavedParcel, WriteResult } from './savedParcels';
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
  /** The Merkliste (newest first). */
  saved(): readonly SavedParcel[];
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
    <div class="sle-ps-sel" hidden></div>
    <div class="sle-ps-saved" hidden>
      <div class="sle-ps-saved-head">
        <span class="sle-ps-saved-title"></span>
        <button type="button" class="sle-link sle-small sle-ps-saved-map" aria-pressed="false">Alle auf der Karte zeigen</button>
      </div>
      <div class="sle-list sle-ps-saved-list" role="list"></div>
    </div>
    <p class="sle-dim sle-small sle-ps-saved-msg" aria-live="polite" hidden></p>`;
  const form = sec.body.querySelector<HTMLFormElement>('form')!;
  const input = sec.body.querySelector<HTMLInputElement>('input')!;
  const status = sec.body.querySelector<HTMLElement>('.sle-ps-status')!;
  const list = sec.body.querySelector<HTMLElement>('.sle-ps-list')!;
  const online = sec.body.querySelector<HTMLElement>('.sle-ps-online')!;
  const onlineBtn = sec.body.querySelector<HTMLButtonElement>('.sle-ps-online-btn')!;
  const selBox = sec.body.querySelector<HTMLElement>('.sle-ps-sel')!;
  const savedBox = sec.body.querySelector<HTMLElement>('.sle-ps-saved')!;
  const savedTitle = sec.body.querySelector<HTMLElement>('.sle-ps-saved-title')!;
  const savedList = sec.body.querySelector<HTMLElement>('.sle-ps-saved-list')!;
  const savedMapBtn = sec.body.querySelector<HTMLButtonElement>('.sle-ps-saved-map')!;
  const savedMsg = sec.body.querySelector<HTMLElement>('.sle-ps-saved-msg')!;

  // ---- index -----------------------------------------------------------------------------------
  let sources: Source[] = [];
  let index: IndexedRecord[] = [];
  let loading: Promise<void> | null = null;
  let sourcesLoading: Promise<void> | null = null;
  let loadNote = '';
  /** The places' manifests only (a saved parcel needs its place's polygons URL, not the whole index). */
  const ensureSources = (): Promise<void> => {
    sourcesLoading ??= findSources(ctx).then(
      (s) => void (sources = s),
      (err) => {
        console.warn('[parcel-search] sources', err);
        sources = [];
      },
    );
    return sourcesLoading;
  };
  const ensureIndex = (): Promise<void> => {
    loading ??= (async () => {
      status.textContent = 'Lade Flurstücke …';
      await ensureSources();
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
  const nameOf = (id: string) =>
    sources.find((s) => s.id === id)?.name ?? ctx.catalog?.catalog.places.find((p) => p.id === id)?.name_de ?? '';
  const whereOf = (rec: ParcelRecord) => (rec.source === 'wfs' ? 'online' : ctx.catalog ? nameOf(rec.source) : '');
  const titleOf = (p: ParcelLabelProps) => formatParcel({ ...p, lage: undefined } as ParcelLabelProps);

  const renderHits = (hits: ParcelHit[], total: number, note: string) => {
    lastHits = hits;
    list.replaceChildren();
    sec.setCount(total);
    for (const [i, h] of hits.entries()) {
      const p = h.rec.props;
      const row = parcelRow(titleOf(p), [p.lage, whereOf(h.rec)]);
      const b = row.querySelector<HTMLButtonElement>('.sle-ps-item')!;
      b.dataset.i = String(i);
      b.addEventListener('click', () => void show(h.rec));
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'sle-icon sle-ps-star';
      star.dataset.key = parcelKey(p);
      star.addEventListener('click', () => toggleSaved(h.rec));
      row.appendChild(star);
      list.appendChild(row);
    }
    syncStars();
    status.textContent = note;
  };

  /** A list row: the main button (title + meta line) — side buttons are appended by the caller. */
  function parcelRow(title: string, meta: Array<string | undefined>): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sle-ps-row';
    row.setAttribute('role', 'listitem');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sle-item sle-ps-item';
    b.innerHTML = `<span class="sle-item-name"></span><span class="sle-dim sle-small sle-ps-meta"></span>`;
    b.querySelector('.sle-item-name')!.textContent = title;
    b.querySelector('.sle-ps-meta')!.textContent = meta.filter(Boolean).join(' · ');
    row.appendChild(b);
    return row;
  }

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
      (list.querySelector<HTMLButtonElement>('.sle-ps-item') ?? savedList.querySelector<HTMLButtonElement>('.sle-ps-item'))?.focus();
    }
  });
  // Arrow keys move between the rows' main buttons (hits, then the Merkliste); Up from the first → input.
  const rowNav = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const row = (e.target as HTMLElement).closest('.sle-ps-row');
    if (!row) return;
    const items = [...sec.body.querySelectorAll<HTMLButtonElement>('.sle-ps-row .sle-ps-item')].filter((b) => b.offsetParent !== null);
    const i = items.indexOf(row.querySelector<HTMLButtonElement>('.sle-ps-item')!);
    e.preventDefault();
    if (e.key === 'ArrowDown') items[i + 1]?.focus();
    else (items[i - 1] ?? input).focus();
  };
  list.addEventListener('keydown', rowNav);
  savedList.addEventListener('keydown', rowNav);
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
        <button type="button" class="sle-btn sle-ps-save" data-a="save" aria-pressed="false"></button>
        <button type="button" class="sle-btn" data-a="clear">Markierung aus</button>
      </div>
      <input type="text" class="sle-input sle-ps-note" maxlength="200" autocomplete="off"
        placeholder="Notiz (bleibt in diesem Browser)" aria-label="Notiz zum gemerkten Flurstück" hidden>`;
    selBox.querySelector('.sle-ps-sel-title')!.textContent = formatParcel(rec.props);
    const meta = [
      area !== undefined ? `Fläche ${fmtArea(area)} (amtlich)` : '',
      rec.props.flstkennz ? `Kennzeichen ${rec.props.flstkennz}` : '',
      outlined ? '' : 'Umriss nicht verfügbar – Punkt im Flurstück angeflogen',
    ].filter(Boolean);
    selBox.querySelector('.sle-ps-sel-meta')!.innerHTML = meta.map(esc).join('<br>');
    selBox.querySelector('[data-a=fly]')!.addEventListener('click', () => void show(rec));
    selBox.querySelector('[data-a=clear]')!.addEventListener('click', () => clear());
    selBox.querySelector('[data-a=save]')!.addEventListener('click', () => toggleSaved(rec));
    const note = selBox.querySelector<HTMLInputElement>('.sle-ps-note')!;
    note.addEventListener('change', () => report(store.setNote(parcelKey(rec.props), note.value)));
    note.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') note.blur();
    });
    syncSelection();
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
    markSavedActive();
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
      await ensureSources();
      if (selected !== rec) return;
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
    markSavedActive();
  }

  // ---- Merkliste ---------------------------------------------------------------------------------
  const store = new SavedParcels(browserStorage());
  let mapAll: L.FeatureGroup | null = null;

  /** German note for a failed write; '' clears the message. */
  function report(r: WriteResult, extra = ''): void {
    const msg =
      r === 'quota'
        ? 'Der Browser-Speicher ist voll – die Änderung an der Merkliste wurde nicht gespeichert.'
        : r === 'unavailable'
          ? 'Dieser Browser erlaubt keinen Speicher (z. B. privates Fenster) – die Merkliste gilt nur bis zum Neuladen.'
          : extra;
    savedMsg.textContent = msg;
    savedMsg.hidden = !msg;
    renderSaved();
  }

  function toggleSaved(rec: ParcelRecord): void {
    const key = parcelKey(rec.props);
    if (store.get(key)) {
      report(store.remove(key));
      return;
    }
    const { result, dropped } = store.add(rec);
    report(result, dropped ? `Die Merkliste fasst ${SAVED_PARCELS_MAX} Flurstücke – der älteste Eintrag wurde entfernt.` : '');
  }

  function markSavedActive(): void {
    const key = selected ? parcelKey(selected.props) : null;
    for (const b of savedList.querySelectorAll<HTMLElement>('.sle-ps-item')) b.classList.toggle('active', b.dataset.key === key);
  }

  function syncStars(): void {
    for (const b of list.querySelectorAll<HTMLButtonElement>('.sle-ps-star')) {
      const on = !!store.get(b.dataset.key ?? '');
      b.textContent = on ? '★' : '☆';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      const title = b.closest('.sle-ps-row')?.querySelector('.sle-item-name')?.textContent ?? '';
      b.setAttribute('aria-label', `„${title}“ merken`);
      b.title = on ? 'Gemerkt – nochmal tippen zum Entfernen' : 'Merken';
    }
  }

  function syncSelection(): void {
    const btn = selBox.querySelector<HTMLButtonElement>('[data-a=save]');
    const note = selBox.querySelector<HTMLInputElement>('.sle-ps-note');
    if (!btn || !note || !selected) return;
    const s = store.get(parcelKey(selected.props));
    btn.textContent = s ? '★ Gemerkt' : '☆ Merken';
    btn.classList.toggle('on', !!s);
    btn.setAttribute('aria-pressed', String(!!s));
    btn.title = s ? 'Von der Merkliste entfernen' : 'Auf die Merkliste (nur in diesem Browser)';
    note.hidden = !s;
    if (s && document.activeElement !== note) note.value = s.note ?? '';
  }

  function renderSaved(): void {
    const items = store.list();
    savedBox.hidden = !items.length;
    savedTitle.textContent = `Gemerkte Flurstücke (${items.length})`;
    savedList.replaceChildren();
    for (const s of items) {
      const row = parcelRow(titleOf(s.props), [s.note, s.props.lage, whereOf(s)]);
      const b = row.querySelector<HTMLButtonElement>('.sle-ps-item')!;
      b.dataset.key = s.key;
      b.title = `Hinfliegen – gemerkt am ${new Date(s.savedAt).toLocaleDateString('de-DE')}`;
      b.addEventListener('click', () => void show(savedToRecord(s)));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sle-icon sle-ps-del';
      del.textContent = '✕';
      del.title = 'Von der Merkliste entfernen';
      del.setAttribute('aria-label', `„${titleOf(s.props)}“ von der Merkliste entfernen`);
      del.addEventListener('click', () => {
        // Keyboard users keep focus in the list: the next row's remove button, else the previous one.
        const keyboard = del.matches(':focus-visible');
        const next = (row.nextElementSibling ?? row.previousElementSibling)?.querySelector<HTMLElement>('.sle-ps-item')?.dataset.key;
        report(store.remove(s.key));
        if (!keyboard) return;
        const nextRow = next ? savedList.querySelector(`.sle-ps-item[data-key="${CSS.escape(next)}"]`)?.closest('.sle-ps-row') : null;
        (nextRow?.querySelector<HTMLButtonElement>('.sle-ps-del') ?? input).focus();
      });
      row.appendChild(del);
      savedList.appendChild(row);
    }
    markSavedActive();
    syncStars();
    syncSelection();
    if (mapAll) void drawSavedOnMap(false);
  }

  /** All saved parcels on the minimap (dot + outline where known); opens the big map once. */
  let mapGen = 0;
  async function drawSavedOnMap(fit: boolean): Promise<void> {
    const mm = minimap();
    if (!mm) return;
    const my = ++mapGen;
    const items = store.list();
    if (!items.length) {
      hideSavedOnMap();
      return;
    }
    const local = items.filter((s) => !s.rings && s.source !== 'wfs');
    if (local.length) await ensureSources();
    const idx = new Map<string, ParcelPolygonIndex | null>();
    for (const src of new Set(local.map((s) => s.source))) idx.set(src, await polygonsOf(src));
    if (my !== mapGen || !mapAll) return;
    mapAll.clearLayers();
    const pts: L.LatLngTuple[] = [];
    const ll = (E: number, N: number): L.LatLngTuple => {
      const w = utmToWgs84(E, N);
      return [w.lat, w.lon];
    };
    for (const s of items) {
      let rings: Ring[] = s.rings ?? [];
      const pi = idx.get(s.source);
      const f = pi ? pi.find(s.E, s.N) : -1;
      if (!rings.length && pi && f >= 0) rings = featureRings(pi.data, f);
      // A dot for every parcel (small parcels vanish when zoomed out), plus the outline where known.
      const layers: L.Path[] = [L.circleMarker(ll(s.E, s.N), { radius: 5, color: OUTLINE_HEX, weight: 2, fillOpacity: 0.6 })];
      if (rings.length) layers.push(L.polygon(rings.map((r) => r.map(([E, N]) => ll(E, N))), { color: OUTLINE_HEX, weight: 2, fillOpacity: 0.2 }));
      for (const layer of layers) {
        layer.bindTooltip(titleOf(s.props) + (s.note ? ` – ${s.note}` : ''));
        layer.on('click', () => void show(savedToRecord(s)));
        layer.addTo(mapAll);
      }
      pts.push(ll(s.E, s.N), ...rings.flatMap((r) => r.map(([E, N]) => ll(E, N))));
    }
    if (fit) mm.showBounds(pts);
  }

  function hideSavedOnMap(): void {
    mapGen++;
    if (!mapAll) return;
    mapAll.remove();
    mapAll = null;
    savedMapBtn.textContent = 'Alle auf der Karte zeigen';
    savedMapBtn.setAttribute('aria-pressed', 'false');
    minimap()?.endTemporaryView();
  }

  savedMapBtn.addEventListener('click', () => {
    if (mapAll) {
      hideSavedOnMap();
      return;
    }
    const mm = minimap()?.map;
    if (!mm) {
      report('ok', 'Die Übersichtskarte ist ausgeschaltet.');
      return;
    }
    mapAll = L.featureGroup().addTo(mm);
    savedMapBtn.textContent = 'Von der Karte nehmen';
    savedMapBtn.setAttribute('aria-pressed', 'true');
    void drawSavedOnMap(true);
  });

  // Another tab changed the Merkliste.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SAVED_PARCELS_KEY && e.key !== null) return;
    store.reload();
    renderSaved();
  };
  window.addEventListener('storage', onStorage);
  renderSaved();
  if (!store.persistent) report('unavailable');

  const api: ParcelSearchApi = {
    async search(text) {
      input.value = text;
      return runLocal(text);
    },
    show,
    clear,
    saved: () => store.list(),
    dispose() {
      clear();
      hideSavedOnMap();
      window.removeEventListener('storage', onStorage);
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
