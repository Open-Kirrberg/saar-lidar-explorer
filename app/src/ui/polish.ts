/**
 * Final polish wiring: "Einstellungen" card (quality preset, share, help, tour, reset), toolbar
 * buttons (Teilen, Tour, ?), the `?` key, first-run introduction, settings mirroring and the
 * accessibility helpers. Called once from main.ts after initFeatures.
 */
import type { AppContext } from '../main';
import { getLocate } from '../locate/Locate';
import { formatHash, shareUrl } from '../state';
import { installA11y } from './a11y';
import { isTyping } from './keys';
import { closeIntro, isIntroOpen, showIntro } from './onboarding';
import { createPanelSection } from './panelSection';
import { QUALITY_LABELS, applyQuality, pixelRatioFor } from './quality';
import type { QualityTargets } from './quality';
import { QUALITY_LEVELS, SETTINGS_STATE_KEYS, poseOnlyHash, resetSettings, settingsFromState } from './settings';
import type { KeyValueStore, QualityLevel, Settings } from './settings';
import type { ShortcutFeature } from './shortcuts';
import { createTourGuide } from './TourGuide';
import type { TourGuide } from './TourGuide';
import type { Labels3D } from './Labels3D';
import { copyText } from './clipboard';
import { openQrDialog } from '../share/QrDialog';
import { openAbout } from './about';
import { watchContextLoss } from './contextLoss';
import { UI_MODE_LABELS, deviceEnv, initMobile } from './mobile';
import { autoQuality } from './mobileMode';
import type { ReliefPanelApi } from './reliefPanel';
import { UI_MODE_PREFS } from './settings';
import type { UiModePref } from './settings';
import type { Minimap } from '../map/Minimap';
import './polish.css';

export interface SettingsRuntime {
  get(): Settings;
  patch(p: Partial<Settings>): void;
  /** Stop writing (settings reset in progress: nothing may re-create the key before reload). */
  freeze(): void;
}

export function createSettingsRuntime(kv: KeyValueStore | null, initial: Settings, save: (kv: KeyValueStore | null, s: Settings) => boolean): SettingsRuntime {
  let s = initial;
  let frozen = false;
  return {
    get: () => s,
    patch(p) {
      s = { ...s, ...p };
      if (!frozen) save(kv, s);
    },
    freeze() {
      frozen = true;
    },
  };
}

export function featureChecker(ctx: Pick<AppContext, 'manifest'>): (f: ShortcutFeature) => boolean {
  const m = ctx.manifest;
  return (f) => {
    switch (f) {
      case 'osm':
        return !!m.vectors?.osm;
      case 'buildings':
        return !!m.models?.buildings?.chunks.length;
      case 'pointclouds':
        return false; // 🧊 frozen (ADR 0020): no point cloud UI, so no key row
      case 'candidates':
        return !!m.candidates;
      case 'reconstruction':
        // F19: shared dataset, loaded after start-up (FEATURES_EVENT re-renders the HUD rows).
        return typeof window !== 'undefined' && !!window.sleRecon;
    }
  };
}

export interface PolishDeps {
  settings: SettingsRuntime;
  kv: KeyValueStore | null;
  labels: Labels3D | null;
  applyPreset(id: string): boolean;
  /** Re-applies renderer size after a pixel-ratio change. */
  resize(): void;
  /** F20 simple layout: the minimap goes into the "Karte" sheet, relief presets drive "Relief". */
  minimap?: Minimap | null;
  relief?: ReliefPanelApi | null;
}

const QUALITY_HINTS: Record<QualityLevel, string> = {
  hoch: 'Volle Auflösung, Details bis weit hinaus (Standard).',
  mittel: 'Weniger Pixel und Details in der Ferne – flüssiger auf schwächeren Rechnern.',
  niedrig: 'Deutlich gröber, kleinere Radien für Gebäude und Beschriftungen.',
  mobil: 'Für Handys: begrenzte Auflösung und Speicher, kurze Radien, wenige Punkte.',
};

export function initPolish(ctx: AppContext, deps: PolishDeps): void {
  const { store, terrain, renderer } = ctx;
  const { settings } = deps;
  const hasFeature = featureChecker(ctx);
  installA11y(document.querySelector<HTMLElement>('#app') ?? document.body);

  // ---- settings mirroring (store → localStorage, debounced) -----------------------------------
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let resetting = false;
  store.subscribe(
    () => {
      if (resetting) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => settings.patch(settingsFromState(settings.get(), store.get())), 400);
    },
    [...SETTINGS_STATE_KEYS],
  );

  // ---- quality presets --------------------------------------------------------------------------
  const baseDistances = [...terrain.lod.distances];
  const targets = (): QualityTargets => {
    const b = window.sleBuildings?.layer;
    const fade = (b?.material.uniforms.uFade?.value ?? null) as { set(a: number, c: number): unknown } | null;
    return {
      setPixelRatio: (r) => {
        if (renderer.getPixelRatio() === r) return;
        renderer.setPixelRatio(r);
        deps.resize();
      },
      devicePixelRatio: window.devicePixelRatio || 1,
      streaming: terrain.streaming,
      lodDistances: terrain.lod.distances,
      baseDistances,
      labels: deps.labels,
      buildings: b ? { opts: b.opts, fade: fade ?? undefined } : null,
      pointClouds: window.slePointClouds ?? null,
    };
  };
  // F20: phones start on "Mobil" until the user picks a preset (not saved: desktop stays "Hoch").
  const startQuality = autoQuality(settings.get(), deviceEnv());
  let quality: QualityLevel = startQuality.level;
  applyQuality(quality, targets(), startQuality.auto);
  // DPR changes (moving screens): only the pixel ratio follows; LOD/streaming knobs keep any manual
  // "LOD / Debug" tweaks until the next explicit preset pick.
  window.addEventListener('resize', () => {
    const t = targets();
    t.setPixelRatio(pixelRatioFor(quality, t.devicePixelRatio));
  });
  // F20: WebGL context loss (phones in the background) → message + reload with the same view.
  watchContextLoss(renderer.domElement);

  // ---- toast ----------------------------------------------------------------------------------
  const toastEl = document.createElement('div');
  toastEl.className = 'sle-toast sle-polish-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  toastEl.hidden = true;
  document.querySelector('#app')!.appendChild(toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (text: string, warn = false, ms = 2600, selectable = false) => {
    toastEl.textContent = text;
    toastEl.classList.toggle('warn', warn);
    toastEl.classList.toggle('selectable', selectable);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
  };

  // ---- share ------------------------------------------------------------------------------------
  const share = async () => {
    const st = store.get();
    // F20: a link from right next to "Mein Standort" would give the user's position away.
    if (getLocate()?.revealsPosition(st)) {
      toast('Ansicht teilen ist gesperrt, solange die Ansicht Ihren Standort verrät. Erst über 1 km wegfliegen.', true, 6000);
      return;
    }
    const url = shareUrl(location, st);
    try {
      history.replaceState(null, '', formatHash(st)); // address bar matches what was copied
    } catch {
      /* ignore */
    }
    if (await copyText(url)) toast('Link kopiert – Position, Ansicht, Überhöhung und Sonne. Ohne Fundmarker/Verdachtsflächen.');
    // No clipboard (no user activation, permissions): show the link for manual copying.
    else toast(`Kopieren nicht möglich – Link zum Kopieren: ${url}`, true, 12000, true);
  };

  // ---- tour + intro -----------------------------------------------------------------------------
  let tour: TourGuide | null = null;
  const tourReady = createTourGuide(ctx, { applyPreset: deps.applyPreset }).then((t) => (tour = t));
  const startTour = () => {
    if (!tour?.stops.length) return toast('Für dieses Gebiet gibt es keine Tour-Stationen.', true);
    tour.start(0);
  };
  const openIntro = () =>
    showIntro({
      touch: deviceEnv().coarse,
      hasFeature,
      seen: settings.get().onboardingSeen,
      onClose: (seen) => settings.patch({ onboardingSeen: seen }),
      startTour: tour?.stops.length ? startTour : undefined,
    });
  const toggleIntro = () => (isIntroOpen() ? closeIntro() : openIntro());

  // `?` (Shift+ß / Shift+/): capture phase so the speed keys on the same physical key don't fire.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleIntro();
    },
    true,
  );

  // ---- toolbar buttons --------------------------------------------------------------------------
  const bar = document.querySelector<HTMLElement>('#sle-toolbar');
  if (bar) {
    const mk = (act: string, html: string, title: string, aria?: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.act = act;
      b.innerHTML = html;
      b.title = title;
      if (aria) b.setAttribute('aria-label', aria);
      bar.appendChild(b);
      return b;
    };
    mk('share', 'Teilen', 'Ansicht teilen: Link mit Position und Darstellung kopieren').addEventListener('click', () => void share());
    mk('qr', 'QR', 'QR-Code zur öffentlichen Website (z. B. zum Öffnen auf dem Handy)', 'QR-Code zur Website').addEventListener('click', () =>
      openQrDialog({ store, revealsPosition: () => getLocate()?.revealsPosition(store.get()) ?? false }),
    );
    const tourBtn = mk('tour', 'Tour', 'Tour durch bekannte Orte');
    tourBtn.hidden = true;
    tourBtn.addEventListener('click', () => (tour?.active ? tour.stop() : startTour()));
    void tourReady.then((t) => (tourBtn.hidden = t.stops.length === 0));
    mk('help', '?', 'Hilfe & alle Tastenkürzel (Taste ?)', 'Hilfe und alle Tastenkürzel (Taste ?)').addEventListener('click', toggleIntro);
  }

  // ---- "Einstellungen" card ---------------------------------------------------------------------
  const sec = createPanelSection(document.querySelector<HTMLElement>('#panel')!, 'settings', 'Einstellungen & Hilfe', false);
  sec.body.innerHTML = `
    <div class="sle-section-label" id="sle-uimode-label">Ansicht</div>
    <div class="sle-seg" data-k="uimode" role="radiogroup" aria-labelledby="sle-uimode-label"></div>
    <p class="sle-dim sle-small">„Einfach“: große Schaltflächen unten, Karte und Einstellungen als Leisten – für Handys.</p>
    <div class="sle-section-label" id="sle-quality-label">Qualität</div>
    <div class="sle-seg" role="radiogroup" aria-labelledby="sle-quality-label"></div>
    <p class="sle-dim sle-small" data-k="qhint"></p>
    <div class="sle-btn-grid">
      <button type="button" class="sle-btn" data-act="share">Ansicht teilen</button>
      <button type="button" class="sle-btn" data-act="intro">Einführung <kbd>?</kbd></button>
      <button type="button" class="sle-btn" data-act="tour" hidden>Tour starten</button>
      <button type="button" class="sle-btn" data-act="reset">Einstellungen zurücksetzen</button>
      <button type="button" class="sle-btn" data-act="about">Über &amp; Datenschutz</button>
    </div>
    <p class="sle-dim sle-small">Gespeichert werden nur Einstellungen in diesem Browser. Fundmarker, Bewertungen und
    Messungen bleiben beim Zurücksetzen erhalten und sind nie Teil eines geteilten Links.</p>`;
  const seg = sec.body.querySelector<HTMLElement>('.sle-seg[role=radiogroup]:not([data-k])')!;
  const qhint = sec.body.querySelector<HTMLElement>('[data-k=qhint]')!;
  const syncQuality = () => {
    const cur = quality;
    for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.q === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    qhint.textContent = QUALITY_HINTS[cur];
  };
  const pickQuality = (q: QualityLevel) => {
    quality = q;
    settings.patch({ quality: q, qualityPicked: true });
    applyQuality(q, targets(), true);
    syncQuality();
    toast(`Qualität: ${QUALITY_LABELS[q]}`);
  };
  for (const q of QUALITY_LEVELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.q = q;
    b.setAttribute('role', 'radio');
    b.textContent = QUALITY_LABELS[q];
    b.addEventListener('click', () => pickQuality(q));
    seg.appendChild(b);
  }
  // Arrow keys move within the radio group (WAI-ARIA radio pattern); focus stays there.
  seg.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation(); // not a flight key here
    const i = QUALITY_LEVELS.indexOf(quality);
    const q = QUALITY_LEVELS[(i + d + QUALITY_LEVELS.length) % QUALITY_LEVELS.length];
    pickQuality(q);
    seg.querySelector<HTMLButtonElement>(`[data-q=${q}]`)?.focus();
  });
  syncQuality();

  // ---- F20 simple (mobile) layout + "Ansicht" switch --------------------------------------------
  const mobile = initMobile(ctx, { settings, minimap: deps.minimap ?? null, relief: deps.relief ?? null, toast: (t, w) => toast(t, w) });
  const modeSeg = sec.body.querySelector<HTMLElement>('[data-k=uimode]')!;
  const syncUiMode = () => {
    for (const b of modeSeg.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.pref === mobile.pref();
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  for (const p of UI_MODE_PREFS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.pref = p;
    b.setAttribute('role', 'radio');
    b.textContent = UI_MODE_LABELS[p];
    b.addEventListener('click', () => mobile.setPref(p as UiModePref));
    modeSeg.appendChild(b);
  }
  // Same WAI-ARIA radio keys as the quality segment (only the selected option is tabbable).
  modeSeg.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation(); // not a flight key here
    const i = Math.max(0, UI_MODE_PREFS.indexOf(mobile.pref()));
    const p = UI_MODE_PREFS[(i + d + UI_MODE_PREFS.length) % UI_MODE_PREFS.length];
    mobile.setPref(p);
    modeSeg.querySelector<HTMLButtonElement>(`[data-pref=${p}]`)?.focus();
  });
  mobile.onMode(syncUiMode);

  const q = <T extends HTMLElement>(s: string) => sec.body.querySelector<T>(s)!;
  q('[data-act=share]').addEventListener('click', () => void share());
  q('[data-act=intro]').addEventListener('click', openIntro);
  q('[data-act=about]').addEventListener('click', openAbout);
  const tourCardBtn = q<HTMLButtonElement>('[data-act=tour]');
  tourCardBtn.addEventListener('click', startTour);
  void tourReady.then((t) => (tourCardBtn.hidden = t.stops.length === 0));

  // Reset: two-step button instead of a confirm() dialog.
  const resetBtn = q<HTMLButtonElement>('[data-act=reset]');
  let armed: ReturnType<typeof setTimeout> | undefined;
  resetBtn.addEventListener('click', () => {
    if (!armed) {
      resetBtn.textContent = 'Wirklich zurücksetzen? Nochmal klicken';
      resetBtn.classList.add('danger');
      armed = setTimeout(() => {
        armed = undefined;
        resetBtn.textContent = 'Einstellungen zurücksetzen';
        resetBtn.classList.remove('danger');
      }, 4000);
      return;
    }
    resetting = true;
    settings.freeze();
    clearTimeout(saveTimer);
    resetSettings(deps.kv);
    // Keep the camera, reset the look: drop display/view fields from the hash, then reload.
    history.replaceState(null, '', `${location.pathname}${location.search}${poseOnlyHash(location.hash)}`);
    location.reload();
  });

  // ---- first run --------------------------------------------------------------------------------
  if (!settings.get().onboardingSeen) {
    void tourReady.then(() => whenNoDisclaimer(openIntro));
  }
}

/** Runs `fn` once the "Schauen, nicht graben" dialog is closed (or right away if it isn't open). */
function whenNoDisclaimer(fn: () => void): void {
  if (!document.getElementById('sle-disclaimer')) return fn();
  const mo = new MutationObserver(() => {
    if (document.getElementById('sle-disclaimer')) return;
    mo.disconnect();
    fn();
  });
  mo.observe(document.querySelector('#app') ?? document.body, { childList: true });
}
