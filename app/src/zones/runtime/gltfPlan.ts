/**
 * V2.8b: pure planning for the generic `gltf` zone runtime (gltfZone.ts): which LOD each asset wants, the
 * load → show → drop order (coarse first, the shown level stays until the next one is ready), which meshes
 * collide, and the `capture.scale` correction. Built twins (ADR 0042): `reference` assets, the nav hole policy,
 * the radial context fade, the *Referenz* debug switch. No three.js, no DOM.
 */
import type { Pose, Vec3, ZoneAsset, ZoneCaptureScale, ZoneManifest } from '../contract';
import type { HolePolicy } from './walk';
import { pickLod } from '../portal';
import type { ZoneQuality } from './api';

/** Assets the runtime draws (`scene`, valid LOD chain). Unknown roles were dropped by the parser. */
export const sceneAssets = (m: Pick<ZoneManifest, 'assets'>): ZoneAsset[] => m.assets.filter((a) => a.role === 'scene' && a.lods.length > 0);

/** `reference` assets of a built twin (the capture): drawn only on request, never collide, not in the first view. */
export const referenceAssets = (m: Pick<ZoneManifest, 'assets'>): ZoneAsset[] => m.assets.filter((a) => a.role === 'reference' && a.lods.length > 0);

/** Contract: colliders are `collider` assets; without one, the scene assets' coarsest LOD (the first loaded). */
export function colliderPlan(m: Pick<ZoneManifest, 'assets'>): { asset: ZoneAsset; lod: number; drawn: boolean }[] {
  const col = m.assets.filter((a) => a.role === 'collider' && a.lods.length > 0);
  const list = col.length ? col : sceneAssets(m);
  return list.map((asset) => ({ asset, lod: asset.lods.length - 1, drawn: asset.role === 'scene' }));
}

/** LOD index an asset wants at the camera (zone frame); quality `niedrig` stays on the coarsest. */
export function wantedLod(asset: ZoneAsset, cameraLocal: readonly [number, number, number], quality: ZoneQuality = 'auto'): number {
  const last = asset.lods.length - 1;
  if (quality === 'niedrig') return last;
  const lod = pickLod(asset, cameraLocal);
  return Math.max(0, asset.lods.indexOf(lod));
}

export type LodAction = { type: 'load'; lod: number } | { type: 'show'; lod: number; hide: number | null } | { type: 'drop'; lod: number };

/**
 * Per-asset LOD state: one load at a time, a level is shown only when loaded, the previous one is dropped
 * after the swap (no hole). Feed `want()` every tick and `loaded()` / `failed()` from the loader.
 */
export class LodSwitcher {
  shown: number | null = null;
  loading: number | null = null;
  private readonly have = new Set<number>();
  private readonly bad = new Set<number>();

  constructor(readonly count: number) {}

  /** Actions to reach `target` from the current state. */
  want(target: number): LodAction[] {
    const t = Math.min(Math.max(0, target), this.count - 1);
    if (this.loading !== null || t === this.shown) return [];
    if (this.have.has(t)) return this.swap(t);
    if (this.bad.has(t)) return [];
    this.loading = t;
    return [{ type: 'load', lod: t }];
  }

  loaded(lod: number): LodAction[] {
    if (this.loading === lod) this.loading = null;
    this.have.add(lod);
    return this.swap(lod);
  }

  /** A level that failed is not retried; the shown one stays. */
  failed(lod: number): void {
    if (this.loading === lod) this.loading = null;
    this.bad.add(lod);
  }

  private swap(lod: number): LodAction[] {
    const hide = this.shown;
    this.shown = lod;
    const out: LodAction[] = [{ type: 'show', lod, hide }];
    if (hide !== null) {
      this.have.delete(hide);
      out.push({ type: 'drop', lod: hide });
    }
    return out;
  }
}

/** The scale correction (1 = none): p' = pivot + factor · (p − pivot). Twin of tools/capture `scale_about`. */
export function scaleAbout(p: readonly [number, number, number], s: Pick<ZoneCaptureScale, 'factor' | 'pivotLocal'> | undefined): Vec3 {
  if (!s || s.factor === 1) return [p[0], p[1], p[2]];
  const c = s.pivotLocal;
  return [c[0] + s.factor * (p[0] - c[0]), c[1] + s.factor * (p[1] - c[1]), c[2] + s.factor * (p[2] - c[2])];
}

/** Spawn pose → zone frame camera position, with the scale correction (heading/pitch unchanged). */
export function spawnLocal(spawn: Pose, origin: { E0: number; N0: number }, s?: ZoneCaptureScale): Vec3 {
  return scaleAbout([spawn.E - origin.E0, spawn.h, -(spawn.N - origin.N0)], s);
}

/** Loading progress of the first view: bytes of the coarsest LODs (declared sizes; equal weights if missing). */
export function firstViewWeights(assets: readonly ZoneAsset[]): number[] {
  const bytes = assets.map((a) => a.lods[a.lods.length - 1]!.bytes ?? 0);
  const sum = bytes.reduce((s, b) => s + b, 0);
  return sum > 0 ? bytes.map((b) => b / sum) : assets.map(() => 1 / Math.max(1, assets.length));
}

/**
 * Hole policy of the walker: a built twin whose collider is its exact nav floor (`twin.nav`) blocks at the
 * floor's edge; captured meshes (noisy, with holes) keep the height and walk on.
 */
export function walkHoles(m: Pick<ZoneManifest, 'assets' | 'twin'>): HolePolicy {
  const nav = m.twin?.nav;
  if (!nav) return 'keep';
  const plan = colliderPlan(m);
  return plan.length > 0 && plan.every((c) => c.asset.id === nav) ? 'block' : 'keep';
}

/** Radial fade of a built twin's context into the horizon haze (zone frame x/z, metres). */
export interface TwinFade {
  cx: number;
  cz: number;
  /** Fully visible within r0, fully haze at r1 (just inside the ground patch edge). */
  r0: number;
  r1: number;
}

/**
 * Fade circle for the first `scene` asset's `bboxLocal` (the twin with its ground patch): centred on the
 * patch, r1 = 95 % of the smaller half extent (the square patch edge never shows), r0 = r1 − max(8 m, 40 % r1).
 * Null without a twin or a bbox (no fade, as before).
 */
export function twinFade(m: Pick<ZoneManifest, 'assets' | 'twin'>): TwinFade | null {
  if (!m.twin) return null;
  const b = sceneAssets(m).find((a) => a.bboxLocal)?.bboxLocal;
  if (!b) return null;
  const half = Math.min(b[1][0] - b[0][0], b[1][2] - b[0][2]) / 2;
  if (!(half > 2)) return null;
  const r1 = 0.95 * half;
  const r0 = Math.max(0.5, r1 - Math.max(8, 0.4 * r1));
  return { cx: (b[0][0] + b[1][0]) / 2, cz: (b[0][2] + b[1][2]) / 2, r0, r1 };
}

/** Fade weight 0 (clear) … 1 (haze) at (x, z): smoothstep(r0, r1, distance), as the shader. */
export function fadeAt(f: TwinFade, x: number, z: number): number {
  const d = Math.hypot(x - f.cx, z - f.cz);
  const t = Math.min(1, Math.max(0, (d - f.r0) / (f.r1 - f.r0)));
  return t * t * (3 - 2 * t);
}

/**
 * *Referenz* debug switch (URL `?referenz`, built twins with a `reference` asset only): `off` = no button,
 * `hidden` = button, capture hidden (default), `shown` = `?referenz=an|1|ja` shows it on enter.
 */
export function referenceMode(search: string, hasReference: boolean): 'off' | 'hidden' | 'shown' {
  if (!hasReference) return 'off';
  const q = new URLSearchParams(search);
  if (!q.has('referenz')) return 'off';
  return ['an', '1', 'ja', 'true'].includes((q.get('referenz') ?? '').toLowerCase()) ? 'shown' : 'hidden';
}
