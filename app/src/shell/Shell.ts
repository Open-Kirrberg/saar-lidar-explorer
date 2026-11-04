/**
 * v2 game shell (ADR 0019 / 0024 / 0026 / 0032): HUD, action bar, drawers („Orte“, „Werkzeuge“),
 * dialogs, „© Quellen“, tier setting and the tier-gated feature registry. One component set for
 * desktop and phone (CSS layout only; tiers decide what is *mounted*, never CSS).
 */
import type { AppContext } from '../main';
import { SETTINGS_STATE_KEYS, poseOnlyHash, resetSettings, settingsFromState } from '../ui/settings';
import type { KeyValueStore, Settings } from '../ui/settings';
import { installA11y } from '../ui/a11y';
import { watchContextLoss } from '../ui/contextLoss';
import { isTyping } from '../ui/keys';
import { modalOpen } from '../ui/modalKeys';
import { autoQuality } from '../ui/mobileMode';
import { applyQuality, pixelRatioFor } from '../ui/quality';
import type { QualityTargets } from '../ui/quality';
import type { QualityLevel } from '../ui/settings';
import { progressPending, terrainPending } from '../ui/streaming';
import type { LoadProgressLike } from '../ui/streaming';
import { Labels3D } from '../ui/Labels3D';
import type { Shortcut } from '../ui/shortcuts';
import { registerBuiltins } from './builtins';
import { openDialog } from './dialog';
import { openKeysDialog, openSettingsDialog, openShareDialog } from './dialogs';
import { clearOf } from './layout';
import { ICONS, createToast, deviceEnv, el } from './dom';
import { MOVE_LABELS, WALK_EYE, WALK_PITCH, WALK_SPEED, fmtSpeedMult, stepSpeed, walkY } from './flight';
import type { MoveMode } from './flight';
import { createHostFactory } from './host';
import { createHud } from './hud';
import { createFeatureRegistry } from './registry';
import { createSources } from './sources';
import { DEFAULT_TIER, TIER_LABELS, loadTier, saveTier, tierFromQuery } from './tiers';
import type { Tier } from './tiers';
import type { FeatureHost, Handle, LoadingHandle, PromptOptions, ShellAnchor, ShellApi, ShellServices } from './types';
import '../ui/features.css';
import '../ui/polish.css';
import './shell.css';

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

export interface ShellDeps {
  settings: SettingsRuntime;
  kv: KeyValueStore | null;
  /** Re-applies the renderer size after a pixel-ratio change. */
  resize(): void;
  /** Streaming progress of the initial load (HUD „Lade Details …“). */
  loadProgress(): { progress: LoadProgressLike | null; done: boolean };
  /** AOI name + fixture fallback note (Quellen dialog). */
  areaNote: string;
}

const SHELL_KEY = 'sle.shell.v1';
const TUTORIAL_KEY = 'sle.tutorial.v1';
type DrawerId = 'places' | 'tools';

export function createShell(ctx: AppContext, deps: ShellDeps): ShellApi {
  const { store, terrain, renderer, controller } = ctx;
  const { settings, kv } = deps;
  const app = document.querySelector<HTMLElement>('#app')!;
  const viewport = document.querySelector<HTMLElement>('#viewport')!;
  const env = deviceEnv();
  document.documentElement.classList.toggle('sle-touch', env.coarse);
  installA11y(app);
  watchContextLoss(renderer.domElement); // F20: phones in the background → message + reload

  // ---- layout -----------------------------------------------------------------------------------
  const ui = el('div', { id: 'sle-shell' });
  const hudEl = el('div', { id: 'hud', 'aria-live': 'off' });
  const hudExtra = el('div', { class: 'hud-extra' });
  const minimapSlot = el('div', { id: 'minimap', 'data-shell-anchor': 'minimap' });
  const overlaySlot = el('div', { class: 'sle-overlay-slot' });
  const featOverlay = el('div', { class: 'sle-feat-overlays' });
  const tutorialSlot = el('div', { class: 'sle-tutorial-slot' });
  const placesSlot = el('div', { class: 'sle-drawer-body' });
  const panelSlot = el('div', { id: 'panel', class: 'sle-drawer-body' });
  const toolsSlot = el('div', { class: 'sle-tools', role: 'toolbar', 'aria-label': 'Werkzeuge' });
  const settingsSlot = el('div', { class: 'sle-feature-settings' });
  const lensSlot = el('div', { class: 'sle-lens-slot', 'data-shell-anchor': 'lens' });

  const drawer = (id: DrawerId, title: string, body: HTMLElement) => {
    const close = el('button', { type: 'button', class: 'sle-dlg-close', 'aria-label': `${title} schließen`, title: 'Schließen (Esc)', html: ICONS.close });
    const aside = el(
      'aside',
      { id: `sle-drawer-${id}`, class: 'sle-drawer', 'aria-label': title },
      el('header', { class: 'sle-drawer-head' }, el('h2', { text: title }), close),
      body,
    );
    aside.hidden = true;
    close.addEventListener('click', () => setDrawer(null));
    return aside;
  };
  const drawers: Record<DrawerId, HTMLElement> = {
    places: drawer('places', 'Orte', placesSlot),
    tools: drawer('tools', 'Werkzeuge', panelSlot),
  };

  const barBtn = (anchor: ShellAnchor, icon: string, label: string, title: string) =>
    el('button', { type: 'button', class: 'sle-bar-btn', 'data-shell-anchor': anchor, title, 'aria-label': label, html: `${icon}<span class="sle-bar-label">${label}</span>` });
  const moveBtn = barBtn('move-mode', ICONS.fly, 'Fliegen', 'Fliegen / Gehen umschalten');
  moveBtn.setAttribute('aria-pressed', 'false');
  const slower = el('button', { type: 'button', class: 'sle-bar-btn sle-bar-mini', title: 'Langsamer (−)', 'aria-label': 'Langsamer', html: ICONS.minus });
  const faster = el('button', { type: 'button', class: 'sle-bar-btn sle-bar-mini', title: 'Schneller (+)', 'aria-label': 'Schneller', html: ICONS.plus });
  const speedVal = el('span', { class: 'sle-speed-val', 'aria-live': 'polite' });
  const speedGroup = el('div', { class: 'sle-speed', role: 'group', 'aria-label': 'Tempo', 'data-shell-anchor': 'speed' }, slower, speedVal, faster);
  const placesBtn = barBtn('places', ICONS.places, 'Orte', 'Bekannte Orte in der Nähe');
  const shareBtn = barBtn('share', ICONS.share, 'Teilen', 'Ansicht teilen (Link, QR-Code)');
  // System buttons: icon-only, top-right under the minimap (game-style), not in the action bar.
  const sysBtn = (anchor: ShellAnchor, icon: string, label: string, title: string) =>
    el('button', { type: 'button', class: 'sle-sys-btn', 'data-shell-anchor': anchor, title, 'aria-label': label, html: icon });
  const keysBtn = sysBtn('keys', ICONS.keys, 'Steuerung', 'Steuerung: alle Tasten und Gesten (?)');
  const settingsBtn = sysBtn('settings', ICONS.settings, 'Einstellungen', 'Einstellungen und Stufe');
  const toolsBtn = barBtn('tools', ICONS.tools, 'Werkzeuge', 'Werkzeuge der Stufen Entdecker und Labor');
  for (const [b, id] of [
    [placesBtn, 'places'],
    [toolsBtn, 'tools'],
  ] as const) {
    b.setAttribute('aria-controls', `sle-drawer-${id}`);
    b.setAttribute('aria-expanded', 'false');
  }
  shareBtn.setAttribute('aria-haspopup', 'dialog');
  keysBtn.setAttribute('aria-haspopup', 'dialog');
  settingsBtn.setAttribute('aria-haspopup', 'dialog');
  const bar = el('nav', { class: 'sle-bar', 'aria-label': 'Steuerleiste' }, moveBtn, speedGroup, placesBtn, lensSlot, shareBtn);
  const sys = el('div', { class: 'sle-sys', role: 'group', 'aria-label': 'System' }, keysBtn, settingsBtn);
  const tierChip = el('span', { class: 'sle-tier-chip' });

  const bottom = el('div', { class: 'sle-bottom' }, toolsSlot, bar);
  const corner = el('div', { class: 'sle-corner' });
  ui.append(hudEl, minimapSlot, sys, featOverlay, drawers.places, drawers.tools, bottom, corner, overlaySlot, tutorialSlot);
  app.appendChild(ui);
  const toast = createToast(ui);

  // ---- settings mirroring (store → localStorage, debounced) ----------------------------------------
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

  // ---- services (core, all tiers) ------------------------------------------------------------------
  const services: ShellServices = {
    labels: new Labels3D(viewport, ctx.camera, terrain, ctx.manifest.origin),
    markers: null,
    minimap: null,
    toast,
  };

  // ---- quality (auto in Standard; the Entdecker control lives in builtins) ---------------------------
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
      labels: services.labels,
      buildings: b ? { opts: b.opts, fade: fade ?? undefined } : null,
      pointClouds: window.slePointClouds ?? null,
    };
  };
  const startQuality = autoQuality(settings.get(), env); // phones start on „Mobil“ until a pick
  let quality: QualityLevel = startQuality.level;
  applyQuality(quality, targets(), startQuality.auto);
  window.addEventListener('resize', () => {
    const t = targets();
    t.setPixelRatio(pixelRatioFor(quality, t.devicePixelRatio));
  });

  // ---- move mode + speed -------------------------------------------------------------------------------
  let moveMode: MoveMode = 'fly';
  let flyClearance = controller.opts.minClearance;
  let flyMult = controller.speedMultiplier;
  const syncMove = () => {
    const walk = moveMode === 'walk';
    moveBtn.innerHTML = `${walk ? ICONS.walk : ICONS.fly}<span class="sle-bar-label">${MOVE_LABELS[moveMode]}</span>`;
    moveBtn.setAttribute('aria-pressed', String(walk));
    moveBtn.setAttribute('aria-label', `Gehen (${walk ? 'an' : 'aus'})`);
    moveBtn.title = walk ? 'Gehen – umschalten auf Fliegen' : 'Fliegen – umschalten auf Gehen';
  };
  const setMoveMode = (m: MoveMode) => {
    if (m === moveMode) return;
    moveMode = m;
    if (m === 'walk') {
      flyClearance = controller.opts.minClearance;
      flyMult = controller.speedMultiplier;
      controller.cancelTween();
      controller.opts.minClearance = WALK_EYE;
      controller.speedMultiplier = WALK_SPEED;
      const p = controller.position;
      controller.setPose({ y: walkY(terrain.collisionGround.surfaceY(p.x, p.z), p.y), pitch: WALK_PITCH });
    } else {
      controller.opts.minClearance = flyClearance;
      controller.speedMultiplier = flyMult;
      controller.setPose({ y: controller.position.y + 40 }); // lift off so the view opens up
    }
    syncMove();
    syncSpeed();
  };
  ctx.onFrame(() => {
    if (moveMode !== 'walk') return;
    if (controller.flying) {
      setMoveMode('fly'); // a flight to a place (Orte, Karte) takes off
      return;
    }
    const p = controller.position;
    p.y = walkY(terrain.collisionGround.surfaceY(p.x, p.z), p.y);
  });
  moveBtn.addEventListener('click', () => setMoveMode(moveMode === 'fly' ? 'walk' : 'fly'));
  let lastMult = NaN;
  const syncSpeed = () => {
    const m = controller.speedMultiplier;
    if (m === lastMult) return;
    lastMult = m;
    speedVal.textContent = fmtSpeedMult(m);
  };
  slower.addEventListener('click', () => {
    controller.speedMultiplier = stepSpeed(controller.speedMultiplier, -1);
    syncSpeed();
  });
  faster.addEventListener('click', () => {
    controller.speedMultiplier = stepSpeed(controller.speedMultiplier, 1);
    syncSpeed();
  });
  setInterval(syncSpeed, 250); // wheel / keys change it too
  syncMove();
  syncSpeed();

  // ---- drawers ---------------------------------------------------------------------------------------
  let openDrawer: DrawerId | null = null;
  const drawerBtns: Record<DrawerId, HTMLButtonElement> = { places: placesBtn, tools: toolsBtn };
  const setDrawer = (id: DrawerId | null, focus = true) => {
    openDrawer = id;
    for (const k of Object.keys(drawers) as DrawerId[]) {
      const on = k === id;
      drawers[k].hidden = !on;
      drawerBtns[k].setAttribute('aria-expanded', String(on));
      drawerBtns[k].classList.toggle('on', on);
    }
    try {
      kv?.setItem(SHELL_KEY, JSON.stringify({ drawer: id }));
    } catch {
      /* ignore */
    }
    if (id && focus) drawers[id].querySelector<HTMLElement>('.sle-drawer-body button, .sle-drawer-body input, .sle-dlg-close')?.focus({ preventScroll: true });
  };
  placesBtn.addEventListener('click', () => setDrawer(openDrawer === 'places' ? null : 'places'));
  toolsBtn.addEventListener('click', () => setDrawer(openDrawer === 'tools' ? null : 'tools'));
  // „Werkzeuge“ exists only while a mounted feature has panel content (Entdecker / Labor).
  const syncToolsBtn = () => {
    const has = [...panelSlot.children].some((c) => c.childElementCount > 0);
    if (has && !toolsBtn.isConnected) bar.insertBefore(toolsBtn, shareBtn);
    if (!has && toolsBtn.isConnected) {
      if (openDrawer === 'tools') setDrawer(null, false);
      toolsBtn.remove();
    }
  };
  new MutationObserver(syncToolsBtn).observe(panelSlot, { childList: true, subtree: true });

  // ---- registry -------------------------------------------------------------------------------------
  const queryTier = tierFromQuery(location.search);
  const extraShortcuts: Shortcut[] = [];
  let api!: ShellApi;
  let reloading = false;
  const tierListeners = new Set<(t: Tier, source: string) => void>();
  const registry = createFeatureRegistry<FeatureHost>({
    tier: queryTier ?? loadTier(kv) ?? DEFAULT_TIER,
    makeHost: createHostFactory(ctx, () => api, services, {
      panel: panelSlot,
      tools: toolsSlot,
      places: placesSlot,
      hud: hudExtra,
      settings: settingsSlot,
      overlay: featOverlay,
    }),
    onReloadNeeded: (ids) => {
      if (reloading) return;
      reloading = true;
      toast(`Stufe ${TIER_LABELS[registry.tier()]}: wird neu geladen …`, false, 4000);
      console.info('[shell] reload to unmount', ids);
      setTimeout(() => location.reload(), 300);
    },
  });
  const syncTierChip = () => {
    const t = registry.tier();
    tierChip.textContent = t === 'standard' ? '' : TIER_LABELS[t];
    tierChip.hidden = t === 'standard';
    document.documentElement.dataset.tier = t;
  };

  const setTier = (t: Tier, source = 'user') => {
    if (t === registry.tier()) return;
    saveTier(kv, t);
    if (queryTier) {
      // The user's pick wins from now on: drop ?tier= so a reload keeps it.
      const u = new URL(location.href);
      u.searchParams.delete('tier');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
    registry.setTier(t);
    syncTierChip();
    for (const cb of tierListeners) cb(t, source);
    if (!reloading) toast(`Stufe: ${TIER_LABELS[t]}`);
  };

  // ---- „© Quellen“ (ADR 0026) --------------------------------------------------------------------------
  const sources = createSources({
    parent: corner,
    attribution: ctx.manifest.attribution,
    areaNote: deps.areaNote,
    interactionTarget: renderer.domElement,
  });

  // ---- dialogs ------------------------------------------------------------------------------------------
  let tutorialStart: (() => void) | null = null; // V2.9: „Einführung starten“ in *Steuerung*
  const openKeys = () =>
    openKeysDialog((id) => registry.isMounted(id), [...extraShortcuts, ...registry.defs().filter((d) => registry.isMounted(d.id)).flatMap((d) => d.shortcuts ?? [])], env.coarse, tutorialStart);
  const reset = () => {
    resetting = true;
    settings.freeze();
    clearTimeout(saveTimer);
    resetSettings(kv);
    history.replaceState(null, '', `${location.pathname}${poseOnlyHash(location.hash)}`);
    location.reload();
  };
  const openSettings = () =>
    openSettingsDialog({
      tier: () => registry.tier(),
      setTier: (t) => setTier(t, 'settings'),
      featureSlot: settingsSlot,
      openKeys,
      openSources: sources.open,
      reset,
    });
  shareBtn.addEventListener('click', () => openShareDialog(ctx, toast));
  keysBtn.addEventListener('click', openKeys);
  settingsBtn.addEventListener('click', openSettings);

  // `?` (Shift+ß / Shift+/): capture phase so the speed keys on the same physical key don't fire.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || modalOpen(e.target)) return;
      if (e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        openKeys();
      } else if (e.key === 'Escape' && openDrawer && drawers[openDrawer].contains(document.activeElement)) {
        setDrawer(null, false);
        drawerBtns[openDrawer ?? 'places']?.focus({ preventScroll: true });
      }
    },
    true,
  );

  // ---- V2.6 prompt + loading screen, V2.9 tutorial ---------------------------------------------------------
  let promptEl: HTMLElement | null = null;
  const prompt = (o: PromptOptions): Handle => {
    promptEl?.remove();
    const btn = el('button', { type: 'button', class: 'sle-btn primary', text: o.action });
    if (o.keyHint) btn.append(' ', el('kbd', { text: o.keyHint }));
    btn.addEventListener('click', () => o.onAction());
    const box = el('div', { class: 'sle-prompt', role: 'status' }, el('span', { text: o.text }), btn);
    promptEl = box;
    overlaySlot.appendChild(box);
    // ADR 0026: the splash + „© Quellen“ corner is never covered. On phones the prompt spans the width, so
    // lift it above the corner, and re-place it when the splash collapses or the viewport changes.
    const place = () => {
      box.style.bottom = '';
      const lift = clearOf(box.getBoundingClientRect(), corner.getBoundingClientRect(), window.innerHeight);
      if (lift) box.style.bottom = `${lift.bottom}px`;
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    ro?.observe(corner);
    window.addEventListener('resize', place);
    return {
      close: () => {
        ro?.disconnect();
        window.removeEventListener('resize', place);
        box.remove();
        if (promptEl === box) promptEl = null;
      },
    };
  };
  const loading = (title: string): LoadingHandle => {
    const fill = el('div', { class: 'sle-load-fill' });
    const text = el('p', { class: 'sle-load-text', role: 'status' });
    const track = el('div', { class: 'sle-load-track', role: 'progressbar', 'aria-label': title, 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
    const screen = el('div', { class: 'sle-loading-screen' }, el('h2', { text: title }), track, text);
    overlaySlot.appendChild(screen);
    const progress = (p: number | null, t?: string) => {
      track.classList.toggle('indeterminate', p === null);
      if (p !== null) {
        const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
        fill.style.width = `${pct}%`;
        track.setAttribute('aria-valuenow', String(pct));
      } else track.removeAttribute('aria-valuenow');
      if (t !== undefined) text.textContent = t;
    };
    progress(null);
    return { progress, close: () => screen.remove() };
  };
  const firstRun = () => {
    try {
      return kv?.getItem(TUTORIAL_KEY) !== 'done';
    } catch {
      return true;
    }
  };

  api = {
    tier: () => registry.tier(),
    quality: () => quality,
    setTier,
    onTier(cb) {
      tierListeners.add(cb);
      return () => tierListeners.delete(cb);
    },
    registerFeature: (def) => registry.register(def),
    isMounted: (id) => registry.isMounted(id),
    slots: { minimap: minimapSlot, lens: lensSlot, overlay: overlaySlot, tutorial: tutorialSlot },
    services,
    anchor: (id) => ui.querySelector<HTMLElement>(`[data-shell-anchor="${id}"]`),
    moveMode: () => moveMode,
    setMoveMode,
    toast,
    openDialog,
    openKeys,
    openSettings,
    openSources: sources.open,
    prompt,
    loading,
    firstRun,
    markTutorialDone() {
      try {
        kv?.setItem(TUTORIAL_KEY, 'done');
      } catch {
        /* ignore */
      }
    },
    setTutorialStart(fn) {
      tutorialStart = fn;
      return () => {
        if (tutorialStart === fn) tutorialStart = null;
      };
    },
    mountTutorial(fn) {
      const layer = el('div', { class: 'sle-tutorial' });
      tutorialSlot.appendChild(layer);
      const un = fn(layer, api);
      return () => {
        if (typeof un === 'function') un();
        layer.remove();
      };
    },
  };

  // ---- built-in features (v1 modules sorted into tiers) ----------------------------------------------------
  registerBuiltins(api, {
    ctx,
    services,
    settings,
    quality: {
      get: () => quality,
      set: (q) => {
        quality = q;
        settings.patch({ quality: q, qualityPicked: true });
        applyQuality(q, targets(), true);
      },
    },
    hudPending: () => {
      const lp = deps.loadProgress();
      return Math.max(progressPending(lp.progress, lp.done), terrainPending(terrain) ?? 0);
    },
  });
  registry.start();
  syncTierChip();
  syncToolsBtn();

  createHud(hudEl, {
    store,
    mode: () => moveMode,
    extra: hudExtra,
    pending: () => {
      const lp = deps.loadProgress();
      return Math.max(progressPending(lp.progress, lp.done), terrainPending(terrain) ?? 0);
    },
  });
  hudEl.append(tierChip);
  // Desktop drawers start below the HUD, whose height grows with the Labor rows.
  const syncHudH = () => ui.style.setProperty('--hud-h', `${Math.ceil(hudEl.getBoundingClientRect().height)}px`);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncHudH).observe(hudEl);
  syncHudH();
  // System buttons sit under the minimap dial; its height varies (phone dial, hidden map). Full-screen map keeps the last value.
  const syncMapH = () => {
    if (minimapSlot.classList.contains('gmm-full') || minimapSlot.classList.contains('size-full')) return;
    ui.style.setProperty('--mm-h', `${Math.ceil(minimapSlot.getBoundingClientRect().height)}px`);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncMapH).observe(minimapSlot);
  syncMapH();

  // Restore the last open drawer on large screens (phones start with a free view).
  try {
    const last = JSON.parse(kv?.getItem(SHELL_KEY) ?? '{}') as { drawer?: DrawerId | null };
    if (last.drawer && window.innerWidth > 900 && drawers[last.drawer]) {
      if (last.drawer === 'places' || toolsBtn.isConnected) setDrawer(last.drawer, false);
    }
  } catch {
    /* ignore */
  }
  return api;
}
