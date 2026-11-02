/**
 * F16 "Punktwolke": panel card + key `C`, wiring the PointCloudLayer into the scene. Updated from
 * `scene.onBeforeRender` (so `window.sle.step()` drives it too, no edit to main.ts's loop). Default
 * OFF: no tile is fetched until the layer is switched on. Settings persist in localStorage
 * `sle.pointcloud.v1`. Area outlines appear on the minimap while the layer is on.
 */
import L from 'leaflet';
import type { Scene } from 'three';
import { pointClassLabel } from '../data/manifest';
import { utmToWgs84 } from '../geo';
import type { AppContext } from '../main';
import { bboxRing } from '../map/aois';
import type { Minimap } from '../map/Minimap';
import { isTyping } from '../ui/keys';
import { createPanelSection, openPanelSection } from '../ui/panelSection';
import { PointCloudLayer } from './PointCloudLayer';
import {
  AGL_RANGE,
  BUDGET_RANGE,
  CLASS_HINTS_DE,
  COLOR_MODES,
  COLOR_MODE_INDEX,
  SIZE_RANGE,
  classColorCss,
  formatBytes,
  formatPoints,
  heightRangeOf,
  parsePrefs,
  presentClasses,
} from './style';
import type { ColorMode, PointPrefs } from './style';
import { MAX_CLASS_SLOTS } from './style';
import './pointcloud.css';

declare global {
  interface Window {
    slePointClouds?: PointCloudApi;
  }
}

const PREFS_KEY = 'sle.pointcloud.v1';

function readPrefs(): PointPrefs {
  try {
    return parsePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'));
  } catch {
    return parsePrefs({});
  }
}

export interface PointCloudApi {
  layer: PointCloudLayer;
  readonly prefs: Readonly<PointPrefs>;
  setOn(on: boolean): void;
  setMode(mode: ColorMode): void;
  setClassVisible(code: number, visible: boolean): void;
  /** `fromPreset`: a quality preset (not the user's slider) sets it. */
  setBudget(points: number, fromPreset?: boolean): void;
  setAglMax(m: number | null): void;
  flyToArea(id: string): Promise<boolean>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (v: number, d = 1) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Returns null (and adds no UI) when the manifest has no `pointclouds`. */
export function initPointClouds(ctx: AppContext, panel: HTMLElement, deps: { minimap?: Minimap } = {}): PointCloudApi | null {
  const meta = ctx.manifest.pointclouds;
  if (!meta || meta.areas.length === 0) return null;
  const { scene, camera, terrain, renderer, manifest } = ctx;

  const layer = new PointCloudLayer(meta, terrain, manifest.origin, terrain.baseUrl);
  layer.visible = false;
  scene.add(layer);
  const u = layer.uniforms;

  const prefs = readPrefs();
  const save = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  };

  const codes = presentClasses(meta.areas, meta.classes);
  const classTotals = new Map<number, number>();
  for (const a of meta.areas) for (const [k, n] of Object.entries(a.classCounts ?? {})) classTotals.set(Number(k), (classTotals.get(Number(k)) ?? 0) + n);
  const totalPts = meta.areas.reduce((s, a) => s + a.pointCount, 0);

  // ---- panel --------------------------------------------------------------------------------
  const sec = createPanelSection(panel, 'pointcloud', 'Punktwolke', false);
  sec.setCount(formatPoints(totalPts));
  const areaRows = meta.areas
    .map(
      (a) =>
        `<button type="button" class="sle-pts-area" data-area="${esc(a.id)}" title="Hinfliegen">` +
        `<span>${esc(a.name_de)}</span><span class="sle-dim">${formatPoints(a.pointCount)} · ${fmt(a.density_per_m2)} Pkt/m²</span></button>`,
    )
    .join('');
  const classChips = codes
    .map((c) => {
      const label = pointClassLabel(meta.classes, c);
      const hint = CLASS_HINTS_DE[c] && label === 'Sonstige' ? ` (${CLASS_HINTS_DE[c]})` : '';
      const n = classTotals.get(c);
      return (
        `<label class="sle-pts-chip" title="LAS-Klasse ${c}${n ? ` · ${formatPoints(n)} Punkte` : ''}">` +
        `<input type="checkbox" data-cls="${c}"><i style="background:${classColorCss(c)}"></i>${esc(label + hint)}</label>`
      );
    })
    .join('');
  const modeBtns = COLOR_MODES.map((m) => `<button type="button" class="sle-btn" data-mode="${m.key}" title="${esc(m.title)}">${m.label}</button>`).join('');
  sec.body.innerHTML = `
    <div class="sle-row">
      <label title="Klassifizierte ALS-Punkte der Fokusgebiete (Taste C)"><input type="checkbox" data-k="on"> anzeigen <kbd>C</kbd></label>
      <span class="sle-spacer"></span><span class="sle-dim sle-pts-status" data-k="status"></span>
    </div>
    <div class="sle-pts-areas">${areaRows}</div>
    <div class="sle-row sle-pts-modes"><span>Farbe</span>${modeBtns}</div>
    <p class="sle-dim sle-small sle-pts-legend" data-k="legend"></p>
    <div class="sle-pts-chips">${classChips}</div>
    <div class="sle-row">
      <button type="button" class="sle-btn" data-act="all" title="Alle Klassen zeigen">Alle Klassen</button>
      <button type="button" class="sle-btn" data-act="ground" title="Nur Bodenpunkte (Klasse 2) – der Wald verschwindet">Nur Boden</button>
    </div>
    <div class="sle-row sle-pts-slider" title="Röntgen-Linse: Punkte höher als dieser Wert über dem Gelände (DGM) ausblenden – so sieht man den Boden unter dem Kronendach. Ganz rechts = aus.">
      <label for="sle-pts-agl">Röntgen bis</label>
      <input id="sle-pts-agl" type="range" min="${AGL_RANGE.min}" max="${AGL_RANGE.max + AGL_RANGE.step}" step="${AGL_RANGE.step}" data-k="agl">
      <span data-k="aglv"></span>
    </div>
    <div class="sle-row sle-pts-slider" title="Höchstzahl gleichzeitig gezeichneter Punkte (nahe Kacheln dichter, ferne ausgedünnt)">
      <label for="sle-pts-budget">Punktbudget</label>
      <input id="sle-pts-budget" type="range" min="${BUDGET_RANGE.min}" max="${BUDGET_RANGE.max}" step="${BUDGET_RANGE.step}" data-k="budget">
      <span data-k="budgetv"></span>
    </div>
    <div class="sle-row sle-pts-slider">
      <label for="sle-pts-size">Punktgröße</label>
      <input id="sle-pts-size" type="range" min="${SIZE_RANGE.min}" max="${SIZE_RANGE.max}" step="${SIZE_RANGE.step}" data-k="size">
      <span data-k="sizev"></span>
    </div>
    <div class="sle-row">
      <label title="Geländeoberfläche ausblenden, solange die Punktwolke an ist"><input type="checkbox" data-k="hideTerrain"> Gelände ausblenden</label>
    </div>
    <p class="sle-dim sle-small" data-k="attr"></p>`;
  const q = <T extends HTMLElement>(sel: string) => sec.body.querySelector<T>(sel)!;
  const cbOn = q<HTMLInputElement>('[data-k=on]');
  const sAgl = q<HTMLInputElement>('[data-k=agl]');
  const sBudget = q<HTMLInputElement>('[data-k=budget]');
  const sSize = q<HTMLInputElement>('[data-k=size]');
  const cbTerrain = q<HTMLInputElement>('[data-k=hideTerrain]');
  q('[data-k=attr]').textContent =
    `ALS 2025, ${meta.areas.length} Fokusgebiet${meta.areas.length === 1 ? '' : 'e'}, je ${meta.tileSize} m-Kacheln. ` +
    `Geladen wird nur im Umkreis von ${fmt(layer.loadRadius / 1000)} km. ${meta.attribution ?? ''}`.trim();

  // ---- minimap outlines -----------------------------------------------------------------------
  const mapLayer = L.layerGroup();
  for (const a of meta.areas) {
    // Densified UTM ring, not L.rectangle: the area is a UTM square, rotated ~1.3° against lat/lon.
    const ring = bboxRing(a.bbox).map(([E, N]) => {
      const ll = utmToWgs84(E, N);
      return [ll.lat, ll.lon] as L.LatLngTuple;
    });
    // bubblingMouseEvents: false — the minimap's click-to-fly must not replace flyToArea.
    const r = L.polygon(ring, { color: '#4fd1ff', weight: 1.5, fill: false, dashArray: '4 3', bubblingMouseEvents: false });
    r.bindTooltip(`Punktwolke: ${a.name_de}`);
    r.on('click', () => void flyToArea(a.id));
    mapLayer.addLayer(r);
  }

  // ---- state → uniforms / controls --------------------------------------------------------------
  function applyClasses(): void {
    const hidden = new Set(prefs.hidden);
    u.uClassColor.value.forEach((v, c) => (v.w = hidden.has(c) ? 0 : 1));
    // Codes ≥ 32 share one slot: visible unless every such present code is hidden.
    const big = codes.filter((c) => c >= MAX_CLASS_SLOTS);
    u.uOtherClass.value.w = big.length && big.every((c) => hidden.has(c)) ? 0 : 1;
    for (const c of codes) q<HTMLInputElement>(`[data-cls="${c}"]`).checked = !hidden.has(c);
  }

  function applyLegend(): void {
    const el = q('[data-k=legend]');
    if (prefs.mode === 'height') {
      const r = u.uHeightRange.value;
      el.textContent = `Höhe ${fmt(r.x, 0)} – ${fmt(r.y, 0)} m ü. NN (Fokusgebiet in der Nähe)`;
    } else if (prefs.mode === 'agl') {
      el.textContent = `Höhe über Grund 0 – ${fmt(u.uAglRange.value.y, 0)} m (Boden dunkel, Kronen hell)`;
    } else if (prefs.mode === 'intensity') {
      el.textContent = 'Echo-Intensität relativ (dunkel = schwach)';
    } else {
      el.textContent = 'Klassen aus der amtlichen Klassifizierung (LVGL 2025)';
    }
    el.hidden = false;
  }

  function sync(): void {
    cbOn.checked = prefs.on;
    for (const b of sec.body.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.classList.toggle('on', b.dataset.mode === prefs.mode);
    u.uMode.value = COLOR_MODE_INDEX[prefs.mode];
    applyClasses();
    sAgl.value = String(prefs.aglMax ?? AGL_RANGE.max + AGL_RANGE.step);
    q('[data-k=aglv]').textContent = prefs.aglMax === null ? 'aus' : `${fmt(prefs.aglMax)} m`;
    u.uAglMax.value = prefs.aglMax ?? 1e6;
    sBudget.value = String(prefs.budget);
    q('[data-k=budgetv]').textContent = formatPoints(prefs.budget);
    layer.lod.budget = prefs.budget;
    sSize.value = String(prefs.size);
    q('[data-k=sizev]').textContent = `${fmt(prefs.size)}×`;
    u.uSize.value = prefs.size;
    cbTerrain.checked = prefs.hideTerrain;
    terrain.visible = !(prefs.on && prefs.hideTerrain);
    applyLegend();
  }

  let lastStatus = 0;
  function showStatus(force = false): void {
    const now = performance.now();
    if (!force && now - lastStatus < 250) return;
    lastStatus = now;
    const el = q('[data-k=status]');
    if (!prefs.on) {
      el.textContent = 'aus';
      return;
    }
    const s = layer.stats;
    const parts: string[] = [];
    if (s.resident === 0 && s.loading === 0) {
      const near = layer.nearestArea(camera.position.x, camera.position.z);
      parts.push(near && near.dist > layer.loadRadius ? `nächstes Gebiet ${fmt(near.dist / 1000)} km` : 'keine Kacheln');
    } else {
      parts.push(`${formatPoints(s.drawn)} Pkt.`);
      parts.push(`${s.resident} Kacheln`);
      parts.push(formatBytes(s.gpuBytes));
    }
    if (s.loading > 0) parts.push(`lädt … ${s.loading}`);
    if (s.failed > 0) parts.push(s.gaveUp ? `${s.failed} fehlgeschlagen` : `${s.failed} fehlgeschlagen, neuer Versuch folgt`);
    el.textContent = parts.join(' · ');
    el.title =
      `Gezeichnet: ${formatPoints(s.drawn)} von ${formatPoints(s.residentPoints)} geladenen Punkten ` +
      `(Obergrenze ${formatPoints(layer.maxResidentPoints)}). Speicher: ${formatBytes(s.gpuBytes)} GPU + ${formatBytes(s.gpuBytes)} CPU.` +
      (s.gaveUp ? ` ${s.gaveUp} Kachel(n) nach mehreren Versuchen aufgegeben – Punktwolke aus- und einschalten für einen neuen Versuch.` : '');
  }
  layer.onChange(() => showStatus(true));

  function setOn(on: boolean): void {
    prefs.on = on;
    save();
    layer.visible = on;
    if (on) {
      if (deps.minimap) mapLayer.addTo(deps.minimap.map);
    } else {
      layer.clearAll(); // free GPU memory; re-fetching hits the HTTP cache
      mapLayer.remove();
    }
    sync();
    showStatus(true);
  }

  const setMode = (mode: ColorMode) => {
    prefs.mode = mode;
    save();
    sync();
  };
  const setClassVisible = (code: number, visible: boolean) => {
    const h = new Set(prefs.hidden);
    if (visible) h.delete(code);
    else h.add(code);
    prefs.hidden = [...h].sort((a, b) => a - b);
    save();
    sync();
  };
  const setBudget = (n: number, fromPreset = false) => {
    prefs.budget = parsePrefs({ budget: n }).budget;
    if (!fromPreset) prefs.budgetUser = true;
    save();
    sync();
  };
  const setAglMax = (m: number | null) => {
    prefs.aglMax = m === null ? null : parsePrefs({ aglMax: m }).aglMax;
    save();
    sync();
  };

  async function flyToArea(id: string): Promise<boolean> {
    const a = meta!.areas.find((x) => x.id === id);
    if (!a) return false;
    if (!prefs.on) setOn(true);
    const E = (a.bbox[0] + a.bbox[2]) / 2;
    const N = (a.bbox[1] + a.bbox[3]) / 2;
    const span = Math.max(a.bbox[2] - a.bbox[0], a.bbox[3] - a.bbox[1]);
    return ctx.flyTo(E, N, { agl: Math.min(400, Math.max(120, span * 0.35)), pitch: -40 });
  }

  // ---- events ---------------------------------------------------------------------------------
  cbOn.addEventListener('change', () => setOn(cbOn.checked));
  for (const b of sec.body.querySelectorAll<HTMLButtonElement>('[data-area]')) b.addEventListener('click', () => void flyToArea(b.dataset.area!));
  for (const b of sec.body.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode as ColorMode));
  for (const cb of sec.body.querySelectorAll<HTMLInputElement>('[data-cls]')) cb.addEventListener('change', () => setClassVisible(Number(cb.dataset.cls), cb.checked));
  q('[data-act=all]').addEventListener('click', () => {
    prefs.hidden = [];
    save();
    sync();
  });
  q('[data-act=ground]').addEventListener('click', () => {
    prefs.hidden = codes.filter((c) => c !== 2);
    save();
    sync();
  });
  sAgl.addEventListener('input', () => {
    const v = Number(sAgl.value);
    setAglMax(v > AGL_RANGE.max ? null : v);
  });
  sBudget.addEventListener('input', () => setBudget(Number(sBudget.value)));
  sSize.addEventListener('input', () => {
    prefs.size = parsePrefs({ size: Number(sSize.value) }).size;
    save();
    sync();
  });
  cbTerrain.addEventListener('change', () => {
    prefs.hideTerrain = cbTerrain.checked;
    save();
    sync();
  });
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyC') {
      setOn(!prefs.on);
      if (prefs.on) openPanelSection(sec);
    }
  });

  // ---- frame hook -----------------------------------------------------------------------------
  let lastAreaId = '';
  const prev = scene.onBeforeRender.bind(scene);
  (scene as Scene).onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
    prev(...args);
    if (args[2] !== camera || !layer.visible) return;
    layer.update(camera, renderer);
    const near = layer.nearestArea(camera.position.x, camera.position.z);
    if (near && near.area.id !== lastAreaId) {
      lastAreaId = near.area.id;
      const r = heightRangeOf([near.area], manifest.heightRange);
      u.uHeightRange.value.set(r.min, r.max);
      applyLegend();
    }
    showStatus();
  };

  sync();
  setOn(prefs.on);

  const api: PointCloudApi = {
    layer,
    get prefs() {
      return prefs;
    },
    setOn,
    setMode,
    setClassVisible,
    setBudget,
    setAglMax,
    flyToArea,
  };
  window.slePointClouds = api; // debug/verification handle
  return api;
}
