/**
 * Relief lab panel ("Darstellung"): mode switcher (keys 1–9, 0), legend, blend presets,
 * contrast/gamma + automatic percentile stretch, overlay channel, sun, forest (canopy), exaggeration,
 * image layers ("Bilder": orthophoto / historic maps, F13/F14) with an image ↔ relief slider.
 * Lives at the top of #panel as its own lil-gui root with custom DOM for buttons and legend.
 */
import GUI from 'lil-gui';
import type { Controller } from 'lil-gui';
import type { PerspectiveCamera, WebGLRenderer } from 'three';
import type { AppState, Store } from '../state';
import { presetOverrides } from '../state';
import type { ForestMode, Terrain, ValueScope } from '../terrain/Terrain';
import {
  BLEND_LABELS,
  Colormap,
  COLORMAP_LABELS,
  IMAGE_PRESETS,
  legendGradient,
  mixTexts,
  mixToOpacity,
  opacityToMix,
  percentileStretch,
  PRESETS,
  sourceRange,
} from '../terrain/relief';
import type { BlendMode, ModeEntry, Preset, Stretch } from '../terrain/relief';
import { isTyping } from './keys';
import './relief.css';

export interface ReliefPanelContext {
  container: HTMLElement;
  hud: HTMLElement;
  store: Store<AppState>;
  terrain: Terrain;
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
}

const FOREST_LABELS: Record<ForestMode, string> = { off: 'Aus', transparent: 'Transparent', full: 'Voll' };
const FOREST_CYCLE: ForestMode[] = ['off', 'transparent', 'full'];


const fmtNum = (v: number) => {
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return v.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d });
};

function invert<T extends string | number>(labels: Record<T, string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(labels) as Array<[string, string]>) out[v] = (isNaN(Number(k)) ? k : Number(k)) as T;
  return out;
}

export interface ReliefPanelApi {
  gui: GUI;
  /** Apply a blend preset by id (Tour); false when this AOI lacks its layers. */
  applyPresetById(id: string, announce?: boolean): boolean;
  /** F20 "Relief" button: whether this AOI has a preset's layers. */
  hasPreset(id: string): boolean;
  /** F20: select a single relief layer (no blend preset, overlay off); false if unknown here. */
  showMode(key: string): boolean;
  /** Active blend preset id ('' = none). */
  activePresetId(): string;
}

export function createReliefPanel(ctx: ReliefPanelContext): ReliefPanelApi {
  const { store, terrain, renderer, camera } = ctx;
  const u = terrain.uniforms;
  const modes = terrain.modes();
  const images = terrain.imageModes();
  const modeByKey = new Map([...modes, ...images].map((m) => [m.key, m]));
  terrain.imageAnisotropy = renderer.capabilities.getMaxAnisotropy();
  terrain.renderer = renderer; // GPU apron patches for image layers (seam fix)

  const gui = new GUI({ container: ctx.container, title: 'Darstellung' });
  gui.domElement.classList.add('sle-relief');
  ctx.container.prepend(gui.domElement);

  // ---- custom DOM: modes, legend, presets ------------------------------------------------------
  const top = document.createElement('div');
  top.className = 'rl-top';
  top.innerHTML = `
    <div class="rl-modes" role="radiogroup" aria-label="Darstellung"></div>
    <div class="rl-images-wrap" hidden>
      <div class="rl-section-label">Bilder</div>
      <div class="rl-modes rl-images" role="radiogroup" aria-label="Bilder"></div>
    </div>
    <div class="rl-legend">
      <div class="rl-legend-title"></div>
      <div class="rl-bar"></div>
      <div class="rl-ticks"><span data-t="lo"></span><span data-t="mid"></span><span data-t="hi"></span></div>
      <div class="rl-ovl-legend" hidden>
        <div class="rl-legend-title"></div>
        <div class="rl-bar"></div>
        <div class="rl-ticks"><span data-t="lo"></span><span data-t="mid"></span><span data-t="hi"></span></div>
      </div>
      <p class="rl-hint"></p>
    </div>
    <label class="rl-mix" hidden>
      <span class="rl-mix-label"></span>
      <input type="range" min="0" max="1" step="0.01" aria-label="Bild ↔ Relief">
      <span class="rl-mix-ends"><span data-end="img"></span><span data-end="relief">Relief</span></span>
    </label>
    <div class="rl-section-label">Kombinationen <span class="rl-dim"></span></div>
    <div class="rl-presets"></div>
    <div class="rl-actions">
      <button type="button" data-act="auto" title="Perzentil-Streckung (2–98 %) über den gewählten Bereich · Taste K">Kontrast automatisch <kbd>K</kbd></button>
      <button type="button" data-act="reset" title="Farbskala und Bereich auf Standard">Zurücksetzen</button>
    </div>`;
  gui.$children.prepend(top);
  const modeBox = top.querySelector<HTMLElement>('.rl-modes')!;
  const presetBox = top.querySelector<HTMLElement>('.rl-presets')!;
  const legend = top.querySelector<HTMLElement>('.rl-legend')!;
  const ovlLegend = top.querySelector<HTMLElement>('.rl-ovl-legend')!;
  const hint = top.querySelector<HTMLElement>('.rl-hint')!;
  const imageBox = top.querySelector<HTMLElement>('.rl-images')!;
  const mixBox = top.querySelector<HTMLElement>('.rl-mix')!;
  const mixInput = mixBox.querySelector<HTMLInputElement>('input')!;
  top.querySelector<HTMLElement>('.rl-images-wrap')!.hidden = images.length === 0;

  const modeButton = (m: ModeEntry, box: HTMLElement) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = m.key;
    b.setAttribute('role', 'radio');
    b.title = m.shortcut ? `${terrain.labelFor(m.key)} · Taste ${m.shortcut}` : terrain.labelFor(m.key);
    b.innerHTML = m.shortcut ? `<kbd>${m.shortcut}</kbd><span></span>` : '<span></span>';
    b.querySelector('span')!.textContent = m.label;
    b.addEventListener('click', () => selectMode(m.key));
    box.appendChild(b);
  };
  for (const m of modes) modeButton(m, modeBox);
  for (const m of images) modeButton(m, imageBox);
  const usablePresets = [...PRESETS, ...IMAGE_PRESETS].filter(
    (p) => terrain.isValidDisplay(p.base) && (!p.overlay || terrain.isValidDisplay(p.overlay.key)),
  );
  top.querySelector<HTMLElement>('.rl-section-label .rl-dim')!.textContent =
    usablePresets.length ? `(Umschalt + 1–${usablePresets.length})` : '';
  usablePresets.forEach((p, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.preset = p.id;
    b.title = `${p.hint} · Umschalt + ${k + 1}`;
    b.textContent = p.label;
    b.addEventListener('click', () => applyPreset(p));
    presetBox.appendChild(b);
  });
  top.querySelector('[data-act="auto"]')!.addEventListener('click', () => void autoContrast());
  top.querySelector('[data-act="reset"]')!.addEventListener('click', () => resetContrast());

  // ---- lil-gui parameters --------------------------------------------------------------------
  const s0 = store.get();
  const blendNames = invert(BLEND_LABELS);
  const cmapNames = invert(COLORMAP_LABELS);
  const overlayOptions: Record<string, string> = { Aus: '' };
  for (const m of modes) overlayOptions[`${m.shortcut} · ${terrain.labelFor(m.key)}`] = m.key;
  for (const m of images) overlayOptions[`Bild · ${terrain.labelFor(m.key)}`] = m.key;

  const p = {
    colormap: Colormap.Gray as number,
    lo: 0,
    hi: 1,
    gamma: 1,
    shade: 0.5,
    autoScope: 'view' as ValueScope,
    autoClip: 2,
    autoFollow: false,
    lrmRadius: terrain.getLowpassRadius(),
    ovlKey: '',
    ovlOpacity: 0.5,
    ovlBlend: 1 as number,
    ovlColormap: Colormap.Diverging as number,
    ovlLo: -1,
    ovlHi: 1,
    ovlGamma: 1,
    ovlShade: 0,
    sunAzimuth: s0.sunAzimuth,
    sunElevation: s0.sunElevation,
    sunDirections: s0.sunDirections,
    shadeZ: u.uShadeZ.value,
    forestMode: terrain.forest.mode as ForestMode,
    forestOpacity: terrain.forest.opacity,
    canopyMin: u.uCanopyMin.value,
    exaggeration: s0.exaggeration,
  };

  // Contrast / colour
  const fCon = gui.addFolder('Kontrast & Farbe');
  const cCmap = fCon.add(p, 'colormap', cmapNames).name('Farbskala').onChange(() => pushBase());
  const cLo = fCon.add(p, 'lo', 0, 1).name('Untergrenze').onChange(() => pushBase());
  const cHi = fCon.add(p, 'hi', 0, 1).name('Obergrenze').onChange(() => pushBase());
  const cGamma = fCon.add(p, 'gamma', 0.3, 3, 0.05).name('Gamma').onChange(() => pushBase());
  fCon.add(p, 'shade', 0, 1, 0.05).name('Schummerung in Farbe').onChange(() => pushBase());
  fCon.add(p, 'autoScope', { Sichtbereich: 'view', Gesamtgebiet: 'aoi' }).name('Auto: Bereich');
  fCon.add(p, 'autoClip', 0, 10, 0.5).name('Auto: abschneiden (%)');
  fCon.add(p, 'autoFollow').name('Auto: laufend nachführen').onChange((v: boolean) => {
    if (v) void autoContrast();
  });
  const cRadius = fCon
    .add(p, 'lrmRadius', 2, 60, 1)
    .name('Relief-Radius (m)')
    .onFinishChange((v: number) => terrain.setLowpassRadius(v));

  // Overlay
  const fOvl = gui.addFolder('Überlagerung  (B)');
  fOvl.add(p, 'ovlKey', overlayOptions).name('Ebene').onChange((v: string) => {
    setActivePreset('');
    terrain.setOverlay({ key: v });
    if (v) lastOverlay = v;
  });
  fOvl.add(p, 'ovlOpacity', 0, 1, 0.05).name('Deckkraft').onChange(() => pushOverlay());
  fOvl.add(p, 'ovlBlend', blendNames).name('Mischmodus').onChange(() => pushOverlay());
  const cOCmap = fOvl.add(p, 'ovlColormap', cmapNames).name('Farbskala').onChange(() => pushOverlay());
  const cOLo = fOvl.add(p, 'ovlLo', -1, 1).name('Untergrenze').onChange(() => pushOverlay());
  const cOHi = fOvl.add(p, 'ovlHi', -1, 1).name('Obergrenze').onChange(() => pushOverlay());
  const cOGamma = fOvl.add(p, 'ovlGamma', 0.3, 3, 0.05).name('Gamma').onChange(() => pushOverlay());
  fOvl.add(p, 'ovlShade', 0, 1, 0.05).name('Schummerung in Farbe').onChange(() => pushOverlay());

  // Sun
  const fSun = gui.addFolder('Sonne / Schummerung');
  fSun.add(p, 'sunAzimuth', 0, 360, 1).name('Azimut (°)').onChange((v: number) => store.set({ sunAzimuth: v }, 'gui'));
  fSun.add(p, 'sunElevation', 1, 90, 1).name('Höhe (°)').onChange((v: number) => store.set({ sunElevation: v }, 'gui'));
  fSun.add(p, 'sunDirections', 1, 16, 1).name('Richtungen').onChange((v: number) => store.set({ sunDirections: v }, 'gui'));
  fSun.add(p, 'shadeZ', 0.5, 10, 0.1).name('Relief-Kontrast').onChange((v: number) => (u.uShadeZ.value = v));

  // Forest
  const fFor = gui.addFolder('Wald / Kronendach  (V)');
  const hasDsm = terrain.hasCanopyData();
  const cForest = fFor
    .add(p, 'forestMode', invert(FOREST_LABELS))
    .name('Anzeige')
    .onChange((v: ForestMode) => terrain.setForest({ mode: v }));
  const cForOp = fFor
    .add(p, 'forestOpacity', 0.05, 1, 0.05)
    .name('Deckkraft (transparent)')
    .onChange((v: number) => terrain.setForest({ opacity: v }));
  fFor.add(p, 'canopyMin', 0.5, 10, 0.5).name('Mindesthöhe (m)').onChange((v: number) => (u.uCanopyMin.value = v));
  if (!hasDsm) {
    for (const c of fFor.controllers) c.disable();
    fFor.title('Wald / Kronendach (kein DOM im Datensatz)');
  }

  // Terrain
  const fTer = gui.addFolder('Gelände');
  fTer.add(p, 'exaggeration', 1, 5, 0.1).name('Überhöhung (×)').onChange((v: number) => store.set({ exaggeration: v }, 'gui'));

  fOvl.close();
  fSun.close();
  fCon.close();

  // ---- state ↔ terrain ---------------------------------------------------------------------------
  let lastOverlay = 'slrm';
  let syncing = false;

  function setBounds(c: Controller, r: { min: number; max: number }) {
    const span = r.max - r.min;
    (c as unknown as { min(v: number): void; max(v: number): void; step(v: number): void }).min(r.min);
    (c as unknown as { max(v: number): void }).max(r.max);
    (c as unknown as { step(v: number): void }).step(span / 400);
  }

  function pushBase() {
    if (syncing) return;
    setActivePreset('');
    const ch = terrain.channel(terrain.getDisplay());
    ch.colormap = p.colormap as Colormap;
    ch.stretch = { lo: Math.min(p.lo, p.hi - 1e-6), hi: Math.max(p.hi, p.lo + 1e-6), gamma: p.gamma };
    ch.shade = p.shade;
    terrain.applyChannels();
  }

  function pushOverlay() {
    if (syncing) return;
    setActivePreset('');
    terrain.setOverlay({
      opacity: p.ovlOpacity,
      blend: p.ovlBlend as BlendMode,
      colormap: p.ovlColormap as Colormap,
      stretch: { lo: Math.min(p.ovlLo, p.ovlHi - 1e-6), hi: Math.max(p.ovlHi, p.ovlLo + 1e-6), gamma: p.ovlGamma },
      shade: p.ovlShade,
    });
  }

  const rangeOf = (key: string) => sourceRange(key, terrain.manifest.layers[key]);

  function paintLegend(el: HTMLElement, key: string, cmap: Colormap, st: Stretch, prefix = '') {
    const img = terrain.isImageKey(key);
    el.querySelector<HTMLElement>('.rl-bar')!.hidden = img;
    el.querySelector<HTMLElement>('.rl-ticks')!.hidden = img;
    if (img) {
      el.querySelector('.rl-legend-title')!.textContent = `${prefix}${terrain.labelFor(key)} (Farbbild)`;
      return;
    }
    const r = rangeOf(key);
    el.querySelector('.rl-legend-title')!.textContent = `${prefix}${terrain.labelFor(key)}${r.unit ? ` (${r.unit})` : ''}`;
    el.querySelector<HTMLElement>('.rl-bar')!.style.background = legendGradient(st, cmap);
    const t = (k: string) => el.querySelector<HTMLElement>(`[data-t="${k}"]`)!;
    if (cmap === Colormap.Mask) {
      t('lo').textContent = 'LVGL 2025';
      t('mid').textContent = 'RLP 2022';
      t('hi').textContent = 'interpoliert';
      return;
    }
    t('lo').textContent = fmtNum(st.lo);
    t('hi').textContent = fmtNum(st.hi);
    const div = cmap === Colormap.Diverging && st.lo < 0 && st.hi > 0;
    t('mid').textContent = div ? 'Senke ← 0 → Erhebung' : st.gamma !== 1 ? `γ ${fmtNum(st.gamma)}` : '';
  }

  /** Pull terrain state into the controls / DOM (no feedback into terrain). */
  function sync() {
    syncing = true;
    const key = terrain.getDisplay();
    const ch = terrain.channel(key);
    const r = rangeOf(key);
    setBounds(cLo, r);
    setBounds(cHi, r);
    p.colormap = ch.colormap;
    p.lo = ch.stretch.lo;
    p.hi = ch.stretch.hi;
    p.gamma = ch.stretch.gamma;
    p.shade = ch.shade;
    const o = terrain.getOverlay();
    p.ovlKey = o.key;
    p.ovlOpacity = o.opacity;
    p.ovlBlend = o.blend;
    p.ovlColormap = o.colormap;
    p.ovlLo = o.stretch.lo;
    p.ovlHi = o.stretch.hi;
    p.ovlGamma = o.stretch.gamma;
    p.ovlShade = o.shade;
    if (o.key) {
      const orr = rangeOf(o.key);
      setBounds(cOLo, orr);
      setBounds(cOHi, orr);
    }
    const baseImg = terrain.isImageKey(key);
    const ovlImg = terrain.isImageKey(o.key);
    for (const c of [cCmap, cLo, cHi, cGamma]) c.enable(!baseImg);
    for (const c of [cOCmap, cOLo, cOHi, cOGamma]) c.enable(!!o.key && !ovlImg);
    cRadius.show(key === 'live-lrm' || o.key === 'live-lrm');
    p.forestMode = terrain.forest.mode;
    p.forestOpacity = terrain.forest.opacity;
    cForOp.enable(hasDsm && terrain.forest.mode === 'transparent');
    const st = store.get();
    p.sunAzimuth = st.sunAzimuth;
    p.sunElevation = st.sunElevation;
    p.sunDirections = st.sunDirections;
    p.exaggeration = st.exaggeration;
    for (const c of gui.controllersRecursive()) c.updateDisplay();
    syncing = false;

    for (const b of modeBox.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.key === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
    for (const b of presetBox.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('active', b.dataset.preset === activePreset);
    paintLegend(legend, key, ch.colormap, ch.stretch);
    ovlLegend.hidden = !o.key;
    if (o.key) paintLegend(ovlLegend, o.key, o.colormap, o.stretch, `+ ${BLEND_LABELS[o.blend]} ${Math.round(o.opacity * 100)} %: `);
    for (const b of imageBox.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.key === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
    const m = modeByKey.get(key);
    const ip = activePresetDef()?.mixLabel ? activePresetDef() : undefined; // image presets explain the slider
    hint.textContent = (ip?.hint ?? m?.hint) ?? terrain.manifest.layers[key]?.description ?? '';
    syncMix(key, o.key, o.opacity);
    cForest.updateDisplay();
  }

  const activePresetDef = () => usablePresets.find((pr) => pr.id === activePreset);

  /** Which channel holds the image while the other one holds relief (null: no image ↔ relief mix). */
  function imageRole(base: string, ovl: string): 'base' | 'overlay' | null {
    if (!ovl) return null;
    if (terrain.isImageKey(ovl)) return 'overlay';
    if (terrain.isImageKey(base)) return 'base';
    return null;
  }

  /** Image ↔ relief slider: visible while an image is mixed with relief; drives the overlay opacity. */
  function syncMix(base: string, ovl: string, opacity: number) {
    const role = imageRole(base, ovl);
    mixBox.hidden = role === null;
    if (role === null) return;
    const imgKey = role === 'overlay' ? ovl : base;
    const short = modeByKey.get(imgKey)?.label ?? terrain.labelFor(imgKey);
    const tx = mixTexts(short, role, terrain.getOverlay().blend);
    mixBox.querySelector('.rl-mix-label')!.textContent = activePresetDef()?.mixLabel ?? tx.label;
    mixBox.querySelector<HTMLElement>('[data-end="img"]')!.textContent = tx.lo;
    mixBox.querySelector<HTMLElement>('[data-end="relief"]')!.textContent = tx.hi;
    if (document.activeElement !== mixInput) mixInput.value = String(opacityToMix(opacity, role) ?? 0.5);
  }

  mixInput.addEventListener('input', () => {
    const o = terrain.getOverlay();
    const op = mixToOpacity(Number(mixInput.value), imageRole(terrain.getDisplay(), o.key));
    if (op !== null) terrain.setOverlay({ opacity: op }); // keeps the active preset highlighted
  });

  let activePreset = '';
  /** The active preset is mirrored into the store → URL hash field 14 ("Ansicht teilen"). */
  function setActivePreset(id: string) {
    activePreset = id;
    store.set({ preset: id }, 'gui');
  }
  /**
   * A link (URL hash) names a preset: apply it, then put the link's own display fields (layer,
   * overlay, opacity/mix slider, sun) back on top — the preset would otherwise overwrite them.
   */
  function applyLinkedPreset(s: Readonly<AppState>) {
    if (s.preset === activePreset) return;
    if (!s.preset) {
      activePreset = '';
      sync();
      return;
    }
    const pr = usablePresets.find((x) => x.id === s.preset);
    if (!pr) return setActivePreset(''); // unknown id or this AOI lacks the preset's layers
    const keep = presetOverrides(s);
    applyPreset(pr);
    store.set(keep, 'hash');
  }
  store.subscribe((s, _changed, source) => {
    if (source === 'hash') applyLinkedPreset(s);
  }, ['preset']);
  let syncQueued = false;
  terrain.onChange(() => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      sync();
    });
  });
  store.subscribe(() => sync(), ['layer', 'exaggeration', 'sunAzimuth', 'sunElevation', 'sunDirections']);

  // ---- actions ---------------------------------------------------------------------------------
  function selectMode(key: string, viaKeyboard = false) {
    if (!terrain.isValidDisplay(key)) return;
    setActivePreset('');
    store.set({ layer: key }, 'gui');
    terrain.setDisplay(key); // idempotent; also covers an unchanged store value
    if (viaKeyboard) toast(`${modeByKey.get(key)?.shortcut ?? ''} · ${terrain.labelFor(key)}`);
  }

  function applyPreset(pr: Preset, viaKeyboard = false) {
    setActivePreset(pr.id);
    const st = store.get();
    if (pr.sun) {
      store.set(
        {
          sunAzimuth: pr.sun.azimuth ?? st.sunAzimuth,
          sunElevation: pr.sun.elevation ?? st.sunElevation,
          sunDirections: pr.sun.directions ?? st.sunDirections,
        },
        'gui',
      );
    }
    if (pr.lrmRadius) {
      p.lrmRadius = pr.lrmRadius;
      terrain.setLowpassRadius(pr.lrmRadius);
    }
    terrain.resetChannel(pr.base);
    const ch = terrain.channel(pr.base);
    if (pr.baseOverride) {
      if (pr.baseOverride.colormap !== undefined) ch.colormap = pr.baseOverride.colormap;
      if (pr.baseOverride.shade !== undefined) ch.shade = pr.baseOverride.shade;
      ch.stretch = { ...ch.stretch, ...pr.baseOverride.stretch };
    }
    store.set({ layer: pr.base }, 'gui');
    terrain.setDisplay(pr.base);
    if (pr.overlay) {
      const o = pr.overlay;
      lastOverlay = o.key;
      const def = terrain.defaultStretchFor(o.key);
      terrain.setOverlay({ key: o.key });
      terrain.setOverlay({
        opacity: o.opacity,
        blend: o.blend,
        colormap: o.colormap ?? terrain.getOverlay().colormap,
        stretch: { ...def, ...o.stretch },
        shade: o.shade ?? 0,
      });
    } else {
      terrain.setOverlay({ key: '' });
    }
    if (viaKeyboard) toast(`Kombination: ${pr.label}`);
  }

  function resetContrast() {
    terrain.resetChannel(terrain.getDisplay());
    const o = terrain.getOverlay();
    if (o.key) terrain.setOverlay({ stretch: terrain.defaultStretchFor(o.key) });
  }

  let autoBusy = false;
  async function autoContrast(viaKeyboard = false) {
    if (autoBusy) return;
    autoBusy = true;
    try {
      const sample = await terrain.sampleValues(renderer, camera, p.autoScope);
      const key = terrain.getDisplay();
      const ch = terrain.channel(key);
      const clip = { low: p.autoClip, high: 100 - p.autoClip };
      let changed = false;
      if (ch.colormap !== Colormap.Mask && !terrain.isImageKey(key)) {
        const r = percentileStretch(sample.base, { ...clip, symmetric: ch.colormap === Colormap.Diverging });
        if (r) {
          ch.stretch = { ...ch.stretch, lo: r.lo, hi: r.hi };
          changed = true;
        }
      }
      if (changed) terrain.applyChannels();
      const o = terrain.getOverlay();
      if (o.key && sample.overlay && o.colormap !== Colormap.Mask) {
        const r = percentileStretch(sample.overlay, { ...clip, symmetric: o.colormap === Colormap.Diverging });
        if (r) terrain.setOverlay({ stretch: { ...o.stretch, lo: r.lo, hi: r.hi } });
      }
      if (viaKeyboard) {
        toast(changed ? 'Kontrast automatisch angepasst' : terrain.isImageKey(key) ? 'Kontrast: Bilder haben keine Farbskala' : 'Kontrast: keine Daten im Bereich');
      }
    } catch (err) {
      console.warn('[relief] auto contrast failed', err);
    } finally {
      autoBusy = false;
    }
  }

  // Continuous auto contrast while flying (view scope), at most ~2×/s and only after movement.
  let lastPose = '';
  setInterval(() => {
    if (!p.autoFollow || document.hidden) return;
    const c = camera.position;
    const pose = `${Math.round(c.x / 5)},${Math.round(c.y / 2)},${Math.round(c.z / 5)},${camera.rotation.x.toFixed(2)},${camera.rotation.y.toFixed(2)},${terrain.getDisplay()},${terrain.getOverlay().key}`;
    if (pose === lastPose && p.autoScope === 'view') return;
    lastPose = pose;
    void autoContrast();
  }, 500);

  function toggleOverlay(viaKeyboard = false) {
    const o = terrain.getOverlay();
    setActivePreset('');
    terrain.setOverlay({ key: o.key ? '' : lastOverlay });
    if (viaKeyboard) toast(terrain.getOverlay().key ? `Überlagerung: ${terrain.labelFor(terrain.getOverlay().key)}` : 'Überlagerung aus');
  }

  function cycleForest() {
    if (!hasDsm) return toast('Kein Oberflächenmodell (DOM) im Datensatz');
    const next = FOREST_CYCLE[(FOREST_CYCLE.indexOf(terrain.forest.mode) + 1) % FOREST_CYCLE.length];
    terrain.setForest({ mode: next });
    toast(`Wald: ${FOREST_LABELS[next]}`);
  }

  // ---- keyboard --------------------------------------------------------------------------------
  const byShortcut = new Map<string, ModeEntry>(modes.map((m) => [m.shortcut, m]));
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1];
    if (digit !== undefined) {
      if (e.shiftKey) {
        const pr = usablePresets[Number(digit) - 1];
        if (pr) applyPreset(pr, true);
      } else {
        const m = byShortcut.get(digit);
        if (m) selectMode(m.key, true);
      }
      return;
    }
    if (e.shiftKey) return;
    if (e.code === 'KeyB') toggleOverlay(true);
    else if (e.code === 'KeyV') cycleForest();
    else if (e.code === 'KeyK') void autoContrast(true);
  });

  // ---- toast + HUD note ------------------------------------------------------------------------
  const toastEl = document.createElement('div');
  toastEl.className = 'rl-toast';
  toastEl.hidden = true;
  ctx.container.parentElement?.appendChild(toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toast(text: string) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    toastEl.classList.remove('fade');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('fade'), 1100);
  }
  toastEl.addEventListener('transitionend', () => {
    if (toastEl.classList.contains('fade')) toastEl.hidden = true;
  });

  const note = document.createElement('div');
  note.className = 'rl-hud-note';
  ctx.hud.appendChild(note);
  setInterval(() => {
    const parts: string[] = [`Ansicht: ${modeByKey.get(terrain.getDisplay())?.label ?? terrain.labelFor(terrain.getDisplay())}`];
    const o = terrain.getOverlay();
    if (o.key) parts[0] += ` + ${modeByKey.get(o.key)?.label ?? terrain.labelFor(o.key)}`;
    const f = terrain.forest;
    let warn = false;
    if (f.mode !== 'off') {
      const c = camera.position;
      const top = terrain.canopyHeightAt(c.x, c.z);
      const inCanopy = !Number.isNaN(top) && c.y < terrain.toDisplayY(top);
      warn = inCanopy;
      parts.push(
        `Wald ${FOREST_LABELS[f.mode].toLowerCase()} · durchfliegbar` +
          (inCanopy ? ' · im Kronendach' : ''),
      );
    }
    const text = parts.join('\n');
    if (note.textContent !== text) note.textContent = text;
    note.classList.toggle('warn', warn);
  }, 250);

  // Start-up: main.ts applied the hash's display fields before this panel existed.
  if (store.get().preset) applyLinkedPreset(store.get());
  sync();
  return {
    gui,
    applyPresetById(id, announce = false) {
      const pr = usablePresets.find((x) => x.id === id);
      if (!pr) return false;
      applyPreset(pr, announce);
      return true;
    },
    hasPreset: (id) => usablePresets.some((x) => x.id === id),
    showMode(key) {
      if (!terrain.isValidDisplay(key)) return false;
      selectMode(key);
      if (terrain.getOverlay().key) terrain.setOverlay({ key: '' });
      return true;
    },
    activePresetId: () => activePreset,
  };
}
