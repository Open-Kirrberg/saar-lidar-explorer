/**
 * V2.6b: zone portals in the overworld (Standard tier). Loads the zone index for the AOI (+ built-in
 * Testraum), draws a marker per portal, offers *Betreten* near one (shell prompt, key E), runs the
 * overworld ↔ zone flow (flow.ts) with the shell's loading screen and an in-zone *Verlassen* chrome (Esc).
 * The minimap (V2.3) reads `zonePortals()` / `onZonePortals()` instead of being edited here.
 */
import { Color } from 'three';
import type { AppContext } from '../../main';
import { dataRootUrl } from '../../data/manifest';
import { worldToUtm } from '../../geo';
import type { FeatureHost } from '../../shell/types';
import { el } from '../../shell/dom';
import { isTyping } from '../../ui/keys';
import { modalOpen } from '../../ui/modalKeys';
import type { EN, ZoneManifest } from '../contract';
import { loadZones, zoneBadge_de } from '../contract';
import type { ZoneSessionState } from '../session';
import type { ZoneModule } from './api';
import { builtinZones, builtinZonesEnabled } from './builtin';
import { createPortalPrompter, createZoneFlow, MSG_NO_RUNTIME } from './flow';
import type { ZoneFlow } from './flow';
import { PortalMarker } from './marker';
import { overworldPose, restoreRig, rigSnapshot } from './overworld';
import type { RigSnapshot } from './overworld';
import { GLTF_RUNTIME, ZONE_MODULES, zoneModuleNames } from './modules';
import { overworldTreeSource } from './sharedTrees';
import './zones.css';

/** One portal for the minimap / tutorial. */
export interface ZonePortalInfo {
  zoneId: string;
  portalId: string;
  name_de: string;
  label_de: string;
  E: number;
  N: number;
  radius_m: number;
  facing_deg: number;
  kind: ZoneManifest['kind'];
}

/** Opaque overworld state saved on enter (exact restore when the exaggeration is unchanged). */
export interface OverworldSnapshot extends RigSnapshot {
  renderer: RendererState;
}

interface RendererState {
  toneMapping: number;
  exposure: number;
  outputColorSpace: string;
  autoClear: boolean;
  clear: number;
  clearAlpha: number;
  shadows: boolean;
  pixelRatio: number;
}

export interface ZonesApi {
  portals(): ZonePortalInfo[];
  zones(): readonly ZoneManifest[];
  state(): ZoneSessionState<OverworldSnapshot>['phase'];
  /** Enter a zone (first portal unless named) as if *Betreten* was pressed. */
  enter(zoneId: string, portalId?: string): Promise<void>;
  exit(): void;
  cancel(): void;
  /** Debug: the flow (handle, session state). */
  readonly flow: ZoneFlow<OverworldSnapshot> | null;
}

let portalList: ZonePortalInfo[] = [];
const portalListeners = new Set<(p: readonly ZonePortalInfo[]) => void>();

/** Portals of the zones loaded for this AOI (empty until the index loaded). */
export const zonePortals = (): readonly ZonePortalInfo[] => portalList;
/** Called with the list whenever it changes (also once right away). Returns an unsubscribe. */
export function onZonePortals(cb: (p: readonly ZonePortalInfo[]) => void): () => void {
  portalListeners.add(cb);
  cb(portalList);
  return () => portalListeners.delete(cb);
}
const setPortals = (p: ZonePortalInfo[]) => {
  portalList = p;
  for (const cb of portalListeners) cb(p);
};

export const portalInfos = (zones: readonly ZoneManifest[]): ZonePortalInfo[] =>
  zones.flatMap((z) =>
    z.portals.map((p) => ({
      zoneId: z.id,
      portalId: p.id,
      name_de: z.name_de,
      label_de: p.label_de,
      E: p.E,
      N: p.N,
      radius_m: p.radius_m,
      facing_deg: p.facing_deg,
      kind: z.kind,
    })),
  );

/** Prompt line for a zone: „<Name> betreten“. */
export const promptText = (z: Pick<ZoneManifest, 'name_de'>): string => `${z.name_de} betreten`;

/** Built-ins first, fetched packages win on the same id; zones without a runtime in this build drop out. */
export function mergeZones(
  builtin: readonly ZoneManifest[],
  fetched: readonly ZoneManifest[],
  warn: (m: string) => void,
  runtimes: { modules: Readonly<Record<string, unknown>>; gltf: boolean } = { modules: ZONE_MODULES, gltf: !!GLTF_RUNTIME },
): ZoneManifest[] {
  const byId = new Map<string, ZoneManifest>();
  for (const z of [...builtin, ...fetched]) byId.set(z.id, z);
  return [...byId.values()].filter((z) => {
    if (z.runtime.kind === 'module' && runtimes.modules[z.runtime.module]) return true;
    if (z.runtime.kind === 'gltf' && runtimes.gltf) return true;
    warn(`[zone ${z.id}] runtime ${z.runtime.kind} not in this build, zone absent`);
    return false;
  });
}

async function loadModule(zone: ZoneManifest): Promise<ZoneModule> {
  const loader = zone.runtime.kind === 'module' ? ZONE_MODULES[zone.runtime.module] : GLTF_RUNTIME;
  if (!loader) throw Object.assign(new Error(`no runtime for ${zone.id}`), { userMessage: MSG_NO_RUNTIME });
  const m = (await loader()) as ZoneModule & { default?: ZoneModule };
  const mod = typeof m.mountZone === 'function' ? m : m.default;
  if (!mod || typeof mod.mountZone !== 'function') throw new Error(`zone module ${zone.id} has no mountZone`);
  return mod;
}

const fetchJson = async (path: string): Promise<unknown> => {
  const res = await fetch(`${dataRootUrl()}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
};

function aoiBbox(ctx: AppContext): [EN, EN] {
  const { origin, size } = ctx.manifest;
  return [
    [origin.E0, origin.N0],
    [origin.E0 + size.width, origin.N0 + size.height],
  ];
}

const evidenceBadge = zoneBadge_de;

export function mountZones(h: FeatureHost): () => void {
  const { ctx, shell } = h;
  const { camera, controller, terrain, renderer, manifest } = ctx;
  const origin = manifest.origin;
  const appEl = document.getElementById('app') ?? document.body;
  let zones: ZoneManifest[] = [];
  let markers: PortalMarker[] = [];
  let disposed = false;
  const warned = new Set<string>();
  const warn = (m: string) => {
    if (warned.has(m)) return;
    warned.add(m);
    console.warn(`[zones] ${m}`);
  };

  // ---- overworld port --------------------------------------------------------------------------------
  const rendererState = (): RendererState => ({
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
    autoClear: renderer.autoClear,
    clear: renderer.getClearColor(new Color()).getHex(),
    clearAlpha: renderer.getClearAlpha(),
    shadows: renderer.shadowMap.enabled,
    pixelRatio: renderer.getPixelRatio(),
  });
  const flow = createZoneFlow<OverworldSnapshot>({
    overworld: {
      pose: () => overworldPose(controller, terrain, origin, shell.moveMode() === 'walk'),
      snapshot: () => ({ ...rigSnapshot(controller, terrain.uniforms.uExag.value), renderer: rendererState() }),
      restore(p, snap) {
        if (snap?.renderer) {
          const r = snap.renderer;
          renderer.setRenderTarget(null);
          renderer.toneMapping = r.toneMapping as typeof renderer.toneMapping;
          renderer.toneMappingExposure = r.exposure;
          renderer.outputColorSpace = r.outputColorSpace as typeof renderer.outputColorSpace;
          renderer.autoClear = r.autoClear;
          renderer.setClearColor(r.clear, r.clearAlpha);
          renderer.shadowMap.enabled = r.shadows;
          if (renderer.getPixelRatio() !== r.pixelRatio) renderer.setPixelRatio(r.pixelRatio);
        }
        restoreRig(controller, terrain, origin, p, snap, terrain.uniforms.uExag.value);
      },
      freeze(on) {
        controller.cancelTween();
        controller.enabled = !on;
        if (on && controller.locked) document.exitPointerLock();
        appEl.classList.toggle('sle-zone-active', on);
      },
    },
    loadModule,
    mountContext(zone) {
      const container = el('div', { class: 'sle-zone-layer', 'data-zone': zone.id });
      shell.slots.overlay.appendChild(container);
      return {
        container,
        renderer,
        baseUrl: `${dataRootUrl()}zones/${zone.id}/`,
        manifest: zone,
        tier: shell.tier(),
        quality: shell.quality?.() ?? 'auto',
        footprintEN: zone.footprint.map(([E, N]) => [E, N] as [number, number]),
        // V2.7: today's CHM trees around the footprint (the zone decides what it draws of them)
        trees: zone.preset.trees === 'shared' ? overworldTreeSource(manifest, terrain.baseUrl) : undefined,
        release: () => container.remove(),
      };
    },
    loading(zone, onCancel) {
      const scr = shell.loading(zone.name_de);
      const cancel = el('button', { type: 'button', class: 'sle-btn', text: 'Abbrechen' });
      cancel.append(' ', el('kbd', { text: 'Esc' }));
      cancel.addEventListener('click', onCancel);
      const info = el(
        'div',
        { class: 'sle-zone-loadinfo' },
        el('span', { class: 'sle-zone-badge', text: evidenceBadge(zone) }),
        zone.summary_de ? el('p', { class: 'sle-zone-summary', text: zone.summary_de }) : null,
        el('p', { class: 'sle-zone-disclaimer', text: zone.evidence.disclaimer_de }),
        el('p', { class: 'sle-zone-attr', text: zone.attribution.join('; ') }),
        cancel,
      );
      shell.slots.overlay.appendChild(info);
      cancel.focus({ preventScroll: true });
      return {
        progress: (p, t) => scr.progress(p, t),
        close: () => {
          scr.close();
          info.remove();
        },
      };
    },
    chrome(zone, onExit) {
      const leave = el('button', { type: 'button', class: 'sle-btn primary sle-zone-leave', text: 'Verlassen', 'aria-label': `${zone.name_de} verlassen` });
      leave.append(' ', el('kbd', { text: 'Esc' }));
      leave.addEventListener('click', onExit);
      const box = el(
        'div',
        { class: 'sle-zone-chrome' },
        el('div', { class: 'sle-zone-top' }, el('div', { class: 'sle-zone-title' }, el('strong', { text: zone.name_de }), el('span', { class: 'sle-zone-badge', text: evidenceBadge(zone) })), leave),
        el('p', { class: 'sle-zone-foot', text: `${zone.evidence.disclaimer_de} · ${zone.attribution.join('; ')}` }),
      );
      shell.slots.overlay.appendChild(box);
      return { close: () => box.remove() };
    },
    ownFrames: (fn) => ctx.setFrameOwner(fn),
    viewSize: () => [renderer.domElement.clientWidth || window.innerWidth, renderer.domElement.clientHeight || window.innerHeight],
    message: (t) => shell.toast(t, true),
    warn: (m, err) => console.warn(`[zones] ${m}`, err ?? ''),
  });

  // ---- portals: markers, labels, prompt ----------------------------------------------------------------
  const enterFocus = () => {
    const f = prompter.focus();
    const z = f && zones.find((x) => x.id === f.zoneId);
    if (!f || !z || flow.state().phase !== 'overworld') return;
    prompter.close();
    void flow.enter(z, f.portalId);
  };
  const prompter = createPortalPrompter(
    () => zones,
    (f) => {
      const z = zones.find((x) => x.id === f.zoneId)!;
      return shell.prompt({ text: promptText(z), action: 'Betreten', keyHint: 'E', onAction: enterFocus });
    },
  );

  const setZones = (list: ZoneManifest[]) => {
    for (const m of markers) m.dispose();
    h.services.labels.clearGroup('zone-portals');
    zones = list;
    markers = [];
    for (const z of zones) {
      for (const p of z.portals) {
        const m = new PortalMarker(p, origin);
        ctx.scene.add(m.group);
        markers.push(m);
        const label = el('div', { class: 'sle-zone-label' }, el('strong', { text: z.name_de }), el('span', { text: evidenceBadge(z) }));
        h.services.labels.set(`zone:${z.id}:${p.id}`, 'zone-portals', p.E, p.N, label, { lift: 14, maxDistance: 8000 });
      }
    }
    setPortals(portalInfos(zones));
  };

  // a tier change while inside a zone reaches the zone (V2.7: the castle's HUD is tiered too)
  const offTier = shell.onTier((t) => flow.handle()?.setTier?.(t));

  const offFrame = ctx.onFrame((dt) => {
    if (flow.state().phase !== 'overworld') return;
    for (const m of markers) m.update(dt, camera, terrain);
    const { E, N } = worldToUtm(camera.position.x, camera.position.z, origin);
    prompter.update(E, N);
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const phase = flow.state().phase;
    if (phase === 'overworld') {
      // While a portal is offered, E means „Betreten“ (not „steigen“; Space still climbs).
      if (e.code === 'KeyE' && !e.repeat && prompter.focus() && !modalOpen(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        enterFocus();
      }
    } else if (e.key === 'Escape' && !modalOpen(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (phase === 'loading') flow.cancel();
      else flow.exit();
    }
  };
  window.addEventListener('keydown', onKey, true);

  const builtins = builtinZonesEnabled({ dev: !!import.meta.env?.DEV, aoi: manifest.aoi, search: location.search }) ? builtinZones() : [];
  setZones(mergeZones(builtins, [], warn));
  void loadZones(fetchJson, aoiBbox(ctx), { modules: zoneModuleNames(), warn }).then((fetched) => {
    if (!disposed && fetched.length) setZones(mergeZones(builtins, fetched.map((f) => f.manifest), warn));
  });

  const api: ZonesApi = {
    portals: () => [...portalList],
    zones: () => zones,
    state: () => flow.state().phase,
    async enter(zoneId, portalId) {
      const z = zones.find((x) => x.id === zoneId);
      const p = portalId ?? z?.portals[0]?.id;
      if (z && p) {
        prompter.close();
        await flow.enter(z, p);
      }
    },
    exit: () => flow.exit(),
    cancel: () => flow.cancel(),
    flow,
  };
  ctx.zones = api;

  return () => {
    disposed = true;
    if (flow.state().phase !== 'overworld') flow.exit();
    window.removeEventListener('keydown', onKey, true);
    offTier();
    offFrame();
    prompter.close();
    for (const m of markers) m.dispose();
    markers = [];
    h.services.labels.clearGroup('zone-portals');
    setPortals([]);
    if (ctx.zones === api) ctx.zones = undefined;
  };
}

/** Register the Standard feature `zone-portals` (main.ts). */
export function registerZones(ctx: AppContext): () => void {
  return ctx.shell.registerFeature({
    id: 'zone-portals',
    tier: 'standard',
    label: 'Orte betreten (Portale)',
    shortcuts: [
      { group: 'Flug', keys: ['E'], label: 'am Portal: Ort betreten', short: 'Ort betreten', codes: ['KeyE'], feature: 'zone-portals' },
      { group: 'Flug', keys: ['Esc'], label: 'im Ort: verlassen', short: 'Ort verlassen', codes: ['Escape'], feature: 'zone-portals' },
    ],
    mount: (h) => mountZones(h),
  });
}
