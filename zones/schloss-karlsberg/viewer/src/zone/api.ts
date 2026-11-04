/**
 * Zone runtime API of Schloss Karlsberg (V2.7, ADR 0029): the explorer lazy-imports `zone/entry.ts` and mounts the
 * castle on its own WebGLRenderer; the standalone viewer (main.ts) mounts it on a renderer of its own. Types only, no
 * imports from app/ (the explorer keeps its own copy of the shapes in app/src/zones/contract.ts).
 *
 * Frames: poses are EPSG:25832 E/N with true heights (DHHN2016, no exaggeration); `heading_deg` is clockwise from grid
 * north, `pitch_deg` up-positive (handover.ts).
 */
import type * as THREE from 'three';

export interface ZonePose {
  E: number;
  N: number;
  h: number;
  heading_deg: number;
  pitch_deg: number;
  mode: 'gehen' | 'fliegen';
}

/** Feature tiers (ADR 0019): Standard → Entdecker → Labor. */
export type ZoneTier = 'standard' | 'entdecker' | 'labor';
/** The explorer's quality levels; `castleQuality` (quality.ts) maps them onto the castle presets. */
export type ZoneQuality = 'auto' | 'hoch' | 'mittel' | 'niedrig' | 'mobil';

/**
 * One CHM tree of the explorer's shared tree layer (ADR 0017, stable id). `g` = ground height, `h` = tree height above
 * the ground, `r` = crown radius (m); `fill` = a filler tree of the explorer (no CHM peak).
 */
export interface ZoneSharedTree {
  id: number;
  E: number;
  N: number;
  g: number;
  h: number;
  r: number;
  type: 'unknown' | 'conifer' | 'broadleaf';
  fill: boolean;
}

export interface ZoneTreeSource {
  /** Trees inside the EN bounding box [[Emin, Nmin], [Emax, Nmax]]. */
  treesIn(bboxEN: [[number, number], [number, number]]): Promise<ZoneSharedTree[]>;
}

export interface ZoneMountContext {
  /** The zone builds its HUD inside this element (class-scoped `skb-` CSS); an own renderer's canvas goes here too. */
  container: HTMLElement;
  /** Shared renderer of the host (its state is saved on enter and restored on exit); absent = the zone makes its own. */
  renderer?: THREE.WebGLRenderer;
  /** Base URL of the zone package (`terrain/`, `textures/` below it), with a trailing slash. */
  baseUrl: string;
  tier?: ZoneTier;
  quality?: ZoneQuality;
  /** Shared CHM trees around the footprint (zone.json preset `trees: "shared"`); null/absent = the castle's own forest. */
  trees?: ZoneTreeSource | null;
  /** Modelled area (zone.json footprint, EN ring); shared trees are used only outside it. Fallback: `manifest.footprint`. */
  footprintEN?: [number, number][];
  /** The parsed zone.json the explorer mounted (app ZoneManifest; only what the castle reads is typed here). */
  manifest?: { id: string; footprint?: [number, number][] };
  /** "Verlassen" / key M in zone mode; absent = standalone ("Zurück zur Karte" → explorer URL). */
  onExit?: () => void;
  onProgress?: (label_de: string, fraction: number) => void;
  signal?: AbortSignal;
}

export interface ZoneHandle {
  /**
   * Start at `spawn` (gehen → walk at the nearest entrance or on the ground, fliegen → the exact pose). Zone mode
   * (`onExit` set) defaults to `intro: 'rundflug'`: the fly-around plays first and every way out of it lands at `spawn`.
   */
  enter(spawn: ZonePose, opts?: { intro?: 'rundflug' | 'none' }): void;
  /** Leave: restores the shared renderer and returns the current pose. */
  exit(): ZonePose;
  /** One wall-clock frame (the host's rAF); test hooks hold the frames until the next real input (clock.ts). */
  frame(dt: number): void;
  /** Advance n frames with a fixed dt (automated tabs: rAF paused), exposure snapped. */
  step(n?: number, dt?: number): void;
  /** View size in CSS pixels. */
  resize(width: number, height: number): void;
  setTier(t: ZoneTier): void;
  setQuality(q: ZoneQuality): void;
  /** „Gehe zu“ highlights (highlights.ts). */
  highlights(): { id: string; label_de: string }[];
  goto(id: string): boolean;
  /** Test hooks (`window.skb` in the standalone viewer). */
  readonly hooks: Record<string, unknown>;
  dispose(): void;
}
