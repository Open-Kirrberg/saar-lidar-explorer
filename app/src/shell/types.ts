/**
 * Public shell API (extension points, ADR 0032). Other modules (minimap V2.3, lens V2.5, zones
 * V2.6, tutorial V2.9, trees V2.4) plug in through `ctx.shell` / `window.sle.shell` without
 * editing `app/src/shell/`.
 */
import type { AppContext } from '../main';
import type { Labels3D } from '../ui/Labels3D';
import type { Minimap } from '../map/Minimap';
import type { MarkerManager } from '../markers/MarkerManager';
import type { FeatureDef } from './registry';
import type { Tier } from './tiers';
import type { MoveMode } from './flight';
import type { Toast } from './dom';
import type { DialogHandle, DialogOptions } from './dialog';

/** What a feature gets on mount. Every element is a per-feature wrapper the shell removes on unmount. */
export interface FeatureHost {
  ctx: AppContext;
  shell: ShellApi;
  /** Cards in the „Werkzeuge“ drawer; attached only from the feature's `panelTier` on. */
  panel: HTMLElement;
  /** Buttons in the tool row above the action bar (Markieren, Messen …); attached from `panelTier` on. */
  tools: HTMLElement;
  /** The „Orte“ drawer (Standard). */
  places: HTMLElement;
  /** Extra HUD lines. */
  hud: HTMLElement;
  /** Section in the „Einstellungen“ dialog (attached while the dialog is open). */
  settings: HTMLElement;
  /** Free layer over the 3D view; `pointer-events: none` except on children that set it. */
  overlay: HTMLElement;
  /** Shared core services (built before features mount). */
  services: ShellServices;
}

export interface ShellServices {
  labels: Labels3D;
  /** Set once the `markers` feature mounted (always in Standard). */
  markers: MarkerManager | null;
  /** Set by the `minimap` feature (V2.3 may replace it). */
  minimap: Minimap | null;
  toast: Toast;
}

/** Fixed slots of the layout (one element each, owned by whoever registers for them). */
export interface ShellSlots {
  /** Minimap box (id `minimap`), top-right on desktop and phones. V2.3 rebuilds its content. */
  minimap: HTMLElement;
  /** Lens toggle inside the Standard action bar (V2.5 „Relikt-Blick“). Empty → takes no space. */
  lens: HTMLElement;
  /** Full-screen layer above HUD and bar, below dialogs: zone portal prompt, loading screen (V2.6). */
  overlay: HTMLElement;
  /** Topmost non-modal layer for the first-flight tutorial (V2.9). */
  tutorial: HTMLElement;
}

/** Stable anchors on shell controls (`data-shell-anchor`), for the tutorial to point at. */
export type ShellAnchor =
  | 'move-mode'
  | 'speed'
  | 'minimap'
  | 'places'
  | 'lens'
  | 'share'
  | 'keys'
  | 'settings'
  | 'sources'
  | 'tools';

export interface PromptOptions {
  /** Main line, e.g. „Schloss Karlsberg 1789 betreten?“. */
  text: string;
  /** Button label, e.g. „Betreten“. */
  action: string;
  onAction(): void;
  /** Optional key hint shown next to the button (e.g. 'Enter'); the caller binds the key. */
  keyHint?: string;
}

export interface Handle {
  close(): void;
}

export interface LoadingHandle extends Handle {
  /** 0–1, or null for an indeterminate bar. */
  progress(p: number | null, text?: string): void;
}

export interface ShellApi {
  tier(): Tier;
  /** Persisted locally; `source` is a store-style tag (avoids feedback loops in listeners). */
  setTier(t: Tier, source?: string): void;
  onTier(cb: (t: Tier, source: string) => void): () => void;
  /** Tier-gated registry: mount from `def.tier` on, unmount below it. Returns an unregister function. */
  registerFeature(def: FeatureDef<FeatureHost>): () => void;
  isMounted(id: string): boolean;
  readonly slots: ShellSlots;
  readonly services: ShellServices;
  anchor(id: ShellAnchor): HTMLElement | null;
  moveMode(): MoveMode;
  setMoveMode(m: MoveMode): void;
  toast: Toast;
  openDialog(o: DialogOptions): DialogHandle;
  openKeys(): void;
  openSettings(): void;
  openSources(): void;
  /** Zone portal prompt (V2.6): one at a time, bottom-centre above the bar. */
  prompt(o: PromptOptions): Handle;
  /** Full-screen loading screen (V2.6 zone entry). */
  loading(title: string): LoadingHandle;
  /** V2.9: true until the tutorial calls `markTutorialDone()`; persisted locally. */
  firstRun(): boolean;
  markTutorialDone(): void;
  /** V2.9: mount a tutorial into `slots.tutorial`; the returned teardown runs on unmount. */
  mountTutorial(fn: (layer: HTMLElement, shell: ShellApi) => void | (() => void)): () => void;
  /** V2.9: while set, *Steuerung* shows „Einführung starten“ calling `fn`. Returns an unset function. */
  setTutorialStart(fn: () => void): () => void;
}
