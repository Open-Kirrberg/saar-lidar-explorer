/**
 * v1 modules sorted into the tiers of ADR 0019. One registration per feature; the v1 modules stay
 * as they are (ADR 0024: keep the core) and get per-feature host containers instead of `#panel`.
 *
 * | id             | tier      | panel from | what                                              |
 * |----------------|-----------|------------|---------------------------------------------------|
 * | markers        | standard  | labor      | marker store + 3D pins (core); list/GeoJSON card  |
 * | minimap        | standard  |            | game minimap in `slots.minimap` (V2.3, ADR 0036)   |
 * | places         | standard  |            | „Orte“ drawer (F7) + 3D labels                     |
 * | osm-paths      | standard  | labor      | OSM ways in 3D (F10); card + F12 lookup in Labor  |
 * | buildings      | standard  | labor      | LoD2 houses (F11); card in Labor                  |
 * | quality        | entdecker |            | „Qualität“ in Einstellungen (Standard = auto)     |
 * | exaggeration   | entdecker |            | „Überhöhung“ in Einstellungen                     |
 * | reconstruction | entdecker |            | F19 Rekonstruktion 1789 card + „Schloss betreten“ |
 * | tour           | entdecker |            | Tour card (until the V2.9 tutorial)               |
 * | relief-lab     | labor     |            | „Darstellung“ relief lab (keys 1–9, B, V, K)      |
 * | flight-tech    | labor     |            | „Flug & Technik“ (+ LOD/Debug in dev builds)      |
 * | hud-full       | labor     |            | full HUD readout (NN, E/N, pitch, fps)            |
 * | candidates     | labor     |            | F15 review, scores, filters                       |
 * | marker-tool    | labor     |            | „Markieren“ button + F18 report                   |
 * | measure        | labor     |            | F17 measuring + profile                           |
 */
import { initBuildings } from '../buildings/Buildings';
import { initCandidates } from '../candidates/Candidates';
import { bindLongPressContext } from '../controls/touchContext';
import type { AppContext } from '../main';
import { Minimap } from '../map/Minimap';
import { MarkerManager } from '../markers/MarkerManager';
import { initMeasure } from '../measure';
import { createPoiPanel } from '../pois/PoiPanel';
import { onZonePortals } from '../zones/runtime/feature';
import { initReconstruction } from '../reconstruction/Reconstruction';
import { openReportDialog } from '../report/ReportDialog';
import { EXAG_RANGE, clampExaggeration } from '../state';
import { createGui } from '../ui/gui';
import { QUALITY_LABELS } from '../ui/quality';
import { createReliefPanel } from '../ui/reliefPanel';
import type { ReliefPanelApi } from '../ui/reliefPanel';
import { QUALITY_LEVELS } from '../ui/settings';
import type { QualityLevel } from '../ui/settings';
import { createTourGuide } from '../ui/TourGuide';
import { initVectorLayers } from '../vectors/VectorLayers';
import { el } from './dom';
import { compass, fmtNum } from './hud';
import type { SettingsRuntime } from './Shell';
import type { ShellApi, ShellServices } from './types';

export interface BuiltinDeps {
  ctx: AppContext;
  services: ShellServices;
  settings: SettingsRuntime;
  quality: { get(): QualityLevel; set(q: QualityLevel): void };
  hudPending(): number;
}

const QUALITY_HINTS: Record<QualityLevel, string> = {
  hoch: 'Volle Auflösung, Details bis weit hinaus.',
  mittel: 'Weniger Pixel und Details in der Ferne – flüssiger auf schwächeren Rechnern.',
  niedrig: 'Deutlich gröber, kleinere Radien für Gebäude und Beschriftungen.',
  mobil: 'Für Handys: begrenzte Auflösung und Speicher, kurze Radien.',
};

/** Card in the „Werkzeuge“ drawer (same look as the v1 panel sections, always open). */
function card(parent: HTMLElement, title: string): HTMLElement {
  const body = el('div', { class: 'sle-card-body' });
  parent.append(el('section', { class: 'sle-card open' }, el('h3', { class: 'sle-card-title-static', text: title }), body));
  return body;
}

export function registerBuiltins(shell: ShellApi, d: BuiltinDeps): void {
  const { ctx, services } = d;
  const m = ctx.manifest;
  let poiFly: ((id: string) => void) | null = null;
  let relief: ReliefPanelApi | null = null;
  const reg = shell.registerFeature;

  // ---- 🟢 Standard -------------------------------------------------------------------------------------
  reg({
    id: 'markers',
    tier: 'standard',
    panelTier: 'labor',
    label: 'Fundmarker (Speicher, 3D-Nadeln)',
    mount(h) {
      const markers = new MarkerManager(ctx, h.panel, services.labels);
      services.markers = markers;
      bindLongPressContext(ctx.touch, { markers, measure: () => window.sleMeasure }); // F20 long-press
    },
  });
  reg({
    id: 'minimap',
    tier: 'standard',
    label: 'Karte',
    mount(h) {
      const mm = new Minimap(h.shell.slots.minimap, ctx, {
        onPoiClick: (p) => poiFly?.(p.id),
        onMarkerClick: (mk) => services.markers?.flyTo(mk),
        shell: h.shell,
      });
      services.minimap = mm;
      services.markers?.onChange((list) => mm.setMarkers(list));
      const offPortals = onZonePortals((list) =>
        mm.setPortals(list.map((p) => ({ id: `${p.zoneId}/${p.portalId}`, E: p.E, N: p.N, label: p.name_de }))),
      );
      return () => {
        offPortals();
        mm.destroy();
        services.minimap = null;
      };
    },
  });
  reg({
    id: 'places',
    tier: 'standard',
    label: 'Orte',
    mount: (h) =>
      createPoiPanel(ctx, h.places, services.labels).then((api) => {
        services.minimap?.setPois(api.pois);
        poiFly = (id) => {
          const p = api.pois.find((x) => x.id === id);
          if (p) api.flyTo(p);
        };
      }),
  });
  reg({
    id: 'osm-paths',
    tier: 'standard',
    panelTier: 'labor',
    label: 'Wege (OSM) in 3D',
    available: () => !!m.vectors || !!ctx.catalog, // S2 catalog mode: per-place OSM files
    mount(h) {
      initVectorLayers(ctx, h.panel);
    },
  });
  reg({
    id: 'buildings',
    tier: 'standard',
    panelTier: 'labor',
    label: 'Gebäude (LoD2)',
    available: () => !!m.models?.buildings?.chunks.length,
    mount(h) {
      initBuildings(ctx, h.panel);
    },
  });

  // ---- 🟡 Entdecker --------------------------------------------------------------------------------------
  reg({
    id: 'quality',
    tier: 'entdecker',
    label: 'Qualität',
    mount(h) {
      const seg = el('div', { class: 'sle-seg', role: 'radiogroup', 'aria-labelledby': 'sle-q-label' });
      const hint = el('p', { class: 'sle-dim sle-small' });
      const sync = () => {
        for (const b of seg.querySelectorAll<HTMLButtonElement>('button')) {
          const on = b.dataset.q === d.quality.get();
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
        }
        hint.textContent = QUALITY_HINTS[d.quality.get()];
      };
      const pick = (q: QualityLevel) => {
        d.quality.set(q);
        sync();
      };
      for (const q of QUALITY_LEVELS) {
        const b = el('button', { type: 'button', role: 'radio', 'data-q': q, text: QUALITY_LABELS[q] });
        b.addEventListener('click', () => pick(q));
        seg.append(b);
      }
      seg.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        e.stopPropagation();
        const i = QUALITY_LEVELS.indexOf(d.quality.get());
        const q = QUALITY_LEVELS[(i + dir + QUALITY_LEVELS.length) % QUALITY_LEVELS.length];
        pick(q);
        seg.querySelector<HTMLButtonElement>(`[data-q=${q}]`)?.focus();
      });
      sync();
      h.settings.append(el('h3', { id: 'sle-q-label', text: 'Qualität' }), seg, hint);
      return () => {};
    },
  });
  reg({
    id: 'exaggeration',
    tier: 'entdecker',
    label: 'Überhöhung',
    mount(h) {
      const input = el('input', {
        type: 'range',
        id: 'sle-exag',
        min: String(EXAG_RANGE.min),
        max: String(EXAG_RANGE.max),
        step: '0.1',
      }) as HTMLInputElement;
      const out = el('output', { for: 'sle-exag' });
      const sync = () => {
        const v = ctx.store.get().exaggeration;
        input.value = String(v);
        out.textContent = `${fmtNum(v, 1)}×`;
      };
      input.addEventListener('input', () => ctx.store.set({ exaggeration: clampExaggeration(Number(input.value)) }, 'shell'));
      const off = ctx.store.subscribe(sync, ['exaggeration']);
      sync();
      h.settings.append(
        el('h3', {}, el('label', { for: 'sle-exag', text: 'Überhöhung' })),
        el('div', { class: 'sle-row sle-range' }, input, out),
        el('p', { class: 'sle-dim sle-small', text: 'Höhen stärker zeigen: flache Wälle und Gräben treten hervor.' }),
      );
      return off;
    },
  });
  reg({
    id: 'reconstruction',
    tier: 'entdecker',
    label: 'Rekonstruktion 1789',
    mount: async (h) => {
      await initReconstruction(ctx, h.panel, { minimap: services.minimap ?? undefined, toolbar: h.tools });
    },
  });
  reg({
    id: 'tour',
    tier: 'entdecker',
    label: 'Tour',
    mount: async (h) => {
      const tour = await createTourGuide(ctx, { applyPreset: (id) => relief?.applyPresetById(id) ?? false });
      if (!tour.stops.length) return;
      const body = card(h.panel, 'Tour durch bekannte Orte');
      const b = el('button', { type: 'button', class: 'sle-btn', text: 'Tour starten' });
      b.addEventListener('click', () => (tour.active ? tour.stop() : tour.start(0)));
      body.append(el('p', { class: 'sle-dim sle-small', text: `${tour.stops.length} Stationen, mit ← → weiter.` }), b);
    },
  });

  // ---- 🔴 Labor ------------------------------------------------------------------------------------------
  reg({
    id: 'relief-lab',
    tier: 'labor',
    label: 'Relief-Labor (Darstellung)',
    mount(h) {
      relief = createReliefPanel({ container: h.panel, hud: h.hud, store: ctx.store, terrain: ctx.terrain, renderer: ctx.renderer, camera: ctx.camera });
    },
  });
  const debug = { showFps: false };
  reg({
    id: 'flight-tech',
    tier: 'labor',
    label: 'Flug & Technik',
    mount(h) {
      createGui({
        container: h.panel,
        store: ctx.store,
        terrain: ctx.terrain,
        controller: ctx.controller,
        renderer: ctx.renderer,
        debug,
        onFlightChange: (p) => d.settings.patch(p),
      }).close();
    },
  });
  reg({
    id: 'hud-full',
    tier: 'labor',
    label: 'Volles HUD',
    mount(h) {
      const cells: Record<string, HTMLElement> = {};
      const table = el('table', { class: 'hud-full' });
      for (const [k, label] of [
        ['h', 'Höhe ü. NN'],
        ['dir', 'Kurs / Neigung'],
        ['en', 'E / N (UTM 32)'],
        ['mult', 'Tempo-Faktor'],
        ['fps', 'Bildrate'],
      ]) {
        cells[k] = el('td');
        table.append(el('tr', {}, el('td', { text: label }), cells[k]));
      }
      h.hud.append(table);
      let frames = 0;
      let t0 = performance.now();
      let fps = 0;
      const offFrame = ctx.onFrame(() => frames++);
      const render = () => {
        const s = ctx.store.get();
        const now = performance.now();
        if (now - t0 > 500) {
          fps = (frames * 1000) / (now - t0);
          frames = 0;
          t0 = now;
        }
        cells.h.textContent = `${fmtNum(s.h, 1)} m`;
        cells.dir.textContent = `${fmtNum(s.heading)}° ${compass(s.heading)} / ${fmtNum(s.pitch)}°`;
        cells.en.textContent = `${fmtNum(s.E)} / ${fmtNum(s.N)}`;
        cells.mult.textContent = `×${fmtNum(ctx.controller.speedMultiplier, 2)}`;
        cells.fps.textContent = `${fmtNum(fps)} fps`;
      };
      render();
      const id = setInterval(render, 250);
      return () => {
        clearInterval(id);
        offFrame();
      };
    },
  });
  reg({
    id: 'candidates',
    tier: 'labor',
    label: 'Verdachtsflächen prüfen (F15)',
    available: () => !!m.candidates,
    mount(h) {
      if (!services.minimap || !services.markers) return;
      initCandidates(ctx, h.panel, { minimap: services.minimap, markers: services.markers, labels: services.labels });
    },
  });
  reg({
    id: 'marker-tool',
    tier: 'labor',
    label: 'Markieren + Meldung (F18)',
    mount(h) {
      const markers = services.markers;
      if (!markers) return () => {};
      const b = el('button', { type: 'button', class: 'sle-tool-btn', 'data-act': 'mark', title: 'Fundmarker setzen (Taste M)' }, 'Markieren ', el('kbd', { text: 'M' }));
      b.addEventListener('click', () => markers.setActive(!markers.active));
      markers.onModeChange((on) => b.classList.toggle('on', on));
      h.tools.append(b);
      markers.setReportHandler((mk) => openReportDialog(ctx, mk)); // F18: „Meldung erstellen“ (download only)
      return () => markers.setReportHandler(null);
    },
  });
  reg({
    id: 'measure',
    tier: 'labor',
    label: 'Messen (F17)',
    mount(h) {
      initMeasure(ctx, h.panel, services.labels, { toolbar: h.tools, exclusiveWith: services.markers ?? undefined });
    },
  });
  // 🧊 F16 point cloud + Röntgen and F20 „Mein Standort“ are frozen (ADR 0020): not registered.
}
