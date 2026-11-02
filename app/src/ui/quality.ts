/**
 * Quality presets "Hoch / Mittel / Niedrig" (final polish). Only existing engine knobs are wired:
 * renderer pixel ratio, Terrain streaming (pixel error, GPU budget, canopy distance) and mesh LOD
 * distances, Labels3D distance, LoD2 building load radius + fade, point-cloud draw budget.
 * "Hoch" is exactly the engine defaults, so the default changes nothing.
 *
 * `qualityKnobs` is pure (tested); `applyQuality` takes structural targets so it needs no three.js.
 */
import type { QualityLevel } from './settings';

export const QUALITY_LABELS: Record<QualityLevel, string> = { hoch: 'Hoch', mittel: 'Mittel', niedrig: 'Niedrig', mobil: 'Mobil' };

export interface QualityKnobs {
  /** Renderer pixel ratio = min(devicePixelRatio, cap). */
  pixelRatioCap: number;
  /** Terrain refinement threshold in screen pixels (higher = coarser). */
  pixelError: number;
  /** Soft GPU budget for terrain textures (MiB). */
  budgetMiB: number;
  /** Canopy (DSM) meshes only for drawn level-0 chunks within this distance (m). */
  canopyDistance: number;
  /** Factor on the per-chunk mesh LOD distances (1/2/4/10 m grids). */
  lodScale: number;
  /** Factor on every 3D label's max distance (POIs, markers, candidates). */
  labelScale: number;
  /** LoD2 buildings: load radius (m); drop radius and fade derive from it. */
  buildingRadius: number;
  /** Point-cloud draw budget (points). Applied only when the user picks a preset. */
  pointBudget: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityKnobs> = {
  hoch: { pixelRatioCap: 2, pixelError: 1, budgetMiB: 600, canopyDistance: 2000, lodScale: 1, labelScale: 1, buildingRadius: 2000, pointBudget: 3_000_000 },
  mittel: { pixelRatioCap: 1.5, pixelError: 1.5, budgetMiB: 450, canopyDistance: 1500, lodScale: 0.75, labelScale: 0.75, buildingRadius: 1500, pointBudget: 2_000_000 },
  niedrig: { pixelRatioCap: 1, pixelError: 2.5, budgetMiB: 300, canopyDistance: 1000, lodScale: 0.5, labelScale: 0.5, buildingRadius: 1000, pointBudget: 1_000_000 },
  // F20 phones: sharp enough on small high-DPR screens (cap 1.5), but a ~200 MB terrain budget,
  // short canopy/building/label radii and 0.5 M points. The canopy itself stays off by default
  // (forest mode 'off' is the app default; this only limits it when the user turns it on).
  mobil: { pixelRatioCap: 1.5, pixelError: 2, budgetMiB: 200, canopyDistance: 700, lodScale: 0.6, labelScale: 0.5, buildingRadius: 800, pointBudget: 500_000 },
};

export function qualityKnobs(level: QualityLevel): QualityKnobs {
  return QUALITY_PRESETS[level] ?? QUALITY_PRESETS.hoch;
}

export function pixelRatioFor(level: QualityLevel, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, qualityKnobs(level).pixelRatioCap);
}

/** Building radii and screen-door fade for a load radius (defaults 2000 → drop 2600, fade 1500–1950). */
export function buildingRadii(loadRadius: number): { loadRadius: number; dropRadius: number; fade: [number, number] } {
  return { loadRadius, dropRadius: loadRadius * 1.3, fade: [loadRadius * 0.75, loadRadius * 0.975] };
}

export interface QualityTargets {
  setPixelRatio(r: number): void;
  devicePixelRatio: number;
  streaming: { pixelError: number; budget: number; canopyDistance: number };
  /** Mesh LOD distances (mutated in place); `baseDistances` are the engine defaults. */
  lodDistances: number[];
  baseDistances: readonly number[];
  labels?: { distanceScale: number } | null;
  buildings?: { opts: { loadRadius: number; dropRadius: number }; fade?: { set(a: number, b: number): unknown } } | null;
  /** `setBudget(n, true)` = from a preset (does not mark the budget as the user's own). */
  pointClouds?: { setBudget(points: number, fromPreset?: boolean): void; readonly prefs?: { budgetUser?: boolean } } | null;
}

const MiB = 1024 * 1024;

/**
 * Apply a preset. `withPointBudget`: the point budget has its own persisted slider in the
 * point-cloud panel, so it's only set when the user actively picks a preset — and never when the
 * user has set the slider (`prefs.budgetUser`).
 */
export function applyQuality(level: QualityLevel, t: QualityTargets, withPointBudget = false): QualityKnobs {
  const k = qualityKnobs(level);
  t.setPixelRatio(pixelRatioFor(level, t.devicePixelRatio));
  t.streaming.pixelError = k.pixelError;
  t.streaming.budget = k.budgetMiB * MiB;
  t.streaming.canopyDistance = k.canopyDistance;
  t.baseDistances.forEach((d, i) => (t.lodDistances[i] = Math.round(d * k.lodScale)));
  if (t.labels) t.labels.distanceScale = k.labelScale;
  if (t.buildings) {
    const b = buildingRadii(k.buildingRadius);
    t.buildings.opts.loadRadius = b.loadRadius;
    t.buildings.opts.dropRadius = b.dropRadius;
    t.buildings.fade?.set(b.fade[0], b.fade[1]);
  }
  // A budget the user set with the point-cloud slider wins over presets.
  if (withPointBudget && t.pointClouds && !t.pointClouds.prefs?.budgetUser) t.pointClouds.setBudget(k.pointBudget, true);
  return k;
}
