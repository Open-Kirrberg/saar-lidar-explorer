/**
 * V2.6b: zone runtime API (zone contract „Runtime API“, ADR 0037). What a zone module implements so the
 * explorer can mount it behind a portal on its shared renderer. Types only.
 *
 * Shapes match the castle's `zone/api.ts` (V2.7): a castle handle is assignable to `ZoneHandle`, and the
 * explorer's `ZoneMountContext` is a superset of what the castle reads. Poses: EPSG:25832 E/N, true
 * heights (no exaggeration inside a zone), heading clockwise from grid north, pitch negative = down.
 */
import type { WebGLRenderer } from 'three';
import type { Pose, ZoneManifest } from '../contract';

export type ZonePose = Pose;
export type ZoneTier = 'standard' | 'entdecker' | 'labor';
export type ZoneQuality = 'auto' | 'hoch' | 'mittel' | 'niedrig' | 'mobil';

export interface ZoneMountContext {
  /** Zone HUD layer (full-screen, above the canvas, below the host's *Verlassen* chrome). Removed on exit. */
  container: HTMLElement;
  /** The explorer's renderer. The host restores its state on exit; zones should still leave it as found. */
  renderer: WebGLRenderer;
  /** Base URL of the zone package (`<dataRoot>zones/<id>/`), trailing slash. Assets are relative to it. */
  baseUrl: string;
  /** Parsed `zone.json` (or the built-in manifest). */
  manifest: ZoneManifest;
  tier?: ZoneTier;
  quality?: ZoneQuality;
  /** Zone footprint (EPSG:25832 ring, CCW, no closing vertex). */
  footprintEN?: [number, number][];
  /** Ask the host to leave (zone-own *Verlassen*); the host then calls `exit()` + `dispose()`. */
  onExit: () => void;
  /** Loading progress for the host's loading screen; `fraction` 0–1 of the zone's own work. */
  onProgress: (label_de: string, fraction: number) => void;
  /** Aborted when the user cancels loading; the host disposes a handle that resolves after that. */
  signal: AbortSignal;
}

export interface ZoneHandle {
  /** Show the zone at `spawn` (first frame follows). Called once, after mount resolved. */
  enter(spawn: ZonePose): void;
  /** Leave: stop input, put the shared renderer back. May return the pose the visitor left from. */
  exit(): ZonePose | void;
  /** One frame: update + render on the shared renderer (the host stops rendering the overworld meanwhile). */
  frame(dt: number): void;
  /** View size in CSS pixels; called before `enter` and whenever the viewport changes. */
  resize(width: number, height: number): void;
  setTier?(t: ZoneTier): void;
  setQuality?(q: ZoneQuality): void;
  /** Free GPU + DOM resources; the handle is dead afterwards. */
  dispose(): void;
}

export interface ZoneModule {
  /** Load assets (report `onProgress`, honour `signal`) and resolve when the first view can be drawn. */
  mountZone(ctx: ZoneMountContext): Promise<ZoneHandle>;
  /**
   * The host draws its *Verlassen* button, title and attribution over the zone (default true). A zone with
   * its own HUD (castle) may set false and call `ctx.onExit()` itself; Esc still leaves.
   */
  hostChrome?: boolean;
}

export type ZoneModuleLoader = () => Promise<ZoneModule>;
