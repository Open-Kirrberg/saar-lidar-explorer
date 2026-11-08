/**
 * Catalog mode (S2): per-place content in 3D — CHM trees and LoD2 buildings of every ready place.
 * Each place's layers live in a Group at the place's offset from the session origin
 * (`(E0 − Es, 0, −(N0 − Ns))`, contract "Multi-origin"); their buffers stay local to the place's own
 * origin. Content belongs to exactly one tile of one place (contract rule 6), so neighbours never
 * draw an object twice. The layers stream around a per-place proxy camera (camera − offset).
 *
 * Feature parity with single-AOI mode (same ids, prefs and handles):
 * - 🟢 `trees`: the „Bäume“ switch in *Einstellungen* (localStorage `sle.trees.v1`) for all places;
 *   `window.sleTrees` fans the Relikt-Blick lens fade out to every place's trees.
 * - 🟢 `tree-card`: the Baum-Steckbrief over all places' trees (each picked in its own frame); the
 *   Gemeinde row comes from the catalog's leaderboard (Gemeinde level).
 * - 🟢 `buildings` (replaces the single-AOI registration; card in Labor): „Gebäude“ switch + `G`
 *   (localStorage `sle.buildings.v1`) for all places.
 */
import { Group, PerspectiveCamera } from 'three';
import type { Camera } from 'three';
import { BuildingLayer } from '../buildings/BuildingLayer';
import { utmToWorld } from '../geo';
import type { AppContext } from '../main';
import type { FeatureHost } from '../shell/types';
import { mountTreesSettings, TREE_CARD_FEATURE, TREES_FEATURE } from '../trees';
import type { TreesApi, TreeStats } from '../trees';
import { mountTreeCardFor } from '../trees/TreeCard';
import type { TreeCardSource } from '../trees/TreeCard';
import { TreeLayer } from '../trees/TreeLayer';
import { isTyping } from '../ui/keys';
import { createPanelSection } from '../ui/panelSection';

interface PlaceEntry {
  group: Group;
  cam: PerspectiveCamera;
  trees: TreeLayer | null;
  buildings: BuildingLayer | null;
  /** Tree-card source (stable object while the place is ready). */
  card: TreeCardSource | null;
}

export interface PlaceContentApi {
  /** Place id → its content layers (verification handle). */
  readonly places: ReadonlyMap<string, { trees: TreeLayer | null; buildings: BuildingLayer | null; offset: { x: number; z: number } }>;
  treeCount(): number;
  readonly treesOn: boolean;
  readonly buildingsOn: boolean;
  setTreesOn(on: boolean): void;
  setBuildingsOn(on: boolean): void;
}

const TREES_KEY = 'sle.trees.v1';
const BLDG_KEY = 'sle.buildings.v1';

export function installPlaceContent(ctx: AppContext): PlaceContentApi | null {
  const cat = ctx.catalog;
  if (!cat) return null;
  const entries = new Map<string, PlaceEntry>();
  const root = new Group();
  root.name = 'PlaceContent';
  ctx.scene.add(root);
  let treesOn = pref(TREES_KEY);
  let bldgOn = pref(BLDG_KEY);
  let lensFade = 0;
  const forestOff = () => ctx.store.get().forest === 'off';
  const treesVisible = () => treesOn && lensFade < 1 && forestOff();
  const listeners = new Set<() => void>();

  const sync = () => {
    const ready = new Map(cat.places.ready().map((r) => [r.place.id, r] as const));
    for (const [id, e] of entries) {
      if (ready.has(id)) continue;
      e.trees?.dispose();
      e.buildings?.dispose();
      root.remove(e.group);
      entries.delete(id);
    }
    for (const [id, r] of ready) {
      if (entries.has(id)) continue;
      const m = r.manifest;
      const o = utmToWorld(m.origin.E0, m.origin.N0, ctx.manifest.origin);
      const group = new Group();
      group.name = `place ${id}`;
      group.position.set(o.x, 0, o.z);
      group.updateMatrix();
      const view = { manifest: m, baseUrl: r.baseUrl, uniforms: ctx.terrain.uniforms, streaming: ctx.terrain.streaming };
      const trees = m.trees && m.trees.chunks.length ? new TreeLayer(m.trees, view) : null;
      const bm = m.models?.buildings;
      const buildings = bm && bm.chunks.length ? new BuildingLayer(bm, view, r.baseUrl) : null;
      if (trees) {
        trees.treeUniforms.uLensFade.value = lensFade;
        trees.visible = treesVisible();
        group.add(trees);
      }
      if (buildings) {
        buildings.visible = bldgOn;
        group.add(buildings);
      }
      root.add(group);
      const card = trees ? { layer: trees, manifest: m, baseUrl: r.baseUrl, offset: { x: o.x, z: o.z } } : null;
      entries.set(id, { group, cam: new PerspectiveCamera(), trees, buildings, card });
    }
    for (const fn of listeners) fn();
  };
  cat.places.onChange(sync);
  sync();

  const proxy = (e: PlaceEntry, camera: Camera): PerspectiveCamera => {
    e.cam.position.copy(camera.position).sub(e.group.position);
    e.cam.quaternion.copy(camera.quaternion);
    return e.cam;
  };
  ctx.onFrame((dt) => {
    const showTrees = treesVisible();
    for (const e of entries.values()) {
      const cam = proxy(e, ctx.camera);
      if (e.trees) {
        e.trees.visible = showTrees;
        e.trees.update(cam, dt);
      }
      if (e.buildings) {
        e.buildings.visible = bldgOn;
        if (bldgOn) e.buildings.update(cam);
      }
    }
  });

  const setTreesOn = (on: boolean) => {
    treesOn = on;
    for (const e of entries.values()) if (e.trees) e.trees.visible = treesVisible();
  };
  const setBuildingsOn = (on: boolean) => {
    bldgOn = on;
    writePref(BLDG_KEY, on);
    for (const e of entries.values()) {
      if (!e.buildings) continue;
      e.buildings.visible = on;
      if (!on) e.buildings.clearAll(); // free GPU memory; re-fetching hits the HTTP cache
    }
    for (const fn of listeners) fn();
  };

  // ---- window.sleTrees: lens fade + verification over all places (trees/index.ts TreesApi) ----------
  const treesApi: TreesApi = {
    available: true,
    get visible() {
      return treesVisible();
    },
    get on() {
      return treesOn;
    },
    update() {}, // driven by onFrame above
    setVisible: setTreesOn,
    setLensFade(f) {
      lensFade = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0));
      for (const e of entries.values()) if (e.trees) e.trees.treeUniforms.uLensFade.value = lensFade;
    },
    stats: (): TreeStats | null => {
      const all = [...entries.values()].flatMap((e) => (e.trees ? [e.trees.stats()] : []));
      if (!all.length) return null;
      const sum: TreeStats = { ...all[0], instances: { ...all[0].instances } };
      for (const s of all.slice(1)) {
        for (const k of ['listed', 'resident', 'loading', 'failed', 'pending', 'trees', 'meshes', 'triangles', 'gpuBytes'] as const) sum[k] += s[k];
        for (const k of Object.keys(sum.instances) as Array<keyof TreeStats['instances']>) sum.instances[k] += s.instances[k] ?? 0;
      }
      return sum;
    },
    get layer() {
      return [...entries.values()].find((e) => e.trees)?.trees ?? null;
    },
    dispose() {},
  };
  window.sleTrees = treesApi;

  // ---- features (same ids as single-AOI mode) -----------------------------------------------------------
  let sources: TreeCardSource[] = [];
  let sourcesKey = '';
  const cardSources = (): readonly TreeCardSource[] => {
    const key = [...entries.keys()].join(',');
    if (key !== sourcesKey) {
      sourcesKey = key;
      sources = [...entries.values()].flatMap((e) => (e.card ? [e.card] : []));
    }
    return sources;
  };
  const shell = ctx.shell;
  shell.registerFeature({
    id: TREES_FEATURE.id,
    tier: TREES_FEATURE.tier,
    label: TREES_FEATURE.label,
    mount: (h) => mountTreesSettings(h, treesApi),
  });
  const lb = cat.leaderboard;
  shell.registerFeature({
    id: TREE_CARD_FEATURE.id,
    tier: TREE_CARD_FEATURE.tier,
    label: TREE_CARD_FEATURE.label,
    mount: (h) => mountTreeCardFor(h, cardSources, lb ? { meta: lb.meta, baseUrl: lb.baseUrl, rowLabel: 'Gemeinde' } : null),
  });

  const api: PlaceContentApi = {
    get places() {
      const out = new Map<string, { trees: TreeLayer | null; buildings: BuildingLayer | null; offset: { x: number; z: number } }>();
      for (const [id, e] of entries) out.set(id, { trees: e.trees, buildings: e.buildings, offset: { x: e.group.position.x, z: e.group.position.z } });
      return out;
    },
    treeCount: () => [...entries.values()].reduce((a, e) => a + (e.trees?.stats().trees ?? 0), 0),
    get treesOn() {
      return treesOn;
    },
    get buildingsOn() {
      return bldgOn;
    },
    setTreesOn,
    setBuildingsOn,
  };
  shell.registerFeature({
    id: 'buildings',
    replaces: 'buildings',
    tier: 'standard',
    panelTier: 'labor',
    label: 'Gebäude (LoD2)',
    mount: (h) => mountBuildingsCard(h, api, () => [...entries.values()].flatMap((e) => (e.buildings ? [e.buildings] : [])), listeners),
  });
  (window as unknown as { slePlaces?: PlaceContentApi }).slePlaces = api;
  return api;
}

/** „Gebäude“ card (Werkzeuge drawer, Labor) + key `G` for all places' buildings. */
function mountBuildingsCard(h: FeatureHost, api: PlaceContentApi, layers: () => BuildingLayer[], listeners: Set<() => void>): () => void {
  const sec = createPanelSection(h.panel, 'buildings', 'Gebäude', false);
  sec.body.innerHTML = `
    <div class="sle-row">
      <label title="3D-Gebäude (LoD2) der Orte im Umkreis von ca. 2 km (Taste G)"><input type="checkbox" data-k="on"> Gebäude (LoD2) <kbd>G</kbd></label>
      <span class="sle-dim sle-bldg-status"></span>
    </div>
    <p class="sle-dim sle-small">Nur in Orten mit 3D-Modell.</p>`;
  const cb = sec.body.querySelector<HTMLInputElement>('[data-k=on]')!;
  const status = sec.body.querySelector<HTMLElement>('.sle-bldg-status')!;
  const show = () => {
    cb.checked = api.buildingsOn;
    if (!api.buildingsOn) {
      status.textContent = 'aus';
      return;
    }
    let resident = 0;
    let pending = 0;
    let failed = 0;
    for (const l of layers()) {
      resident += l.stats.resident;
      pending += l.stats.pending;
      failed += l.stats.failed;
    }
    const parts = [`${resident} Kacheln`];
    if (pending > 0) parts.push(`lädt … ${pending}`);
    if (failed > 0) parts.push(`${failed} fehlgeschlagen`);
    status.textContent = parts.join(' · ');
  };
  const offs = new Map<BuildingLayer, () => void>();
  const hook = () => {
    for (const l of layers()) if (!offs.has(l)) offs.set(l, l.onChange(show));
    show();
  };
  listeners.add(hook);
  hook();
  cb.addEventListener('change', () => api.setBuildingsOn(cb.checked));
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyG') api.setBuildingsOn(!api.buildingsOn);
  };
  window.addEventListener('keydown', onKey);
  return () => {
    listeners.delete(hook);
    for (const off of offs.values()) off();
    window.removeEventListener('keydown', onKey);
    sec.root.remove();
  };
}

function pref(key: string): boolean {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? '{}') as { on?: unknown };
    return typeof p.on === 'boolean' ? p.on : true;
  } catch {
    return true;
  }
}

function writePref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, JSON.stringify({ on }));
  } catch {
    /* private mode: not persisted */
  }
}
