/**
 * F11 "Gebäude": panel card + key `G`, wiring the BuildingLayer into the scene. Updated from
 * `scene.onBeforeRender` (so `window.sle.step()` drives it too, no edit to main.ts's loop).
 * Default ON (orientation in towns; buildings don't hide relief under the forest) — persisted in
 * localStorage `sle.buildings.v1`.
 */
import type { Scene } from 'three';
import type { AppContext } from '../main';
import { isTyping } from '../ui/keys';
import { createPanelSection } from '../ui/panelSection';
import { BuildingLayer } from './BuildingLayer';
import './buildings.css';

declare global {
  interface Window {
    sleBuildings?: BuildingsApi;
  }
}

const PREFS_KEY = 'sle.buildings.v1';

function readOn(): boolean {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { on?: unknown };
    return typeof p.on === 'boolean' ? p.on : true;
  } catch {
    return true;
  }
}

function writeOn(on: boolean): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ on }));
  } catch {
    /* ignore */
  }
}

export interface BuildingsApi {
  layer: BuildingLayer;
  readonly on: boolean;
  setOn(on: boolean): void;
}

/** Returns null (and adds no UI) when the manifest has no `models.buildings`. */
export function initBuildings(ctx: AppContext, panel: HTMLElement): BuildingsApi | null {
  const models = ctx.manifest.models?.buildings;
  if (!models || models.chunks.length === 0) return null;
  const { scene, camera, terrain } = ctx;

  const layer = new BuildingLayer(models, terrain, terrain.baseUrl);
  scene.add(layer);

  const sec = createPanelSection(panel, 'buildings', 'Gebäude', false);
  sec.body.innerHTML = `
    <div class="sle-row">
      <label title="3D-Gebäude (LoD2) im Umkreis von ca. 2 km (Taste G)"><input type="checkbox" data-k="on"> Gebäude (LoD2) <kbd>G</kbd></label>
      <span class="sle-dim sle-bldg-status"></span>
    </div>
    <p class="sle-dim sle-small" data-row="attr"></p>`;
  const cb = sec.body.querySelector<HTMLInputElement>('[data-k=on]')!;
  const status = sec.body.querySelector<HTMLElement>('.sle-bldg-status')!;
  const attr = models.attribution ?? models.source ?? '';
  sec.body.querySelector<HTMLElement>('[data-row=attr]')!.textContent =
    `${models.featureCount ? `${models.featureCount.toLocaleString('de-DE')} Gebäude. ` : ''}${attr}`.trim();

  let on = readOn();
  const showStatus = () => {
    if (!on) {
      status.textContent = 'aus';
      return;
    }
    const s = layer.stats;
    const parts = [`${s.resident} Kacheln`];
    if (s.pending > 0) parts.push(`lädt … ${s.pending}`);
    if (s.failed > 0) parts.push(`${s.failed} fehlgeschlagen`);
    status.textContent = parts.join(' · ');
  };
  layer.onChange(showStatus);

  const setOn = (v: boolean) => {
    on = v;
    cb.checked = v;
    writeOn(v);
    layer.visible = v;
    if (!v) layer.clearAll(); // free GPU memory; re-fetching hits the HTTP cache
    showStatus();
  };

  const prev = scene.onBeforeRender.bind(scene);
  (scene as Scene).onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
    prev(...args);
    if (args[2] === camera) layer.update(camera);
  };

  cb.addEventListener('change', () => setOn(cb.checked));
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyG') setOn(!on);
  });
  setOn(on);

  const api: BuildingsApi = {
    layer,
    get on() {
      return on;
    },
    setOn,
  };
  window.sleBuildings = api; // debug/verification handle
  return api;
}
