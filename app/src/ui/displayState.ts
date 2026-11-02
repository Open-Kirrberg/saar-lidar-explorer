/**
 * Two-way bridge between the store's overlay/forest fields (persisted in the URL hash) and
 * Terrain, which owns the full overlay/forest settings (blend, stretch, collision …).
 *
 * - store → terrain: any write not tagged 'terrain' (gui, hash, …) is applied via
 *   `setOverlay` / `setForest`.
 * - terrain → store: every terrain change (panel, presets, keys B/V) is mirrored back with the
 *   source tag 'terrain'; equal values are no-ops in `Store.set`, so there is no loop.
 *
 * Terrain is typed structurally so the bridge can be unit-tested without three.js.
 */
import type { AppState, ForestMode, Store } from '../state';

export interface DisplayTerrain {
  getOverlay(): Readonly<{ key: string; opacity: number }>;
  setOverlay(patch: { key?: string; opacity?: number }): void;
  readonly forest: Readonly<{ mode: ForestMode }>;
  setForest(patch: { mode: ForestMode }): void;
  hasCanopyData(): boolean;
  onChange(fn: () => void): () => void;
}

export const TERRAIN_SOURCE = 'terrain';

type DisplayKey = 'overlay' | 'overlayOpacity' | 'forest';
const KEYS: DisplayKey[] = ['overlay', 'overlayOpacity', 'forest'];

export function bindDisplayState(store: Store<AppState>, terrain: DisplayTerrain): () => void {
  const snapshot = (): Pick<AppState, DisplayKey> => {
    const o = terrain.getOverlay();
    return { overlay: o.key, overlayOpacity: o.opacity, forest: terrain.forest.mode };
  };
  let seen = snapshot();
  /**
   * Mirror terrain → store, but only fields that changed in Terrain since the last look (plus
   * `force`d ones). Terrain also emits for unrelated changes (base layer, stretch …); copying all
   * fields then would clobber store values that are still on their way to Terrain — e.g. a hash
   * that changes layer + overlay at once, where the layer listener runs first.
   */
  const pull = (force: ReadonlySet<string> = new Set()) => {
    const now = snapshot();
    const patch: Partial<AppState> = {};
    for (const k of KEYS) if (now[k] !== seen[k] || force.has(k)) (patch as Record<DisplayKey, unknown>)[k] = now[k];
    seen = now;
    store.set(patch, TERRAIN_SOURCE);
  };

  const offStore = store.subscribe(
    (s, changed, source) => {
      if (source === TERRAIN_SOURCE) return;
      const patch: { key?: string; opacity?: number } = {};
      if (changed.has('overlay') && s.overlay !== terrain.getOverlay().key) patch.key = s.overlay;
      if (changed.has('overlayOpacity') && s.overlayOpacity !== terrain.getOverlay().opacity) patch.opacity = s.overlayOpacity;
      if (patch.key !== undefined || patch.opacity !== undefined) terrain.setOverlay(patch);
      if (changed.has('forest') && s.forest !== terrain.forest.mode && (s.forest === 'off' || terrain.hasCanopyData())) {
        terrain.setForest({ mode: s.forest });
      }
      // Terrain may have rejected or normalised a value (unknown overlay key, no DSM) → write back.
      pull(changed as ReadonlySet<string>);
    },
    KEYS,
  );
  const offTerrain = terrain.onChange(() => pull());
  pull(new Set(KEYS));
  return () => {
    offStore();
    offTerrain();
  };
}
