/**
 * F15 "Verdachtsflächen": relict candidates from `manifest.candidates` (pipeline/detect.py).
 * Lazy load on first use; 3D outlines (CandidateLayer), minimap circles (only while the layer is
 * on), panel card with class filters, min-score slider, counts, score-sorted list with fly-to,
 * keys X (on/off) and N/P (next/previous visible candidate), review (bestätigen → private marker,
 * verwerfen, unsicher) stored only in localStorage `sle.candidates.v1.<aoi>`, JSON export.
 *
 * Candidates are hypotheses — the card always shows "Schauen, nicht graben". Nothing here sends
 * data anywhere; export is a user-triggered local download.
 */
import L from 'leaflet';
import type { Scene } from 'three';
import { CANDIDATE_CLASSES } from '../data/manifest';
import type { CandidateReviewStatus, CandidateReviewStore, ManifestCandidates } from '../data/manifest';
import { utmToWgs84 } from '../geo';
import type { AppContext } from '../main';
import type { Minimap } from '../map/Minimap';
import type { MarkerManager } from '../markers/MarkerManager';
import { newMarkerId } from '../markers/markerStore';
import { lookupParcelLocal } from '../markers/parcel';
import { showDisclaimer } from '../ui/disclaimer';
import { isTyping } from '../ui/keys';
import type { Labels3D } from '../ui/Labels3D';
import { createPanelSection, openPanelSection } from '../ui/panelSection';
import {
  STATUS_LABELS_DE,
  candidateLabel,
  candidateRadius,
  countByClass,
  decisionFor,
  defaultMinScore,
  existingCandidateMarkerId,
  filterCandidates,
  formatMetrics,
  formatScore,
  isKnownPath,
  markerCategoryFor,
  markerTextFor,
  parseCandidateCollection,
  sanitizeFilter,
  stepCandidate,
} from './candidateData';
import type { Candidate, CandidateFilter } from './candidateData';
import { CandidateLayer } from './CandidateLayer';
import { flyToSiteExag } from './flyToSite';
import { loadCandidatePrefs, saveCandidatePrefs } from './prefs';
import type { CandidatePrefs } from './prefs';
import { CLASS_COLORS, KNOWN_PATH_COLOR, SELECTED_COLOR, candidateColor, hexCss } from './colors';
import { exportDecisions, loadReviews, reattachDecisions, saveReviews } from './reviewStore';
import './candidates.css';

declare global {
  interface Window {
    sleCandidates?: CandidatesApi;
  }
}

export interface CandidatesApi {
  readonly meta: ManifestCandidates;
  /** All parsed candidates (null until loaded). */
  all(): Candidate[] | null;
  /** Visible candidates in navigation order. */
  visible(): Candidate[];
  current(): Candidate | null;
  filter(): CandidateFilter;
  reviews(): CandidateReviewStore;
  setOn(on: boolean): Promise<void>;
  setFilter(patch: Partial<CandidateFilter>): void;
  select(id: string | null, fly?: boolean): void;
  next(dir?: 1 | -1): void;
  decide(status: CandidateReviewStatus | null, id?: string): void;
  layer: CandidateLayer;
}

const LIST_LIMIT = 150;
const LABEL_ID = 'cand:current';
const LABEL_GROUP = 'candidate';

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export interface CandidateDeps {
  minimap: Minimap;
  markers: MarkerManager;
  labels: Labels3D;
}

/** Returns null (and adds no UI) when the manifest has no `candidates`. */
export function initCandidates(ctx: AppContext, panel: HTMLElement, deps: CandidateDeps): CandidatesApi | null {
  const meta = ctx.manifest.candidates;
  if (!meta) return null;
  const { terrain, camera, renderer, scene, manifest } = ctx;
  const aoi = manifest.aoi;
  const kv = safeStorage();
  const defaultMin = defaultMinScore(meta.params); // write threshold, not the mask's (contract)

  // Per-AOI prefs (`sle.candidates.prefs.v1.<aoi>`); the old shared key is migrated once.
  const loaded = loadCandidatePrefs(kv, aoi, defaultMin);
  if (loaded.migrated) console.info(`[candidates] filter prefs migrated to ${aoi} (min score reset to ${defaultMin})`);
  const prefs: CandidatePrefs = loaded.prefs;
  const savePrefs = () => saveCandidatePrefs(kv, aoi, prefs);
  /** Inline offer after un-confirming: delete the marker that "bestätigen" created? */
  let markerOffer: { candId: string; markerId: string; title: string } | null = null;

  let all: Candidate[] | null = null;
  let byId = new Map<string, Candidate>();
  let reviews: CandidateReviewStore = loadReviews(kv, aoi);
  let visible: Candidate[] = [];
  let current: Candidate | null = null;
  let loading: Promise<boolean> | null = null;

  const layer = new CandidateLayer(terrain, manifest.origin);
  layer.visible = false;
  scene.add(layer);
  const prevHook = scene.onBeforeRender.bind(scene);
  (scene as Scene).onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
    prevHook(...args);
    if (args[2] === camera) layer.update(camera, renderer);
  };

  // Minimap: canvas-rendered circles, only on the map while the layer is on.
  const mapRenderer = L.canvas({ padding: 0.3 });
  const mapLayer = L.layerGroup();

  // ---- panel --------------------------------------------------------------------------------
  const sec = createPanelSection(panel, 'candidates', meta.label_de || 'Verdachtsflächen', false);
  const classChips = CANDIDATE_CLASSES.map(
    (c) => `<label class="sle-cand-chip" title="${esc(meta.classes[c])}"><input type="checkbox" data-cls="${c}"><i style="background:${hexCss(CLASS_COLORS[c])}"></i>${esc(meta.classes[c])} <span class="sle-dim" data-n="${c}"></span></label>`,
  ).join('');
  sec.body.innerHTML = `
    <div class="sle-row">
      <label title="Verdachtsflächen in 3D und auf der Karte (Taste X)"><input type="checkbox" data-k="on"> anzeigen <kbd>X</kbd></label>
      <span class="sle-spacer"></span><span class="sle-dim" data-k="status"></span>
    </div>
    <p class="sle-cand-warn">Hypothesen aus automatischer Reliefanalyse – keine Funde. <b>Schauen, nicht graben.</b> Daten und Entscheidungen bleiben lokal in diesem Browser. <button type="button" class="sle-link" data-act="info">Hinweise</button></p>
    <div class="sle-cand-chips">${classChips}<label class="sle-cand-chip" title="Linienstrukturen auf einem bekannten Weg (OSM)"><input type="checkbox" data-k="known"><i style="background:${hexCss(KNOWN_PATH_COLOR)}"></i>Weg (bekannt) <span class="sle-dim" data-n="known"></span></label></div>
    <div class="sle-row sle-cand-score">
      <label for="sle-cand-min">Min. Score</label>
      <input id="sle-cand-min" type="range" min="0" max="1" step="0.05" data-k="min">
      <span data-k="minv"></span>
    </div>
    <div class="sle-row">
      <label><input type="checkbox" data-k="rejected"> verworfene zeigen</label>
      <label><input type="checkbox" data-k="open"> nur ungeprüfte</label>
    </div>
    <div class="sle-cand-detail" data-k="detail" hidden></div>
    <div class="sle-row">
      <button type="button" class="sle-btn" data-act="prev" title="Vorheriger Kandidat (Taste P)">◀ Zurück <kbd>P</kbd></button>
      <button type="button" class="sle-btn" data-act="next" title="Nächster Kandidat (Taste N)">Weiter <kbd>N</kbd> ▶</button>
      <span class="sle-spacer"></span><span class="sle-dim" data-k="pos"></span>
    </div>
    <div class="sle-list sle-cand-list" role="list" data-k="list"></div>
    <div class="sle-row">
      <span class="sle-dim sle-small" data-k="reviewed"></span><span class="sle-spacer"></span>
      <button type="button" class="sle-btn" data-act="export" title="Prüfentscheidungen als JSON speichern (lokal)">Entscheidungen exportieren</button>
    </div>
    <p class="sle-dim sle-small" data-k="method"></p>`;
  const q = <T extends HTMLElement>(sel: string) => sec.body.querySelector<T>(sel)!;
  const cbOn = q<HTMLInputElement>('[data-k=on]');
  const cbKnown = q<HTMLInputElement>('[data-k=known]');
  const slider = q<HTMLInputElement>('[data-k=min]');
  const cbRejected = q<HTMLInputElement>('[data-k=rejected]');
  const cbOpen = q<HTMLInputElement>('[data-k=open]');
  const status = (t: string) => (q('[data-k=status]').textContent = t);
  const detail = q('[data-k=detail]');
  const listEl = q('[data-k=list]');
  q('[data-k=method]').textContent =
    `Verfahren: ${meta.method || 'unbekannt'}${meta.version ? ` v${meta.version}` : ''}${meta.generated ? ` · ${meta.generated.slice(0, 10)}` : ''} · ${meta.featureCount} Kandidaten. Nur eine Lesehilfe – Funde dem Landesdenkmalamt melden.`;

  const syncControls = () => {
    const f = prefs.filter;
    cbOn.checked = prefs.on;
    for (const c of CANDIDATE_CLASSES) q<HTMLInputElement>(`[data-cls=${c}]`).checked = f.classes[c];
    cbKnown.checked = f.knownPaths;
    slider.value = String(f.minScore);
    q('[data-k=minv]').textContent = formatScore(f.minScore);
    cbRejected.checked = f.showRejected;
    cbOpen.checked = f.onlyOpen;
  };
  syncControls();

  cbOn.addEventListener('change', () => void setOn(cbOn.checked));
  for (const c of CANDIDATE_CLASSES) {
    q<HTMLInputElement>(`[data-cls=${c}]`).addEventListener('change', (e) =>
      setFilter({ classes: { ...prefs.filter.classes, [c]: (e.target as HTMLInputElement).checked } }),
    );
  }
  cbKnown.addEventListener('change', () => setFilter({ knownPaths: cbKnown.checked }));
  let sliderTimer: ReturnType<typeof setTimeout> | null = null;
  slider.addEventListener('input', () => {
    q('[data-k=minv]').textContent = formatScore(Number(slider.value));
    if (sliderTimer) clearTimeout(sliderTimer);
    sliderTimer = setTimeout(() => setFilter({ minScore: Number(slider.value) }), 120);
  });
  cbRejected.addEventListener('change', () => setFilter({ showRejected: cbRejected.checked }));
  cbOpen.addEventListener('change', () => setFilter({ onlyOpen: cbOpen.checked }));
  q('[data-act=prev]').addEventListener('click', () => next(-1));
  q('[data-act=next]').addEventListener('click', () => next(1));
  q('[data-act=export]').addEventListener('click', exportJson);
  q('[data-act=info]').addEventListener('click', () => showDisclaimer(true));

  // ---- keys ---------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyX') void setOn(!prefs.on);
    else if (prefs.on && all && (e.code === 'KeyN' || e.code === 'KeyP')) next(e.code === 'KeyN' ? 1 : -1);
  });

  // ---- data ---------------------------------------------------------------------------------
  function load(): Promise<boolean> {
    loading ??= (async () => {
      status('lädt …');
      try {
        const res = await fetch(terrain.baseUrl + meta!.path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseCandidateCollection(await res.json());
        all = parsed.candidates;
        byId = new Map(all.map((c) => [c.id, c]));
        if (parsed.skipped) console.warn(`[candidates] ${parsed.skipped} features skipped (class/geometry/score)`);
        const r = reattachDecisions(reviews, all);
        reviews = r.store;
        if (r.moved) {
          saveReviews(kv, aoi, reviews);
          console.info(`[candidates] ${r.moved} decisions re-attached after a detector re-run`);
        }
        status('');
        return true;
      } catch (err) {
        console.warn('[candidates] could not load', meta!.path, err);
        status('nicht verfügbar');
        loading = null; // allow a retry
        return false;
      }
    })();
    return loading;
  }

  async function setOn(on: boolean): Promise<void> {
    prefs.on = on;
    savePrefs();
    cbOn.checked = on;
    if (on && !(await load())) {
      prefs.on = false;
      cbOn.checked = false;
      return;
    }
    if (prefs.on !== on) return; // toggled again while loading
    layer.visible = on;
    if (on) {
      mapLayer.addTo(deps.minimap.map);
      refresh();
      openPanelSection(sec);
    } else {
      mapLayer.remove();
      deps.labels.remove(LABEL_ID);
    }
    if (on && current) showCurrentPin();
  }

  function setFilter(patch: Partial<CandidateFilter>): void {
    prefs.filter = sanitizeFilter({ ...prefs.filter, ...patch }, prefs.filter);
    savePrefs();
    syncControls();
    refresh();
  }

  const statusOf = (id: string) => reviews.decisions[id]?.status;

  /** Recompute the visible set and redraw 3D, minimap, counts and list. */
  function refresh(): void {
    if (!all) return;
    visible = filterCandidates(all, prefs.filter, statusOf);
    layer.setCandidates(visible);
    const total = countByClass(all);
    const shown = countByClass(visible);
    for (const c of [...CANDIDATE_CLASSES, 'known'] as const) q(`[data-n=${c}]`).textContent = `${shown[c]}/${total[c]}`;
    sec.setCount(`${visible.length}/${all.length}`);
    renderMap();
    renderList();
    renderDetail();
    const n = Object.values(reviews.decisions);
    q('[data-k=reviewed]').textContent = n.length
      ? `Geprüft: ${n.filter((d) => d.status === 'confirmed').length} bestätigt, ${n.filter((d) => d.status === 'unsure').length} unsicher, ${n.filter((d) => d.status === 'rejected').length} verworfen`
      : 'Noch nichts geprüft.';
  }

  function renderMap(): void {
    mapLayer.clearLayers();
    for (const c of visible) {
      const { lat, lon } = utmToWgs84(c.E, c.N);
      const sel = c.id === current?.id;
      const m = L.circleMarker([lat, lon], {
        renderer: mapRenderer,
        radius: sel ? 7 : Math.min(6, 3 + candidateRadius(c) / 10),
        color: sel ? hexCss(SELECTED_COLOR) : '#111',
        weight: sel ? 2.5 : 1,
        fillColor: hexCss(candidateColor(c)),
        fillOpacity: statusOf(c.id) === 'rejected' ? 0.3 : 0.9,
        // Don't let the click reach the minimap's own click-to-fly (it would replace this flight).
        bubblingMouseEvents: false,
      });
      m.bindTooltip(`${candidateLabel(c, meta!.classes)} · Score ${formatScore(c.score)}`);
      m.on('click', () => select(c.id, true));
      mapLayer.addLayer(m);
    }
  }

  function renderList(): void {
    listEl.replaceChildren();
    if (!visible.length) {
      listEl.innerHTML = `<p class="sle-dim">Keine Kandidaten mit diesen Filtern.</p>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const c of visible.slice(0, LIST_LIMIT)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sle-item sle-cand-row${c.id === current?.id ? ' active' : ''}`;
      b.dataset.id = c.id;
      const st = statusOf(c.id);
      b.innerHTML = `<span class="sle-conf" style="background:${hexCss(candidateColor(c))}"></span><span class="sle-item-name"></span><span class="sle-cand-st ${st ?? ''}"></span><span class="sle-dim">${formatScore(c.score)}</span>`;
      b.querySelector('.sle-item-name')!.textContent = `${candidateLabel(c, meta!.classes)}${c.reasons[0] ? ` – ${c.reasons[0]}` : ''}`;
      b.querySelector('.sle-cand-st')!.textContent = st ? STATUS_LABELS_DE[st] : '';
      b.title = `${c.id} – hinfliegen`;
      b.addEventListener('click', () => select(c.id, true));
      frag.appendChild(b);
    }
    listEl.appendChild(frag);
    if (visible.length > LIST_LIMIT) {
      const p = document.createElement('p');
      p.className = 'sle-dim sle-small';
      p.textContent = `… ${visible.length - LIST_LIMIT} weitere (Min. Score erhöhen oder mit N/P blättern)`;
      listEl.appendChild(p);
    }
  }

  function renderDetail(): void {
    const i = current ? visible.findIndex((c) => c.id === current!.id) : -1;
    q('[data-k=pos]').textContent = visible.length ? `${i >= 0 ? i + 1 : '–'} / ${visible.length}` : '';
    if (!current) {
      detail.hidden = true;
      return;
    }
    const c = current;
    const st = statusOf(c.id);
    const flags = [
      c.forest ? 'unter Wald' : 'offenes Gelände',
      ...(isKnownPath(c) ? ['verläuft entlang eines OSM-Wegs'] : c.nearPath ? ['Weg/Gewässer in der Nähe (OSM)'] : []),
      ...(c.nearKnown ? [`nahe bekanntem Ort (${esc(c.nearKnown)})`] : []),
    ];
    detail.hidden = false;
    detail.innerHTML = `
      <div class="sle-cand-head"><i style="background:${hexCss(candidateColor(c))}"></i><b>${esc(candidateLabel(c, meta!.classes))}</b>
        <span class="sle-spacer"></span><span>Score <b>${formatScore(c.score)}</b></span></div>
      ${c.reasons.length ? `<div class="sle-cand-reasons">${c.reasons.map(esc).join(' · ')}</div>` : ''}
      <dl class="sle-meta">${formatMetrics(c.metrics).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="sle-dim sle-small">${flags.join(' · ')}${st ? ` · Status: <b>${STATUS_LABELS_DE[st]}</b>` : ''}</div>
      <div class="sle-row sle-cand-review">
        <button type="button" class="sle-btn${st === 'confirmed' ? ' on' : ''}" data-st="confirmed" title="Als privaten Fundmarker übernehmen">bestätigen</button>
        <button type="button" class="sle-btn${st === 'unsure' ? ' on' : ''}" data-st="unsure">unsicher</button>
        <button type="button" class="sle-btn${st === 'rejected' ? ' on' : ''}" data-st="rejected">verwerfen</button>
        ${st ? '<button type="button" class="sle-link" data-st="reset" title="Entscheidung entfernen">zurücksetzen</button>' : ''}
      </div>
      ${
        markerOffer && markerOffer.candId === c.id
          ? `<div class="sle-cand-offer" role="group" aria-label="Fundmarker löschen?">
        <span>Der beim Bestätigen angelegte Fundmarker „${esc(markerOffer.title)}“ bleibt erhalten.</span>
        <span class="sle-row"><button type="button" class="sle-btn danger" data-offer="delete">Marker löschen</button>
        <button type="button" class="sle-btn" data-offer="keep">Behalten</button></span></div>`
          : ''
      }`;
    for (const b of detail.querySelectorAll<HTMLButtonElement>('[data-st]')) {
      b.addEventListener('click', () => decide(b.dataset.st === 'reset' ? null : (b.dataset.st as CandidateReviewStatus)));
    }
    detail.querySelector('[data-offer=delete]')?.addEventListener('click', () => resolveMarkerOffer(true));
    detail.querySelector('[data-offer=keep]')?.addEventListener('click', () => resolveMarkerOffer(false));
  }

  function showCurrentPin(): void {
    if (!current || !prefs.on) return;
    const el = document.createElement('div');
    el.className = 'sle-pin cand';
    el.innerHTML = `<span class="sle-pin-txt"></span><span class="sle-pin-stem"></span>`;
    el.querySelector('.sle-pin-txt')!.textContent = `${candidateLabel(current, meta!.classes)} · ${formatScore(current.score)}`;
    (el.querySelector('.sle-pin-txt') as HTMLElement).style.borderLeft = `4px solid ${hexCss(candidateColor(current))}`;
    el.title = 'Verdachtsfläche (Hypothese) – Schauen, nicht graben';
    deps.labels.set(LABEL_ID, LABEL_GROUP, current.E, current.N, el, { lift: 0, maxDistance: 4000 });
  }

  function select(id: string | null, fly = true): void {
    current = id ? (byId.get(id) ?? null) : null;
    if (markerOffer && markerOffer.candId !== current?.id) markerOffer = null;
    layer.setSelected(current);
    deps.labels.remove(LABEL_ID);
    showCurrentPin();
    renderMap();
    for (const row of listEl.querySelectorAll<HTMLElement>('.sle-cand-row')) row.classList.toggle('active', row.dataset.id === current?.id);
    listEl.querySelector('.sle-cand-row.active')?.scrollIntoView({ block: 'nearest' });
    renderDetail();
    if (current && fly) {
      const r = candidateRadius(current);
      const dist = Math.min(160, Math.max(45, r * 4));
      void flyToSiteExag(ctx, current.E, current.N, dist, dist * 0.65, Number.isFinite(current.z) ? current.z : null);
    }
  }

  function next(dir: 1 | -1 = 1): void {
    if (!all) return;
    const id = stepCandidate(visible, current?.id ?? null, dir, current ?? undefined);
    if (id) select(id, true);
  }

  function decide(st: CandidateReviewStatus | null, id = current?.id): void {
    const c = id ? byId.get(id) : undefined;
    if (!c) return;
    const prev = reviews.decisions[c.id];
    // Un-confirming keeps the private marker; offer (inline, no dialog) to delete it.
    const linked = existingCandidateMarkerId(c.id, prev?.markerId, deps.markers.list());
    markerOffer = null;
    if (prev?.status === 'confirmed' && st !== 'confirmed' && linked) {
      const m = deps.markers.list().find((x) => x.id === linked);
      markerOffer = { candId: c.id, markerId: linked, title: m?.title ?? 'Fundmarker' };
    }
    if (st === null) {
      delete reviews.decisions[c.id];
    } else {
      let markerId = existingCandidateMarkerId(c.id, prev?.markerId, deps.markers.list());
      if (st === 'confirmed' && !markerId) {
        const label = candidateLabel(c, meta!.classes);
        const text = markerTextFor(c, label, { method: meta!.method, version: meta!.version });
        markerId = newMarkerId();
        const h = Number.isFinite(c.z) ? c.z : terrain.heightAt(c.E - manifest.origin.E0, -(c.N - manifest.origin.N0));
        deps.markers.add({
          id: markerId,
          title: text.title,
          note: text.note,
          category: markerCategoryFor(c),
          created: new Date().toISOString(),
          E: Math.round(c.E * 100) / 100,
          N: Math.round(c.N * 100) / 100,
          h: Number.isFinite(h) ? Math.round(h * 100) / 100 : null,
        });
        toast(`Als Fundmarker „${text.title}“ gespeichert (privat).`);
        // Flurstück from the local AOI data only (no network): polygons, else the nearest label.
        const newId = markerId;
        void lookupParcelLocal(c.E, c.N).then((parcel) => {
          if (parcel) deps.markers.setParcel(newId, parcel);
        });
      }
      reviews.decisions[c.id] = decisionFor(c, st, new Date(), markerId);
    }
    if (!saveReviews(kv, aoi, reviews)) toast('Speichern im Browser nicht möglich (localStorage).', true);
    refresh();
    select(c.id, false); // keep the reviewed candidate selected (N continues from it)
  }

  function resolveMarkerOffer(remove: boolean): void {
    const o = markerOffer;
    markerOffer = null;
    if (o && remove) {
      const removed = deps.markers.delete(o.markerId);
      const d = reviews.decisions[o.candId];
      if (d?.markerId === o.markerId) {
        const rest = { ...d };
        delete rest.markerId;
        reviews.decisions[o.candId] = rest;
        saveReviews(kv, aoi, reviews);
      }
      toast(removed ? `Fundmarker „${o.title}“ gelöscht.` : 'Fundmarker war bereits gelöscht.');
    }
    renderDetail();
  }

  function exportJson(): void {
    const n = Object.keys(reviews.decisions).length;
    if (!n) {
      toast('Noch keine Entscheidungen zum Exportieren.', true);
      return;
    }
    const doc = exportDecisions(reviews, aoi, { method: meta!.method, version: meta!.version });
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `verdachtsflaechen-entscheidungen-${aoi}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function toast(msg: string, warn = false): void {
    const t = document.createElement('div');
    t.className = `sle-toast${warn ? ' warn' : ''}`;
    t.textContent = msg;
    document.querySelector('#app')!.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  const api: CandidatesApi = {
    meta,
    all: () => all,
    visible: () => visible,
    current: () => current,
    filter: () => prefs.filter,
    reviews: () => reviews,
    setOn,
    setFilter,
    select,
    next,
    decide,
    layer,
  };
  window.sleCandidates = api;
  if (prefs.on) void setOn(true);
  return api;
}

