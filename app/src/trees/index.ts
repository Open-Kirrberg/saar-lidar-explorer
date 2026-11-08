/**
 * V2.4 trees in the overworld — one install call (ADR 0017, 0030, 0034).
 *
 *   installTrees(ctx);   // AppContext: scene, terrain, manifest, store, camera (+ shell, onFrame)
 *
 * With `onFrame` the layer updates itself every frame; without it the caller runs `update(dt)`
 * before rendering. With `shell` it registers the 🟢 Standard feature `trees` (ADR 0019 / 0032):
 * a „Bäume“ switch in *Einstellungen*, persisted in localStorage `sle.trees.v1`.
 * The relief lab's DSM canopy (F5, *Wald* ≠ aus, Labor) replaces the trees while it is on, so the
 * two never overlap. `setLensFade(0…1)` is for the Relikt-Blick lens (V2.5).
 * With `shell` it also registers 🟢 `tree-card`, the *Baum-Steckbrief*: tap / click a tree → card
 * (TreeCard.ts; plan „Orte im Vergleich“ §4).
 */
import type { Camera, Scene } from 'three';
import type { Manifest } from '../data/manifest';
import type { FeatureHost, ShellApi } from '../shell/types';
import type { AppState, Store } from '../state';
import { mountTreeCard } from './TreeCard';
import { TreeLayer } from './TreeLayer';
import type { TreeStats, TreeTerrain } from './TreeLayer';

export { decodeTrees, parseTrees, treeChunkRef, treeKind, isFillTree, TREES_FORMAT } from './treeData';
export type { DecodedTrees, ManifestTrees, TreeChunkRef } from './treeData';
export type { TreeStats } from './TreeLayer';

/** Tier-registry descriptor (ADR 0019): Standard, on by default, German label. */
export const TREES_FEATURE = {
  id: 'trees',
  tier: 'standard',
  label: 'Bäume',
  hint: 'Bäume aus dem Kronenhöhenmodell (LiDAR 2025): ein Baum je gemessener Krone',
  defaultOn: true,
} as const;

export interface TreesApi {
  /** False when the manifest has no `trees` layer (all calls are no-ops then). */
  readonly available: boolean;
  /** Visible = user toggle on, lens fade < 1, relief-lab canopy off. */
  readonly visible: boolean;
  readonly on: boolean;
  update(dt: number): void;
  setVisible(on: boolean): void;
  /** 0 = trees fully shown, 1 = faded out (dithered, per tree). */
  setLensFade(f: number): void;
  stats(): TreeStats | null;
  readonly layer: TreeLayer | null;
  dispose(): void;
}

export interface InstallTreesOptions {
  scene: Scene;
  terrain: TreeTerrain;
  manifest: Manifest;
  store: Store<AppState>;
  camera: Camera;
  /** Registers the `trees` feature (settings switch) when given. */
  shell?: ShellApi;
  /** Per-frame hook (AppContext.onFrame); without it call `update(dt)` yourself. */
  onFrame?: (cb: (dt: number) => void) => () => void;
}

/** Baum-Steckbrief (tap a tree → card): Standard, part of the trees layer. */
export const TREE_CARD_FEATURE = { id: 'tree-card', tier: 'standard', label: 'Baum-Steckbrief' } as const;

const PREFS_KEY = 'sle.trees.v1';

function readOn(): boolean {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { on?: unknown };
    return typeof p.on === 'boolean' ? p.on : TREES_FEATURE.defaultOn;
  } catch {
    return TREES_FEATURE.defaultOn;
  }
}

function writeOn(on: boolean): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ on }));
  } catch {
    /* private mode: not persisted */
  }
}

/** „Bäume“ switch in the settings dialog (single-AOI and catalog mode). */
export function mountTreesSettings(h: FeatureHost, api: Pick<TreesApi, 'on' | 'setVisible'>): () => void {
  const id = 'sle-trees-on';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = id;
  box.checked = api.on;
  box.addEventListener('change', () => {
    api.setVisible(box.checked);
    writeOn(box.checked);
  });
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = ` ${TREES_FEATURE.label} zeigen`;
  const row = document.createElement('div');
  row.className = 'sle-row';
  row.append(box, label);
  const h3 = document.createElement('h3');
  h3.textContent = TREES_FEATURE.label;
  const hint = document.createElement('p');
  hint.className = 'sle-dim sle-small';
  hint.textContent = `${TREES_FEATURE.hint}. Aus = freie Sicht auf den Waldboden, schneller auf schwachen Geräten.`;
  h.settings.append(h3, row, hint);
  return () => {
    h3.remove();
    row.remove();
    hint.remove();
  };
}

declare global {
  interface Window {
    sleTrees?: TreesApi;
  }
}

export function installTrees(o: InstallTreesOptions): TreesApi {
  const trees = o.manifest.trees;
  if (!trees || trees.chunks.length === 0) {
    const none: TreesApi = {
      available: false,
      visible: false,
      on: false,
      update() {},
      setVisible() {},
      setLensFade() {},
      stats: () => null,
      layer: null,
      dispose() {},
    };
    window.sleTrees = none;
    return none;
  }
  const layer = new TreeLayer(trees, o.terrain);
  o.scene.add(layer);
  let on = readOn();
  let lens = 0;
  let canopy = o.store.get().forest !== 'off';
  const apply = () => {
    layer.visible = on && lens < 1 && !canopy;
  };
  const unsub = o.store.subscribe(
    (s) => {
      canopy = s.forest !== 'off';
      apply();
    },
    ['forest'],
  );
  apply();

  const api: TreesApi = {
    available: true,
    get visible() {
      return layer.visible;
    },
    get on() {
      return on;
    },
    update: (dt) => layer.update(o.camera, dt),
    setVisible(v) {
      on = v;
      apply();
    },
    setLensFade(f) {
      lens = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0));
      layer.treeUniforms.uLensFade.value = lens;
      apply();
    },
    stats: () => layer.stats(),
    layer,
    dispose() {
      unsub();
      offFrame?.();
      unregister?.();
      unregisterCard?.();
      o.scene.remove(layer);
      layer.dispose();
    },
  };
  const offFrame = o.onFrame?.((dt) => layer.update(o.camera, dt));
  const unregister = o.shell?.registerFeature({
    id: TREES_FEATURE.id,
    tier: TREES_FEATURE.tier,
    label: TREES_FEATURE.label,
    mount: (h) => mountTreesSettings(h, api),
  });
  const unregisterCard = o.shell?.registerFeature({
    id: TREE_CARD_FEATURE.id,
    tier: TREE_CARD_FEATURE.tier,
    label: TREE_CARD_FEATURE.label,
    mount: (h) => mountTreeCard(h, layer),
  });
  window.sleTrees = api; // verification handle (perf script, browser checks)
  return api;
}
