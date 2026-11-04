/**
 * F20 simple (mobile) layout: full-screen 3D, compact top bar (title, "ⓘ Quellen", menu), a bottom
 * bar with five large buttons — Standort, Relief, Ebenen, Karte, Mehr — and bottom sheets for the
 * layer toggles, the minimap and the full panel. Desktop ("Vollständig") is untouched: the simple
 * layout only adds `html.sle-simple` and moves #panel / #minimap / #sle-toolbar into the sheets
 * (and back), so every existing listener keeps working.
 *
 * Mode: `resolveUiMode(pref, env)` — 'auto' = simple on touch-first devices or < 820 px; the
 * preference ("Ansicht: Einfach / Vollständig") lives in the settings. `html.sle-touch` marks a
 * coarse primary pointer (keyboard hints hidden, gestures shown instead).
 */
import { getLocate } from '../locate';
import type { LocateState } from '../locate';
import type { AppContext } from '../main';
import type { Minimap } from '../map/Minimap';
import { showDisclaimer } from './disclaimer';
import { RELIEF_CYCLE, currentReliefStep, nextReliefStep, resolveUiMode, toggleSheet } from './mobileMode';
import type { DeviceEnv, ReliefStep, SheetId, UiMode } from './mobileMode';
import type { ReliefPanelApi } from './reliefPanel';
import type { SettingsRuntime } from './polish';
import type { UiModePref } from './settings';
import { BottomSheet } from './sheet';
import './mobile.css';

export interface MobileDeps {
  settings: SettingsRuntime;
  minimap: Minimap | null;
  relief: Pick<ReliefPanelApi, 'hasPreset' | 'showMode' | 'applyPresetById' | 'activePresetId'> | null;
  toast(text: string, warn?: boolean): void;
}

export interface MobileApi {
  mode(): UiMode;
  pref(): UiModePref;
  setPref(p: UiModePref): void;
  /** Subscribe to layout changes (called immediately). */
  onMode(cb: (m: UiMode) => void): () => void;
}

export function deviceEnv(): DeviceEnv {
  let coarse = false;
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches;
  } catch {
    /* old browsers */
  }
  return { coarse, width: window.innerWidth, height: window.innerHeight };
}

export const UI_MODE_LABELS: Record<UiModePref, string> = { auto: 'Automatisch', simple: 'Einfach', full: 'Vollständig' };

const ICONS = {
  locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8" fill="none"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>',
  relief: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 19l6-9 4 5 3-4 7 8z"/></svg>',
  layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 5-10 5L2 8z"/><path d="M2 12l10 5 10-5M2 16l10 5 10-5" fill="none"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="none"/><path d="M9 4v14M15 6v14"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
};

interface LayerToggle {
  id: string;
  label: string;
  hint: string;
  available(): boolean;
  isOn(): boolean;
  set(on: boolean): void | Promise<void>;
}

export function initMobile(ctx: AppContext, deps: MobileDeps): MobileApi {
  const { store, terrain, manifest } = ctx;
  const html = document.documentElement;
  const app = document.querySelector<HTMLElement>('#app') ?? document.body;
  const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);

  // ---- top bar ------------------------------------------------------------------------------------
  const top = document.createElement('header');
  top.id = 'sle-topbar';
  top.innerHTML = `
    <div class="sle-tb-titles"><span class="sle-tb-title">Saar LiDAR Explorer</span><span class="sle-tb-aoi"></span></div>
    <button type="button" class="sle-tb-btn" data-act="sources" aria-controls="attribution" aria-expanded="false">ⓘ Quellen</button>
    <button type="button" class="sle-tb-btn sle-tb-menu" data-act="menu" aria-label="Menü: alle Einstellungen">☰</button>`;
  top.querySelector('.sle-tb-aoi')!.textContent = manifest.name;
  app.appendChild(top);
  const sourcesBtn = top.querySelector<HTMLButtonElement>('[data-act=sources]')!;
  const footer = $('#attribution');
  const setSources = (open: boolean) => {
    footer?.classList.toggle('sle-open', open);
    sourcesBtn.setAttribute('aria-expanded', String(open));
    sourcesBtn.classList.toggle('on', open);
  };
  sourcesBtn.addEventListener('click', () => setSources(!footer?.classList.contains('sle-open')));
  top.querySelector('[data-act=menu]')!.addEventListener('click', () => openSheet(toggleSheet(openId, 'more')));

  // ---- bottom bar -----------------------------------------------------------------------------------
  const bar = document.createElement('nav');
  bar.id = 'sle-bottombar';
  bar.setAttribute('aria-label', 'Hauptaktionen');
  const mkBtn = (act: string, icon: string, label: string, title: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = act;
    b.title = title;
    b.innerHTML = `${icon}<span class="sle-bb-label"></span><span class="sle-bb-sub"></span>`;
    b.querySelector('.sle-bb-label')!.textContent = label;
    bar.appendChild(b);
    return b;
  };
  const locBtn = mkBtn('locate', ICONS.locate, 'Standort', 'Mein Standort: zur eigenen Position fliegen (bleibt privat)');
  locBtn.hidden = true; // 🧊 "Mein Standort" is frozen (ADR 0020): code kept, off the UI, initLocate() not called
  const reliefBtn = mkBtn('relief', ICONS.relief, 'Relief', 'Reliefdarstellung wechseln');
  const layersBtn = mkBtn('layers', ICONS.layers, 'Ebenen', 'Ebenen ein-/ausblenden');
  const mapBtn = mkBtn('map', ICONS.map, 'Karte', 'Übersichtskarte');
  const moreBtn = mkBtn('more', ICONS.more, 'Mehr', 'Alle Einstellungen, Orte, Fundmarker, Messen');
  for (const [b, id] of [[layersBtn, 'layers'], [mapBtn, 'map'], [moreBtn, 'more']] as const) {
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => openSheet(toggleSheet(openId, id)));
  }
  app.appendChild(bar);

  // ---- sheets ------------------------------------------------------------------------------------------
  let openId: SheetId | null = null;
  const fullBtn = document.createElement('button');
  fullBtn.type = 'button';
  fullBtn.className = 'sle-sheet-act';
  fullBtn.textContent = 'Vollbild';
  fullBtn.setAttribute('aria-pressed', 'false');
  const sheets: Record<SheetId, BottomSheet> = {
    layers: new BottomSheet(app, { id: 'sle-sheet-layers', title: 'Ebenen', onClose: () => openSheet(null) }),
    map: new BottomSheet(app, { id: 'sle-sheet-map', title: 'Karte', actions: [fullBtn], onClose: () => openSheet(null) }),
    more: new BottomSheet(app, { id: 'sle-sheet-more', title: 'Alle Einstellungen', onClose: () => openSheet(null) }),
  };
  fullBtn.addEventListener('click', () => {
    const on = !sheets.map.root.classList.contains('sle-sheet-full');
    sheets.map.root.classList.toggle('sle-sheet-full', on);
    fullBtn.setAttribute('aria-pressed', String(on));
    fullBtn.textContent = on ? 'Verkleinern' : 'Vollbild';
  });
  const sheetBtn: Record<SheetId, HTMLButtonElement> = { layers: layersBtn, map: mapBtn, more: moreBtn };

  let mapCollapsedBefore: boolean | null = null;
  function openSheet(id: SheetId | null): void {
    openId = id;
    for (const k of Object.keys(sheets) as SheetId[]) {
      const on = k === id;
      if (on) sheets[k].open();
      else sheets[k].close(true);
      sheetBtn[k].classList.toggle('on', on);
      sheetBtn[k].setAttribute('aria-expanded', String(on));
    }
    html.classList.toggle('sle-sheet-open', id !== null);
    if (id === 'layers') syncLayers();
    if (id === 'map' && deps.minimap) {
      // The map must be expanded inside the sheet; the desktop preference is restored later.
      if (mapCollapsedBefore === null) mapCollapsedBefore = deps.minimap.collapsed;
      deps.minimap.setCollapsed(false);
    }
    if (id) setSources(false);
  }
  // A tap on the map flies there: close the sheet so the flight is visible.
  deps.minimap?.map.on('click', () => {
    if (mode === 'simple' && openId === 'map') openSheet(null);
  });

  // "Mehr": quick row (layout switch + the toolbar's tools), then the whole panel.
  const quick = document.createElement('div');
  quick.className = 'sle-more-quick';
  quick.innerHTML = `
    <div class="sle-more-mode" role="radiogroup" aria-label="Ansicht">
      <span class="sle-dim">Ansicht</span>
      <button type="button" role="radio" data-pref="simple">Einfach</button>
      <button type="button" role="radio" data-pref="full">Vollständig</button>
    </div>
    <div class="sle-more-tools"></div>`;
  sheets.more.body.appendChild(quick);
  for (const b of quick.querySelectorAll<HTMLButtonElement>('[data-pref]')) {
    b.addEventListener('click', () => setPref(b.dataset.pref as UiModePref));
  }
  // Tool proxies: the real #sle-toolbar stays where it is (its active tool and the contextual
  // "Schloss betreten" buttons float above the bottom bar); the sheet offers the same actions.
  const toolsSlot = quick.querySelector<HTMLElement>('.sle-more-tools')!;
  const toolbar = $('#sle-toolbar');
  const PROXIES: Array<[act: string, label: string]> = [
    ['mark', 'Fundmarker setzen'],
    ['measure', 'Messen'],
    ['share', 'Ansicht teilen'],
    ['qr', 'QR-Code zur Website'],
    ['tour', 'Tour'],
    ['help', 'Hilfe & Gesten'],
  ];
  const proxies: Array<[HTMLButtonElement, string]> = [];
  for (const [act, label] of PROXIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sle-btn';
    b.dataset.proxy = act;
    b.textContent = label;
    b.addEventListener('click', () => {
      openSheet(null);
      toolbar?.querySelector<HTMLButtonElement>(`:scope > button[data-act="${act}"]`)?.click();
    });
    toolsSlot.appendChild(b);
    proxies.push([b, act]);
  }
  const syncProxies = () => {
    for (const [b, act] of proxies) {
      const orig = toolbar?.querySelector<HTMLButtonElement>(`:scope > button[data-act="${act}"]`);
      b.hidden = !orig || orig.hidden;
      b.classList.toggle('on', !!orig?.classList.contains('on'));
    }
  };
  if (toolbar) new MutationObserver(syncProxies).observe(toolbar, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  syncProxies();

  // ---- layers sheet --------------------------------------------------------------------------------
  const m = manifest;
  const toggles: LayerToggle[] = [
    {
      id: 'forest',
      label: 'Wald',
      hint: 'Baumkronen halbtransparent über dem Boden',
      available: () => terrain.hasCanopyData(),
      isOn: () => terrain.forest.mode !== 'off',
      set: (on) => store.set({ forest: on ? 'transparent' : 'off' }, 'gui'),
    },
    {
      id: 'osm',
      label: 'Wege (OSM)',
      hint: 'Wege und Straßen aus OpenStreetMap',
      available: () => !!m.vectors?.osm && !!window.sleVectors,
      isOn: () => !!window.sleVectors?.osm?.visible,
      set: (on) => window.sleVectors?.setOsm(on),
    },
    {
      id: 'buildings',
      label: 'Gebäude',
      hint: '3D-Gebäude (LoD2)',
      available: () => !!window.sleBuildings,
      isOn: () => !!window.sleBuildings?.on,
      set: (on) => window.sleBuildings?.setOn(on),
    },
    {
      id: 'candidates',
      label: 'Verdachtsflächen',
      hint: 'automatisch gefundene Hypothesen – nicht graben',
      available: () => !!window.sleCandidates,
      isOn: () => !!window.sleCandidates?.layer.visible,
      set: (on) => window.sleCandidates?.setOn(on),
    },
    {
      id: 'recon',
      label: 'Rekonstruktion 1789',
      hint: 'Schloss Karlsberg (Hypothese)',
      available: () => !!window.sleRecon,
      isOn: () => !!window.sleRecon?.on,
      set: (on) => window.sleRecon?.setOn(on),
    },
  ];
  const list = document.createElement('div');
  list.className = 'sle-layer-list';
  sheets.layers.body.appendChild(list);
  const layerNote = document.createElement('p');
  layerNote.className = 'sle-layer-note';
  layerNote.innerHTML = 'Alles Markierte sind <strong>Hypothesen</strong>. Schauen, nicht graben. <button type="button" class="sle-link">Hinweise</button>';
  layerNote.querySelector('button')!.addEventListener('click', () => showDisclaimer(true));
  sheets.layers.body.appendChild(layerNote);
  const pending = new Map<string, boolean>();
  function syncLayers(): void {
    list.replaceChildren();
    for (const t of toggles) {
      if (!t.available()) continue;
      const on = pending.get(t.id) ?? t.isOn();
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sle-layer-toggle';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
      b.innerHTML = '<span class="sle-lt-text"><span class="sle-lt-label"></span><span class="sle-lt-hint"></span></span><span class="sle-switch" aria-hidden="true"></span>';
      b.querySelector('.sle-lt-label')!.textContent = t.label;
      b.querySelector('.sle-lt-hint')!.textContent = pending.has(t.id) ? 'lädt …' : t.hint;
      b.addEventListener('click', () => {
        const next = !(pending.get(t.id) ?? t.isOn());
        pending.set(t.id, next);
        syncLayers();
        void Promise.resolve(t.set(next))
          .catch((err) => console.warn('[mobile] layer toggle failed', t.id, err))
          .finally(() => {
            pending.delete(t.id);
            if (openId === 'layers') syncLayers();
          });
      });
      list.appendChild(b);
    }
    if (!list.children.length) list.innerHTML = '<p class="sle-dim">Für dieses Gebiet gibt es keine zusätzlichen Ebenen.</p>';
  }
  window.addEventListener('sle:features', () => openId === 'layers' && syncLayers());

  // ---- relief cycle --------------------------------------------------------------------------------
  const relief = deps.relief;
  const steps: ReliefStep[] = relief
    ? RELIEF_CYCLE.filter((st) => (st.kind === 'mode' ? terrain.isValidDisplay(st.ref) : relief.hasPreset(st.ref)))
    : [];
  const look = () => ({ layer: terrain.getDisplay(), overlay: terrain.getOverlay().key, preset: relief?.activePresetId() ?? '' });
  const syncReliefBtn = () => {
    const i = currentReliefStep(steps, look());
    reliefBtn.querySelector('.sle-bb-sub')!.textContent = i >= 0 ? steps[i].label : 'eigene';
  };
  reliefBtn.hidden = steps.length === 0;
  reliefBtn.addEventListener('click', () => {
    if (!relief) return;
    const i = nextReliefStep(steps, look());
    if (i < 0) return;
    const st = steps[i];
    const ok = st.kind === 'mode' ? relief.showMode(st.ref) : relief.applyPresetById(st.ref);
    if (ok) deps.toast(`Relief: ${st.label}`);
    syncReliefBtn();
  });
  let reliefQueued = false;
  terrain.onChange(() => {
    if (reliefQueued) return;
    reliefQueued = true;
    queueMicrotask(() => {
      reliefQueued = false;
      syncReliefBtn();
    });
  });
  store.subscribe(() => syncReliefBtn(), ['layer', 'preset', 'overlay']);
  syncReliefBtn();

  // ---- Mein Standort -------------------------------------------------------------------------------
  const pill = document.createElement('div');
  pill.id = 'sle-locate-pill';
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  pill.hidden = true;
  pill.innerHTML = '<span class="sle-lp-text"></span><span class="sle-lp-acts"></span>';
  app.appendChild(pill);
  let pillTimer: ReturnType<typeof setTimeout> | undefined;
  // Keep html.sle-pill-open in sync with the pill (floating tools move up while it shows).
  new MutationObserver(() => html.classList.toggle('sle-pill-open', !pill.hidden)).observe(pill, { attributes: true, attributeFilter: ['hidden'] });
  let lastLocStatus: LocateState['status'] = 'idle';
  let lastLocFollow = false;
  const renderPill = (s: Readonly<LocateState>) => {
    locBtn.classList.toggle('on', s.status === 'inside' || s.follow);
    locBtn.classList.toggle('busy', s.status === 'locating');
    locBtn.querySelector('.sle-bb-sub')!.textContent = s.follow ? 'folgt' : '';
    if (s.status === lastLocStatus && s.status !== 'locating') {
      // Same status (e.g. ~1 Hz fixes while following): a hidden pill stays hidden; a visible
      // one only gets its text refreshed so its auto-hide timer keeps running.
      if (pill.hidden) return;
      if (s.follow === lastLocFollow) {
        pill.querySelector('.sle-lp-text')!.textContent = s.message;
        return;
      }
    }
    lastLocStatus = s.status;
    lastLocFollow = s.follow;
    clearTimeout(pillTimer);
    if (s.status === 'idle' || !s.message) {
      pill.hidden = true;
      return;
    }
    pill.querySelector('.sle-lp-text')!.textContent = s.message;
    pill.classList.toggle('error', s.status === 'error');
    const acts = pill.querySelector<HTMLElement>('.sle-lp-acts')!;
    acts.replaceChildren();
    const api = getLocate();
    const act = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', fn);
      acts.appendChild(b);
    };
    if (api && s.status === 'outside') act('Zum nächsten Punkt', () => void api.flyToNearest());
    if (api && s.status === 'inside') act(s.follow ? 'Nicht folgen' : 'Folgen', () => api.toggleFollow(!s.follow));
    act('✕', () => (pill.hidden = true));
    pill.hidden = false;
    if (s.status !== 'locating') pillTimer = setTimeout(() => (pill.hidden = true), s.status === 'inside' ? 5000 : 9000);
  };
  let locSubscribed = false;
  const subscribeLocate = () => {
    const api = getLocate();
    if (!api || locSubscribed) return api;
    locSubscribed = true;
    api.onState(renderPill);
    return api;
  };
  subscribeLocate();
  locBtn.addEventListener('click', () => {
    const api = subscribeLocate();
    if (!api) return deps.toast('Standort ist hier nicht verfügbar.', true);
    lastLocStatus = 'idle'; // always show the result of an explicit tap
    void api.locateMe();
  });

  // ---- mode switching ------------------------------------------------------------------------------
  const moves: Array<{ el: HTMLElement; home: Comment; target: HTMLElement }> = [];
  const plan = (sel: string, target: HTMLElement) => {
    const el = $(sel);
    if (!el) return;
    const home = document.createComment(`sle-home:${sel}`);
    el.before(home);
    moves.push({ el, home, target });
  };
  plan('#panel', sheets.more.body);
  plan('#minimap', sheets.map.body);

  let mode: UiMode = 'full';
  const subs = new Set<(m: UiMode) => void>();
  const pref = (): UiModePref => deps.settings.get().uiMode ?? 'auto';
  function apply(): void {
    const env = deviceEnv();
    html.classList.toggle('sle-touch', env.coarse);
    const next = resolveUiMode(pref(), env);
    for (const b of quick.querySelectorAll<HTMLButtonElement>('[data-pref]')) {
      const on = b.dataset.pref === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (next === mode) return;
    mode = next;
    const simple = mode === 'simple';
    openSheet(null);
    setSources(false);
    html.classList.toggle('sle-simple', simple);
    for (const mv of moves) {
      if (simple) mv.target.appendChild(mv.el);
      else mv.home.after(mv.el);
    }
    if (!simple && deps.minimap && mapCollapsedBefore !== null) {
      deps.minimap.setCollapsed(mapCollapsedBefore);
      mapCollapsedBefore = null;
    }
    sheets.map.root.classList.remove('sle-sheet-full');
    for (const cb of subs) cb(mode);
  }
  function setPref(p: UiModePref): void {
    deps.settings.patch({ uiMode: p === 'auto' ? undefined : p });
    apply();
    for (const cb of subs) cb(mode); // the preference changed even when the layout didn't
  }
  // Escape closes an open sheet (focus anywhere outside text fields); capture so tools don't see it.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !openId || mode !== 'simple') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.sle-overlay, #sle-disclaimer, #sle-report, .sle-form')) return;
      e.stopPropagation();
      openSheet(null);
    },
    true,
  );
  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    setTimeout(() => {
      resizeQueued = false;
      apply();
    }, 120);
  });
  try {
    window.matchMedia('(pointer: coarse)').addEventListener('change', apply);
  } catch {
    /* ignore */
  }
  apply();

  return {
    mode: () => mode,
    pref,
    setPref,
    onMode(cb) {
      subs.add(cb);
      cb(mode);
      return () => subs.delete(cb);
    },
  };
}
