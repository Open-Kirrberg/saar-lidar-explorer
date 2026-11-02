/**
 * Design grammar constants - the ONLY place where period-norm numbers live.
 * Source: research/02-comparable-palaces-design-grammar.md §2 (tables 2.0-2.14), with
 * Karlsberg-specific overrides from research/05 (synthesis) and research/06 (HMS reading).
 * Every constant carries its evidence tag in a comment:
 *   [D] documented · [D->] derived · [I] inferred · [N] period norm · [U] unknown · [HMS] secondary.
 * Where 02 gives a range we take the stated default (bold in 02) or the mid value and keep
 * the range next to it so a later evidence pass can move it.
 */
import type { BuildingClass, HeadForm, OpeningKind } from '../spec.ts';

/** Pied du roi (Pariser Fuss) in metres [N] (02 §2.0; Pariser Fuss at Solitude [D]). */
export const PIED_DU_ROI = 0.3248;
/** Rheinlaendischer Fuss, alternative unit [N]. */
export const RHEINL_FUSS = 0.3139;

// ---------------------------------------------------------------------------------------------
// Axis modules (02 §2.0)
// ---------------------------------------------------------------------------------------------

/** Default axis spacing per class in m, used when the catalogue gives none. */
export const AXIS_SPACING: Record<BuildingClass, number> = {
  CDL: 4.38, // [D->] Saarbruecken 65.45 m / 15 axes; catalogue uses 4.1 for Karlsberg
  WING2: 3.75, // [N] 3.6-3.9
  RANGE1: 3.6, // [N] 3.3-3.9
  PAV: 3.6, // [N]
  STABLE: 3.4, // [N] 3.2-3.6, one window per 1-2 stalls
  RIDE: 4.2, // [N]
  ORANG: 3.75, // [N] 3.5-4.0 pier rhythm
  FARM: 3.4, // [N]
  FARM_GROUP: 3.4, // [N]
  GARD: 3.6, // [N] (unused)
  WALL: 3.6, // [N] (unused)
  '?': 3.6, // [U]
};

/** Minimum distance from the building corner to the outer edge of the first opening (m) [N]. */
export const MIN_END_PIER = 1.0;

// ---------------------------------------------------------------------------------------------
// Storeys (02 §2.2)
// ---------------------------------------------------------------------------------------------

/** Floor build-up (joists + pugging + boards) per class, m [N] 02 §2.2. */
export const FLOOR_BUILD_UP: Record<BuildingClass, number> = {
  CDL: 0.5, // [N] 0.45-0.6
  WING2: 0.42, // [N] 0.35-0.5
  RANGE1: 0.35, // [N]
  PAV: 0.35, // [N]
  STABLE: 0.3, // [N]
  RIDE: 0.3, // [N]
  ORANG: 0.42, // [N]
  FARM: 0.3, // [N]
  FARM_GROUP: 0.3, // [N]
  GARD: 0.3, // [N]
  WALL: 0, // n/a
  '?': 0.4, // [U]
};

// ---------------------------------------------------------------------------------------------
// Walls (02 §2.5) - outer wall thickness at ground floor, m
// ---------------------------------------------------------------------------------------------

export const WALL_THICKNESS: Record<BuildingClass, number> = {
  CDL: 1.0, // [N] 0.9-1.2 EG; Beletage 0.75-0.9
  WING2: 0.7, // [N] 0.6-0.8
  RANGE1: 0.65, // [N] 0.55-0.75
  PAV: 0.6, // [N]
  STABLE: 0.7, // [N]
  RIDE: 0.9, // [N] 0.8-1.0 + buttress pilasters
  ORANG: 1.0, // [N] N wall 0.9-1.2 (thermal mass)
  FARM: 0.6, // [N]
  FARM_GROUP: 0.6, // [N]
  GARD: 0.6, // [N] garden / enclosure walls
  WALL: 0.8, // [N] retaining walls (batter 1:10)
  '?': 0.6, // [U]
};
/** Step-back of the outer wall per storey above the ground floor, m [N] 02 §2.5. */
export const WALL_STEP_PER_STOREY = 0.15;
/** Interior bearing walls (spine) [N] 0.45-0.7. */
export const SPINE_WALL = 0.6;
/** Partitions (Fachwerk, plastered) [N] 0.12-0.2. */
export const PARTITION_WALL = 0.16;

// ---------------------------------------------------------------------------------------------
// Openings (02 §2.3 / §2.4, HMS overrides 06 §3.2)
// ---------------------------------------------------------------------------------------------

export interface OpeningSize {
  width: number;
  height: number;
  sill: number;
  head: HeadForm;
  /** Minimum clear wall above the opening head to the next floor / eaves (lintel). */
  lintel: number;
  tag: string;
}

/**
 * Window row: which row of the facade a storey is.
 *  ground = first floor above the plinth (EG / rez-de-chaussee / hall / stall floor)
 *  upper  = Beletage / Obergeschoss
 *  mezz   = mezzanine / attic storey below the eaves
 */
export type WindowRow = 'ground' | 'upper' | 'mezz';

/** Window sizes per class and row. */
export const WINDOW: Record<'CDL' | 'WING2' | 'RANGE1' | 'STABLE' | 'FARM' | 'ORANG' | 'RIDE' | 'PAV', Record<WindowRow, OpeningSize>> = {
  CDL: {
    ground: { width: 1.3, height: 2.75, sill: 0.9, head: 'straight', lintel: 0.6, tag: 'N 02 §2.3 (1.30 x 2.6-2.9, sill 0.85-0.95)' },
    upper: { width: 1.4, height: 3.1, sill: 0.7, head: 'straight', lintel: 0.8, tag: 'N 02 §2.3 (1.40 x 2.9-3.3, sill 0.55-0.8)' },
    mezz: { width: 1.3, height: 1.25, sill: 0.7, head: 'straight', lintel: 0.3, tag: 'N 02 §2.3' },
  },
  WING2: {
    ground: { width: 1.2, height: 2.6, sill: 0.9, head: 'straight', lintel: 0.6, tag: 'N 02 §2.3 (2.3-2.5); HMS 06 §3.2 windows 2.7-3.0 m, EG = OG' },
    upper: { width: 1.2, height: 2.6, sill: 0.9, head: 'straight', lintel: 0.6, tag: 'N; HMS same size on both floors' },
    mezz: { width: 1.1, height: 1.2, sill: 0.7, head: 'straight', lintel: 0.3, tag: 'N' },
  },
  RANGE1: {
    ground: { width: 1.4, height: 3.4, sill: 0.8, head: 'straight', lintel: 1.0, tag: 'N 02 §2.3 (1.30-1.50 x 3.0-3.8)' },
    upper: { width: 1.4, height: 3.4, sill: 0.8, head: 'straight', lintel: 1.0, tag: 'N' },
    mezz: { width: 1.2, height: 1.2, sill: 0.6, head: 'straight', lintel: 0.3, tag: 'N' },
  },
  STABLE: {
    ground: { width: 1.05, height: 1.2, sill: 1.8, head: 'segmental', lintel: 0.5, tag: 'N 02 §2.3 (0.9-1.2 x 1.0-1.4, sill 1.6-2.0)' },
    upper: { width: 0.9, height: 0.9, sill: 0.4, head: 'straight', lintel: 0.2, tag: 'N (Heuboden hatch)' },
    mezz: { width: 0.9, height: 0.9, sill: 0.4, head: 'straight', lintel: 0.2, tag: 'N' },
  },
  FARM: {
    ground: { width: 0.9, height: 1.35, sill: 0.85, head: 'straight', lintel: 0.4, tag: 'N 02 §2.3 (0.8-1.0 x 1.2-1.5)' },
    upper: { width: 0.9, height: 1.3, sill: 0.8, head: 'straight', lintel: 0.3, tag: 'N' },
    mezz: { width: 0.8, height: 0.8, sill: 0.5, head: 'straight', lintel: 0.2, tag: 'N' },
  },
  ORANG: {
    ground: { width: 1.6, height: 4.6, sill: 0.0, head: 'round', lintel: 1.2, tag: 'D floor-length windows (skb); size N' },
    upper: { width: 1.6, height: 4.6, sill: 0.0, head: 'round', lintel: 1.2, tag: 'D floor-length; size N' },
    mezz: { width: 1.2, height: 1.2, sill: 0.6, head: 'straight', lintel: 0.3, tag: 'N' },
  },
  RIDE: {
    ground: { width: 1.5, height: 2.6, sill: 3.2, head: 'segmental', lintel: 1.0, tag: 'N 02 §2.13 (sill > 3 m)' },
    upper: { width: 1.5, height: 2.6, sill: 3.2, head: 'segmental', lintel: 1.0, tag: 'N' },
    mezz: { width: 1.2, height: 1.2, sill: 0.6, head: 'straight', lintel: 0.3, tag: 'N' },
  },
  PAV: {
    ground: { width: 1.3, height: 3.0, sill: 0.6, head: 'round', lintel: 0.8, tag: 'N' },
    upper: { width: 1.2, height: 2.4, sill: 0.8, head: 'straight', lintel: 0.6, tag: 'N' },
    mezz: { width: 1.0, height: 1.0, sill: 0.6, head: 'straight', lintel: 0.3, tag: 'N' },
  },
};

/** Garden-side porte-fenetre height (to floor) [N] 02 §2.4: 3.6-4.0 m; width = window width. */
export const PORTE_FENETRE_HEIGHT = 3.8;
/** Cellar window in the plinth (square, shuttered, one per axis) [HMS] 06 §3.2; size [N]. */
export const CELLAR_WINDOW: OpeningSize = { width: 0.7, height: 0.5, sill: 0.35, head: 'straight', lintel: 0.1, tag: 'HMS one per axis; size N' };

/** Portals and gates (02 §2.4) - clear width x height. */
export const PORTAL: Record<'portal' | 'durchfahrt' | 'carriage_gate' | 'door' | 'porte_fenetre', { width: number; height: number; head: HeadForm; tag: string }> = {
  portal: { width: 2.3, height: 4.4, head: 'round', tag: 'N 02 §2.4 CDL main portal 2.0-2.6 x 4.0-4.8' },
  durchfahrt: { width: 3.4, height: 4.0, head: 'round', tag: 'N 02 §2.4 carriage gate 3.0-3.6 x 3.6-4.2; round-arched HMS' },
  carriage_gate: { width: 3.3, height: 3.9, head: 'segmental', tag: 'N 02 §2.4' },
  door: { width: 1.3, height: 2.8, head: 'straight', tag: 'N' },
  porte_fenetre: { width: 1.4, height: PORTE_FENETRE_HEIGHT, head: 'straight', tag: 'N 02 §2.4' },
};

/**
 * Sill windows for sides whose class default is the porte-fenêtre (FacadeSideSpec.window_kind 'window'):
 * the Orangerie W front shows two window tiers above the high basement [HMS research/08 §4: lower tier
 * 341.5-345.0 on the 340.8 hall floor -> sill 0.7, h 3.5; upper tier 347.5-350.3 -> h 2.8]; widths N.
 */
export const SILL_WINDOW: Record<WindowRow, OpeningSize> = {
  ground: { width: 1.5, height: 3.5, sill: 0.7, head: 'round', lintel: 0.8, tag: 'HMS lower W tier 341.5-345.0 (sill 0.7, h 3.5); width N' },
  upper: { width: 1.4, height: 2.8, sill: 0.5, head: 'segmental', lintel: 0.6, tag: 'HMS upper W tier 347.5-350.3 (h 2.8); sill/width N' },
  mezz: { width: 1.2, height: 1.2, sill: 0.6, head: 'straight', lintel: 0.3, tag: 'N' },
};

/**
 * Columned portico with balcony in front of a portal [D LC 1790 B02 W head: 4 columns, balcony, broad
 * Freitreppe]; column and entablature proportions N (Tuscan/Doric, 02 §2.6).
 */
export const PORTICO = {
  depth: 3.2, // [N] projection of the portico in front of the wall face
  columnDiameter: 0.7, // [N] lower diameter
  entablature: 0.9, // [N] architrave + frieze + cornice
  balustrade: 1.0, // [N] balcony balustrade height
  stairWidthExtra: 2.4, // [N] Freitreppe wider than the portico by this much
  tag: 'D LC 1790 4-column portico with balcony over a broad Freitreppe; dimensions N',
} as const;

/** Interior doors (02 §2.4). */
export const INTERIOR_DOOR = {
  enfilade: { width: 1.45, height: 3.1, tag: 'N 02 §2.4 double door 1.3-1.6 x 2.8-3.4 (Beletage)' },
  single: { width: 0.95, height: 2.35, tag: 'N 02 §2.4 single 0.9-1.0 x 2.2-2.5' },
  jib: { width: 0.85, height: 2.2, tag: 'N jib door (Tapetentuer)' },
  /** Enfilade doors sit 1.0-1.5 m from the window wall [N] 02 §2.11 (to the near jamb). */
  offsetFromWindowWall: 1.25,
} as const;

// ---------------------------------------------------------------------------------------------
// Roof (02 §2.7 / §2.8, HMS 06 §3.2)
// ---------------------------------------------------------------------------------------------

export const ROOF = {
  /** Mansard break height = BREAK_RATIO x depth/2 [D->] reproduces every catalogue v1 ridge_h. */
  mansardBreakRatio: 0.4,
  mansardLowerPitch: 70, // [N] 60-75
  mansardUpperPitch: 30, // [N] 20-35; HMS shows a flat deck (0) [HMS]
  hipPitch: 45, // [N] 40-48 WING2/RANGE1
  farmPitch: 48, // [N] 45-52
  ridePitch: 38, // [N] 35-45
  /** Dome rise = ratio x diameter [D->] reproduces catalogue v1 dome ridge_h (B07, B13, KL-B42). */
  domeRiseRatio: 0.3,
  /** Cornice-defined eaves: no rafter overhang on court buildings [N]; farm overhang 0.3-0.5 [N]. */
  eavesOverhang: { court: 0.0, farm: 0.4 },
} as const;

/** Main cornice height ≈ 1/14-1/18 of the eaves height [N] 02 §2.6; projection ≈ 0.9 x height. */
export const CORNICE = {
  CDL: { height: 1.0, projection: 0.9, tag: 'N 0.9-1.1' },
  WING2: { height: 0.65, projection: 0.6, tag: 'N 0.6-0.7' },
  RANGE1: { height: 0.5, projection: 0.45, tag: 'N 0.45-0.55' },
  default: { height: 0.4, projection: 0.3, tag: 'N' },
} as const;

export const DORMER = {
  /** Dormer in the mansard Brisis: w 1.0-1.2, h 1.8-2.2 [N] 02 §2.7; one per axis [HMS]. */
  lower: { width: 1.1, height: 2.0, sillAboveEaves: 0.6, head: 'segmental' as HeadForm, tag: 'N; HMS one per axis, segmental' },
  /** Oculus (oeil-de-boeuf) in the Terrasson: D 0.6-0.8 [N]; every 2nd axis [HMS]. */
  oculus: { diameter: 0.7, tag: 'N; HMS every second axis' },
  /** Plain dormers on hip roofs [N]. */
  hip: { width: 0.9, height: 1.3, tag: 'N' },
} as const;

export const CHIMNEY = {
  everyAxes: 2.5, // [N] 2-3 axes; HMS 9 stacks over 17 axes
  section: [0.9, 0.6] as [number, number], // [N] stack 0.9 x 0.6 (s x t); fix round 1: was 0.6 x 1.2 (read oversized)
  aboveRidge: 1.2, // [N] 1.0-1.5
  kitchenSection: [1.2, 0.9] as [number, number], // [N]
  kitchenAbove: 2.5, // [N] 2-3
} as const;

// ---------------------------------------------------------------------------------------------
// Facade articulation (02 §2.6)
// ---------------------------------------------------------------------------------------------

export const ARTICULATION = {
  risalitProjection: 0.5, // [N] 0.3-0.8
  ecklisene: { width: 0.75, projection: 0.04 }, // [N] 0.6-0.9 / 30-60 mm; HMS: corner strips only
  plinthProjection: 0.08, // [N] 0.05-0.10
  surround: { face: 0.2, projection: 0.06 }, // [N] 0.18-0.25 / 0.05-0.08
  bandRustica: { course: 0.4, joint: 0.035 }, // [N]
  pedimentPitch: 22, // [N] 20-25 deg
} as const;

// ---------------------------------------------------------------------------------------------
// Stairs (02 §2.10)
// ---------------------------------------------------------------------------------------------

export const STAIR = {
  /** Blondel: 2R + T = 24 pouces ≈ 0.65 m [D formula / N value]. */
  blondel: 0.65,
  prunk: { riser: 0.14, tread: 0.38, width: 3.6, tag: 'N R 13-15, T 36-40, w 3.0-4.5' },
  secondary: { riser: 0.16, tread: 0.33, width: 1.7, tag: 'N' },
  service: { riser: 0.185, tread: 0.27, width: 1.05, tag: 'N' },
  freitreppe: { riser: 0.145, tread: 0.4, tag: 'N R 14-15, T 38-42' },
  landingEvery: 12, // [N] 10-14 steps
} as const;

// ---------------------------------------------------------------------------------------------
// Garden (02 §2.14)
// ---------------------------------------------------------------------------------------------

export const AVENUE = {
  spacing: 7, // [N] 6-8 m in the row
  rowDistance: 14, // [N] 12-16 m
  jitter: 0.3, // [N] ±0.3 m
  /** Crown height in 1789: avenues 5-15 years old -> 4-8 m [D->] */
  height1789: 6,
} as const;

/** Opening kinds that are doors (sill 0). */
export const DOOR_KINDS: ReadonlySet<OpeningKind> = new Set<OpeningKind>([
  'portal',
  'durchfahrt',
  'door',
  'double_door',
  'jib_door',
  'carriage_gate',
  'passage',
  'porte_fenetre',
]);

/** Map any class to the window table key. */
export function windowClass(cls: BuildingClass): keyof typeof WINDOW {
  switch (cls) {
    case 'CDL':
    case 'WING2':
    case 'RANGE1':
    case 'STABLE':
    case 'ORANG':
    case 'RIDE':
    case 'PAV':
    case 'FARM':
      return cls;
    case 'FARM_GROUP':
      return 'FARM';
    default:
      return 'WING2';
  }
}
