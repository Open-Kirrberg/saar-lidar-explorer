/**
 * F19 "Rekonstruktion 1789 (Hypothese)": the light Schloss Karlsberg model from the shared dataset
 * `data/shared/karlsberg1789/` (contract "Shared datasets", sle-recon-v1) as a toggleable layer
 * (key `R`, default OFF), colour modes *Material* / *Konfidenz*, opacity (*Geister-Modus*), click
 * → info card, footprints on the minimap, and the handover to the full castle viewer
 * ("Schloss betreten", key `T`, Shift = zu Fuß) when the camera is near the palace.
 *
 * The dataset is optional and AOI-independent: 404 / invalid → no UI at all (logged once). Its
 * strings are untrusted (textContent / escaped only), its viewer URL is validated (local http(s));
 * a build-time `VITE_VIEWER_URL` (public build: `castle/`, same origin) replaces it, `off` hides the handover.
 * The layer is updated from `scene.onBeforeRender` (so `window.sle.step()` drives it too).
 */
import L from 'leaflet';
import type { Scene } from 'three';
import { Raycaster, Vector2 } from 'three';
import { dataRootUrl } from '../data/manifest';
import { viewerUrlOverride } from '../data/urls';
import { utmToWgs84, worldToUtm } from '../geo';
import type { AppContext } from '../main';
import type { Minimap } from '../map/Minimap';
import { shareUrl } from '../state';
import { isTyping } from '../ui/keys';
import { createPanelSection, openPanelSection } from '../ui/panelSection';
import {
  CONF_COLORS,
  CONF_LABELS_DE,
  KARLSBERG_RECON_PATH,
  OPACITY_RANGE,
  RECON_CONFIDENCES,
  RECON_PREFS_KEY,
  anchorDistance,
  attributionEntries,
  buildViewerUrl,
  footprintCentre,
  footprintShownOnAoi,
  parseFootprints,
  parseReconIndex,
  parseReconPrefs,
  reconFooterText,
  reconOverlapsAoi,
  trueHeightFromDisplay,
  withinEnterRadius,
} from './recon';
import type { HandoverMode, ReconFootprint, ReconIndex, ReconPrefs } from './recon';
import { ReconLayer } from './ReconLayer';
import type { ReconPick } from './ReconLayer';
import './reconstruction.css';

declare global {
  interface Window {
    sleRecon?: ReconApi;
  }
}

export interface ReconApi {
  index: ReconIndex;
  layer: ReconLayer;
  readonly on: boolean;
  setOn(on: boolean): void;
  /** Camera within `anchor.enterRadius_m` (horizontal). */
  inRange(): boolean;
  /** Handover URL for the current camera pose (what "Schloss betreten" opens). */
  handoverUrl(mode: HandoverMode): string;
  enter(mode: HandoverMode): boolean;
  select(id: string | null): void;
}

/** Fired on window when optional features appear after start-up (HUD shortcut list refresh). */
export const FEATURES_EVENT = 'sle:features';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hexCss = (h: number) => `#${h.toString(16).padStart(6, '0')}`;
const fmtM = (v: number) => `${v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;

function readPrefs(): ReconPrefs {
  try {
    return parseReconPrefs(JSON.parse(localStorage.getItem(RECON_PREFS_KEY) ?? '{}'));
  } catch {
    return parseReconPrefs({});
  }
}

function writePrefs(p: ReconPrefs): void {
  try {
    localStorage.setItem(RECON_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

export interface ReconDeps {
  minimap?: Minimap;
  /** `#sle-toolbar` (bottom centre): gets the "Schloss betreten" / "zu Fuß" buttons. */
  toolbar?: HTMLElement;
}

/**
 * Adds a hidden panel card right away (stable panel order), then loads `index.json`; resolves to
 * null (and removes the card) when the dataset is absent or outside the AOI.
 */
export async function initReconstruction(ctx: AppContext, panel: HTMLElement, deps: ReconDeps = {}): Promise<ReconApi | null> {
  const sec = createPanelSection(panel, 'reconstruction', 'Rekonstruktion 1789 (Hypothese)', false);
  sec.root.hidden = true;

  const baseUrl = `${dataRootUrl()}${KARLSBERG_RECON_PATH}`;
  let index: ReconIndex | null = null;
  try {
    const r = parseReconIndex(await fetchJson(`${baseUrl}index.json`));
    for (const w of r.warnings) console.warn(`[reconstruction] ${w}`);
    index = r.value;
  } catch (err) {
    console.info(`[reconstruction] no shared dataset (${err instanceof Error ? err.message : String(err)}) – layer absent`);
  }
  const m = ctx.manifest;
  if (index && !reconOverlapsAoi(index, { origin: m.origin, width: m.size.width * m.cellSize, height: m.size.height * m.cellSize })) {
    console.info(`[reconstruction] ${index.id} lies outside AOI ${m.aoi} – layer absent`);
    index = null;
  }
  if (!index) {
    sec.root.remove();
    return null;
  }
  return setup(ctx, index, baseUrl, sec, deps);
}

function setup(
  ctx: AppContext,
  index: ReconIndex,
  baseUrl: string,
  sec: ReturnType<typeof createPanelSection>,
  deps: ReconDeps,
): ReconApi {
  const { scene, camera, terrain, controller, renderer, store, manifest } = ctx;
  const origin = manifest.origin;
  const prefs = readPrefs();
  const layer = new ReconLayer(index, terrain, baseUrl);
  layer.visible = false;
  scene.add(layer);
  const anchorKm = (index.anchor.enterRadius_m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  const radiusTxt = index.anchor.enterRadius_m >= 1000 ? `${anchorKm} km` : `${Math.round(index.anchor.enterRadius_m)} m`;

  // ---- panel ----------------------------------------------------------------------------------
  sec.root.querySelector('.sle-card-title')!.textContent = index.label_de;
  sec.setCount(index.buildings.length ? `${index.buildings.length} Bauten` : '');
  const legend = RECON_CONFIDENCES.map(
    (c) => `<span class="sle-recon-key"><i style="background:${hexCss(CONF_COLORS[c])}"></i>${CONF_LABELS_DE[c]}</span>`,
  ).join('');
  sec.body.innerHTML = `
    <p class="sle-recon-warn" data-k="disclaimer"></p>
    <div class="sle-row">
      <label title="Vereinfachtes 3D-Modell (Baukörper, Dächer, Fassaden; keine Innenräume) – Taste R"><input type="checkbox" data-k="on"> anzeigen <kbd>R</kbd></label>
      <span class="sle-spacer"></span><span class="sle-dim sle-recon-status" data-k="status" role="status"></span>
    </div>
    <div class="sle-row" role="group" aria-label="Farbe">
      <span>Farbe</span>
      <button type="button" class="sle-btn" data-mode="material" title="Farben der Baumaterialien (Wände, Dächer, Stein)">Material</button>
      <button type="button" class="sle-btn" data-mode="confidence" title="Wie sicher die Rekonstruktion je Bau ist">Konfidenz</button>
    </div>
    <p class="sle-dim sle-small sle-recon-legend" data-k="legend">Konfidenz: ${legend}</p>
    <div class="sle-row sle-recon-slider" title="Geister-Modus: unter 100 % scheinen die heutigen Ruinen und das Gelände 2025 durch">
      <label for="sle-recon-opacity">Deckkraft</label>
      <input id="sle-recon-opacity" type="range" min="${OPACITY_RANGE.min}" max="${OPACITY_RANGE.max}" step="${OPACITY_RANGE.step}" data-k="opacity">
      <span data-k="opv"></span>
    </div>
    <div class="sle-row">
      <button type="button" class="sle-btn" data-act="fly" title="Zum Schloss fliegen">Zum Schloss</button>
      <button type="button" class="sle-btn" data-act="enter" title="Im Schloss-Viewer an dieser Position weiterfliegen (Taste T)">Schloss betreten <kbd>T</kbd></button>
      <button type="button" class="sle-btn" data-act="walk" title="Im Schloss-Viewer zu Fuß am nächsten Eingang beginnen (Umschalt+T)">zu Fuß <kbd>⇧T</kbd></button>
    </div>
    <p class="sle-dim sle-small" data-k="range" aria-live="polite"></p>
    <div class="sle-recon-detail" data-k="detail" hidden></div>
    <p class="sle-dim sle-small" data-k="attr"></p>`;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => sec.body.querySelector<T>(sel)!;
  q('[data-k=disclaimer]').textContent = index.disclaimer_de;
  const cb = q<HTMLInputElement>('[data-k=on]');
  const status = q('[data-k=status]');
  const opacity = q<HTMLInputElement>('[data-k=opacity]');
  const opv = q('[data-k=opv]');
  const rangeHint = q('[data-k=range]');
  const detail = q('[data-k=detail]');
  const panelEnter = q<HTMLButtonElement>('[data-act=enter]');
  const panelWalk = q<HTMLButtonElement>('[data-act=walk]');
  const viewerOverride = viewerUrlOverride();
  /** Build without the castle viewer (`VITE_VIEWER_URL=off`): no "Schloss betreten" at all. */
  const handoverOff = viewerOverride === 'off';
  const viewerUrl = viewerOverride && viewerOverride !== 'off' ? viewerOverride : index.viewer.url;
  if (handoverOff) panelEnter.hidden = panelWalk.hidden = true;
  q('[data-k=attr]').textContent = `${index.name_de}. Quellen: ${attributionEntries(index.attribution).join(' · ') || '–'}`;
  sec.root.hidden = false;

  // ---- toolbar buttons (only while the layer is on and the camera is near) -------------------
  const tb = document.createElement('span');
  tb.className = 'sle-recon-enter';
  tb.setAttribute('role', 'group');
  tb.setAttribute('aria-label', 'Schloss betreten');
  tb.hidden = true;
  tb.innerHTML = `
    <button type="button" data-act="enter" title="Im Schloss-Viewer an dieser Position weiterfliegen (Taste T; Umschalt+Klick: zu Fuß)">Schloss betreten <kbd>T</kbd></button>
    <button type="button" data-act="walk" title="Im Schloss-Viewer zu Fuß am nächsten Eingang beginnen (Umschalt+T)">zu Fuß</button>`;
  deps.toolbar?.appendChild(tb);

  // ---- attribution footer ----------------------------------------------------------------------
  const footerSpan = document.createElement('span');
  footerSpan.className = 'sle-recon-attr';
  const entries = attributionEntries(index.attribution);
  footerSpan.textContent = ` · ${reconFooterText(entries)}`;

  // ---- minimap footprints -----------------------------------------------------------------------
  const mapLayer = L.layerGroup();
  let footprints: ReconFootprint[] = [];
  const footprintPolys = new Map<ReconFootprint, L.Polygon>();
  const aoiRect = { origin: manifest.origin, width: manifest.size.width * manifest.cellSize, height: manifest.size.height * manifest.cellSize };
  /** Draw only the footprints whose building the 3D layer shows on this AOI (no fly-off-terrain clicks). */
  const syncFootprints = () => {
    for (const [f, poly] of footprintPolys) {
      const show = footprintShownOnAoi(f, aoiRect, layer.partShown(f.id));
      if (show !== mapLayer.hasLayer(poly)) {
        if (show) mapLayer.addLayer(poly);
        else mapLayer.removeLayer(poly);
      }
    }
  };
  const loadFootprints = async () => {
    if (!index.files.footprints || footprints.length) return;
    try {
      footprints = parseFootprints(await fetchJson(baseUrl + index.files.footprints), index.buildings);
    } catch (err) {
      console.warn('[reconstruction] footprints not loaded:', err instanceof Error ? err.message : err);
      return;
    }
    for (const f of footprints) {
      const col = hexCss(CONF_COLORS[f.confidence]);
      const latlngs = f.polygons.map((rings) =>
        rings.map((ring) =>
          ring.map(([E, N]) => {
            const ll = utmToWgs84(E, N);
            return [ll.lat, ll.lon] as L.LatLngTuple;
          }),
        ),
      );
      const poly = L.polygon(latlngs, {
        color: col,
        weight: 1.5,
        fillColor: col,
        fillOpacity: 0.15,
        dashArray: f.confidence === 'low' ? '4 3' : undefined, // not by colour alone
        bubblingMouseEvents: false, // our click flies to the building; no second flight
      });
      poly.bindTooltip(`${esc(f.name_de)}<br><small>Rekonstruktion 1789 · Konfidenz ${CONF_LABELS_DE[f.confidence]}</small>`, { sticky: true });
      poly.on('click', () => {
        select(f.id);
        const c = footprintCentre(f);
        void ctx.flyTo(c.E, c.N, { agl: 90, pitch: -30, lookAt: true });
      });
      footprintPolys.set(f, poly);
    }
    syncFootprints();
  };

  // ---- state ---------------------------------------------------------------------------------
  let on = false;
  let near = false;

  const cameraEN = () => {
    const p = camera.position;
    return worldToUtm(p.x, p.z, origin);
  };
  const inRange = () => {
    const { E, N } = cameraEN();
    return withinEnterRadius(E, N, index.anchor);
  };

  const showStatus = () => {
    if (!on) status.textContent = 'aus';
    else if (layer.state === 'loading') status.textContent = 'lädt …';
    else if (layer.state === 'failed') status.textContent = 'nicht geladen';
    else if (layer.state === 'ready') status.textContent = `${layer.stats.triangles.toLocaleString('de-DE')} Dreiecke`;
    else status.textContent = '';
  };
  layer.onChange(showStatus);
  layer.onChange(syncFootprints);

  let hintActive = false;
  const syncNear = (force = false) => {
    const { E, N } = cameraEN();
    const n = on && withinEnterRadius(E, N, index.anchor);
    if (n !== near || force) {
      near = n;
      tb.hidden = !near || handoverOff;
      panelEnter.disabled = !near;
      panelWalk.disabled = !near;
    }
    if (hintActive) return;
    // Distance in 10 m steps: the text (and the DOM) changes rarely while flying.
    const d = Math.round(anchorDistance(E, N, index.anchor) / 10) * 10;
    const text = !on
      ? 'Zum Betreten die Ebene einschalten.'
      : near
        ? 'Öffnet den Schloss-Viewer an Ihrer Position und Blickrichtung (gleiches Fenster; dort „Zurück zur Karte“).'
        : `Betreten ist im Umkreis von ${radiusTxt} um das Schloss möglich (jetzt ≈ ${d.toLocaleString('de-DE')} m entfernt).`;
    if (rangeHint.textContent !== text) rangeHint.textContent = text;
  };

  const sync = () => {
    cb.checked = on;
    for (const b of sec.body.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      const active = b.dataset.mode === prefs.mode;
      b.classList.toggle('on', active);
      b.setAttribute('aria-pressed', String(active));
    }
    q('[data-k=legend]').hidden = prefs.mode !== 'confidence';
    opacity.value = String(prefs.opacity);
    opv.textContent = `${Math.round(prefs.opacity * 100)} %`;
    layer.setColorMode(prefs.mode);
    layer.setOpacity(prefs.opacity);
    syncNear(true);
    showStatus();
  };

  const setOn = (v: boolean) => {
    on = v;
    prefs.on = v;
    writePrefs(prefs);
    layer.visible = v;
    const footer = document.querySelector<HTMLElement>('#attribution');
    if (v) {
      void layer.load();
      void loadFootprints();
      if (deps.minimap) mapLayer.addTo(deps.minimap.map);
      if (footer && !footerSpan.isConnected) footer.appendChild(footerSpan);
    } else {
      layer.unload(); // free GPU memory; re-fetching hits the HTTP cache
      mapLayer.remove();
      footerSpan.remove();
      select(null);
    }
    sync();
  };

  // ---- info card ---------------------------------------------------------------------------------
  function select(id: string | null): void {
    layer.select(id);
    if (!id) {
      detail.hidden = true;
      detail.replaceChildren();
      return;
    }
    const b = index.buildings.find((x) => x.id === id) ?? null;
    const site = id.startsWith('site:');
    const conf = b?.confidence;
    detail.innerHTML = `
      <div class="sle-recon-head">
        ${conf ? `<i style="background:${hexCss(CONF_COLORS[conf])}" title="Konfidenz ${CONF_LABELS_DE[conf]}"></i>` : ''}
        <b data-k="name"></b><span class="sle-spacer"></span>
        <button type="button" class="sle-btn" data-act="close" aria-label="Info schließen" title="Schließen">×</button>
      </div>
      <div class="sle-dim sle-small" data-k="meta"></div>
      <ul class="sle-recon-sources" data-k="src"></ul>
      <p class="sle-recon-warn" data-k="disc"></p>
      <p class="sle-dim sle-small" data-k="attr"></p>`;
    const d = <T extends HTMLElement = HTMLElement>(sel: string) => detail.querySelector<T>(sel)!;
    d('[data-k=name]').textContent = b?.name_de ?? (site ? `Anlage ${id.slice(5)}` : id);
    const meta: string[] = [b ? b.id : id];
    if (b?.cls) meta.push(b.cls);
    if (conf) meta.push(`Konfidenz ${CONF_LABELS_DE[conf]}`);
    if (b?.eaves_h !== undefined) meta.push(`Traufe ${fmtM(b.eaves_h)} ü. NN`);
    if (b?.ridge_h !== undefined) meta.push(`First ${fmtM(b.ridge_h)} ü. NN`);
    d('[data-k=meta]').textContent = meta.join(' · ');
    const src = d('[data-k=src]');
    for (const s of b?.sources_de ?? []) {
      const li = document.createElement('li');
      li.textContent = s;
      src.appendChild(li);
    }
    src.hidden = !b?.sources_de.length;
    d('[data-k=disc]').textContent = `${index.disclaimer_de} Stand: Sommer 1789, keine Grabungsbefunde.`;
    d('[data-k=attr]').textContent = entries.length ? `Quellen: ${entries.join(' · ')}` : '';
    d('[data-act=close]').addEventListener('click', () => select(null));
    detail.hidden = false;
    openPanelSection(sec);
    detail.scrollIntoView({ block: 'nearest' }); // the card sits far down the panel
  }

  // ---- handover ---------------------------------------------------------------------------------
  const handoverUrl = (mode: HandoverMode): string => {
    const p = camera.position;
    const { E, N } = worldToUtm(p.x, p.z, origin);
    const u = terrain.uniforms;
    const h = trueHeightFromDisplay(p.y, u.uHRef.value, u.uExag.value);
    const pose = { E, N, h, heading: controller.heading, pitch: controller.pitch };
    // The hash is throttled (400 ms): rebuild it from the store with the live pose.
    const back = shareUrl(location, { ...store.get(), ...pose });
    return buildViewerUrl(viewerUrl, pose, mode, back);
  };

  const enter = (mode: HandoverMode): boolean => {
    if (handoverOff) return false;
    if (!on) {
      flashHint('Erst die Ebene „Rekonstruktion“ einschalten (Taste R).');
      return false;
    }
    if (!inRange()) {
      flashHint(`Zum Betreten näher als ${radiusTxt} an das Schloss fliegen.`);
      return false;
    }
    let url: string;
    try {
      url = handoverUrl(mode);
    } catch (err) {
      console.warn('[reconstruction] handover:', err);
      return false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    location.assign(url);
    return true;
  };

  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const flashHint = (text: string) => {
    openPanelSection(sec);
    hintActive = true;
    rangeHint.textContent = text;
    rangeHint.classList.add('sle-recon-flash');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintActive = false;
      rangeHint.classList.remove('sle-recon-flash');
      syncNear(true);
    }, 3000);
  };

  // ---- events ---------------------------------------------------------------------------------
  cb.addEventListener('change', () => setOn(cb.checked));
  for (const b of sec.body.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    b.addEventListener('click', () => {
      prefs.mode = b.dataset.mode === 'confidence' ? 'confidence' : 'material';
      writePrefs(prefs);
      sync();
    });
  }
  opacity.addEventListener('input', () => {
    prefs.opacity = parseReconPrefs({ opacity: Number(opacity.value) }).opacity;
    writePrefs(prefs);
    sync();
  });
  q('[data-act=fly]').addEventListener('click', () => {
    if (!on) setOn(true);
    void ctx.flyTo(index.anchor.E, index.anchor.N, { agl: 140, pitch: -30, lookAt: true });
  });
  const onEnterClick = (e: MouseEvent, mode: HandoverMode) => enter(e.shiftKey ? 'gehen' : mode);
  panelEnter.addEventListener('click', (e) => onEnterClick(e, 'fliegen'));
  panelWalk.addEventListener('click', () => enter('gehen'));
  tb.querySelector<HTMLButtonElement>('[data-act=enter]')!.addEventListener('click', (e) => onEnterClick(e, 'fliegen'));
  tb.querySelector<HTMLButtonElement>('[data-act=walk]')!.addEventListener('click', () => enter('gehen'));

  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyR') setOn(!on);
    else if (e.code === 'KeyT') enter(e.shiftKey ? 'gehen' : 'fliegen');
  });

  store.subscribe(() => syncNear(), ['E', 'N']);

  // Picking: a plain click on the model opens its info card (instead of capturing the mouse);
  // with the mouse captured, a click picks under the crosshair. Inactive while a click tool
  // (Fundmarker, Messen) has taken the click (lockOnClick = false).
  const canvas = renderer.domElement;
  let down: { x: number; y: number; t: number } | null = null;
  const ndc = new Vector2();
  const pickRaycaster = new Raycaster();
  const pickClient = (x: number, y: number): ReconPick | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    const rc = pickRaycaster;
    rc.setFromCamera(ndc, camera);
    const hit = layer.pick(rc.ray);
    if (!hit) return null;
    // Terrain in front of the building (e.g. a hill) wins.
    const t = terrain.intersectRay(rc.ray);
    if (t && t.distanceTo(rc.ray.origin) < hit.distance - 0.5) return null;
    return hit;
  };
  window.addEventListener(
    'pointerdown',
    (e) => {
      down = e.target === canvas && e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    },
    true,
  );
  window.addEventListener(
    'pointerup',
    (e) => {
      const d = down;
      down = null;
      if (!on || layer.state !== 'ready' || e.button !== 0 || e.target !== canvas) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked && !controller.opts.lockOnClick) return; // a click tool is active
      if (!locked && (!d || Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4 || performance.now() - d.t > 500)) return;
      const r = canvas.getBoundingClientRect();
      const hit = locked ? pickClient(r.left + r.width / 2, r.top + r.height / 2) : pickClient(e.clientX, e.clientY);
      if (!hit) return;
      select(hit.id);
      if (!locked) {
        // Runs before the controller's own pointerup (window capture): skip its pointer lock once.
        controller.opts.lockOnClick = false;
        setTimeout(() => (controller.opts.lockOnClick = true), 0);
      }
    },
    true,
  );

  const prev = scene.onBeforeRender.bind(scene);
  (scene as Scene).onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
    prev(...args);
    if (args[2] === camera) layer.update(camera);
  };

  setOn(prefs.on);

  const api: ReconApi = {
    index,
    layer,
    get on() {
      return on;
    },
    setOn,
    inRange,
    handoverUrl,
    enter,
    select,
  };
  window.sleRecon = api; // feature check (HUD rows) + debug/verification handle
  window.dispatchEvent(new Event(FEATURES_EVENT));
  return api;
}
