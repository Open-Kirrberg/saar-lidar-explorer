/**
 * Design grammar constants - the ONLY place where period-norm numbers live.
 * Source: research/02-comparable-palaces-design-grammar.md §2 (tables 2.0-2.14), with
 * Karlsberg-specific overrides from research/05 (synthesis) and research/06 (HMS reading).
 * Every constant carries its evidence tag in a comment:
 *   [D] documented · [D->] derived · [I] inferred · [N] period norm · [U] unknown · [HMS] secondary.
 * Where 02 gives a range we take the stated default (bold in 02) or the mid value and keep
 * the range next to it so a later evidence pass can move it.
 */
import type { BuildingClass, HeadForm } from '../spec.ts';

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

// ---------------------------------------------------------------------------------------------
// Glazing (KB-I16; research/09 §3.1, §6.1 G1-G3)
// ---------------------------------------------------------------------------------------------

/**
 * French two-leaf casement (croisée à la française): two leaves closing on a meeting stile with an espagnolette, no
 * fixed central mullion [D Baunetz espagnolette]; a transom (Kämpfer) with a top light only on windows >= 2.6 m, at
 * 3/4 of the height [N 02 §2.3; research/09 §3.1]. A T-mullion (Galgenfenster) is late 19th c. [D Baunetz].
 */
export const CASEMENT = {
  /** Two meeting stiles together, m [N research/09 G3 0.06] */
  meetingStile: 0.06,
  /** Outer frame (Blendrahmen + leaf frame as seen), m [N] */
  frame: 0.07,
  /** Transom only on windows at least this tall, m [N 02 §2.3] */
  transomMin: 2.6,
  /** Transom height as a share of the clear (rectangular) height [N] */
  transomAt: 0.75,
  /** Below this width a window has one leaf [N; I] */
  twoLeafMin: 0.7,
  tag: 'D Baunetz (espagnolette casement, Galgenfenster late 19th c.); transom >= 2.6 m at 3/4 h N 02 §2.3 (research/09 §3.1, G3)',
} as const;

/** Pane rule per glazing class: panes across one leaf and the pane shape [N; HMS]. */
export interface GlazingRule {
  /** Panes across each leaf. */
  perLeaf: number;
  /** Target pane height / width (rows follow from it), unless `paneH` fixes the height. */
  aspect: number;
  /** Fixed target pane height in m (state floor), overrides `aspect`. */
  paneH?: number;
  /** Rows clamp in the lower (opening) part. */
  rows?: [number, number];
  /** Glazing bar width (Sprosse), m. */
  bar: number;
  tag: string;
}

/**
 * Glazing classes [research/09 §3.1, §6.1 G1-G2]:
 *  - state: CdL Beletage, larger panes, 1 per leaf, pane h ≈ 0.55 m [N]
 *  - court: CdL EG, wings, ranges, Orangerie, pavilions: 2 per leaf, upright h/w ≈ 1.3 (≈ 0.25 × 0.33 m on a 1.2 m
 *    window) [HMS 2 panes wide per leaf; N size]
 *  - farm: stables and farm buildings, 2 per leaf in 3-4 rows, heavier bars [N]
 */
export const GLAZING: Record<'state' | 'court' | 'farm', GlazingRule> = {
  state: { perLeaf: 1, aspect: 1.1, paneH: 0.55, bar: 0.03, tag: 'N research/09 §3.1 (larger panes ≈ 0.45-0.55 m, 1 per leaf, CdL state floor)' },
  court: { perLeaf: 2, aspect: 1.3, bar: 0.03, tag: 'HMS ≈ 2 panes wide per leaf (06 §3.2); N pane 0.25-0.45 × 0.32-0.55 m, h/w 1.1-1.4 (research/09 §3.1, G1)' },
  farm: { perLeaf: 2, aspect: 1.3, rows: [3, 4], bar: 0.035, tag: 'N research/09 G1-G2 (2 per leaf, 3-4 rows, bars 0.035 m)' },
};

/** Glazing class of a window row of a building class (research/09 G1). */
export function glazingClass(cls: BuildingClass, row: WindowRow | null | undefined): keyof typeof GLAZING {
  if (cls === 'CDL' && row === 'upper') return 'state';
  if (cls === 'STABLE' || cls === 'FARM' || cls === 'FARM_GROUP' || cls === 'RIDE') return 'farm';
  return 'court';
}

/**
 * Pure glazing layout of one casement window of clear width `w` and rectangular height `h` (to the springer for
 * arched heads; `archRise` > 0 means the head is arched and the springer acts as the transom). Bars are listed as
 * offsets from the window's left edge (`cols`, verticals incl. the meeting stile) and from its bottom (`rows`).
 */
export interface GlazingLayout {
  leaves: 1 | 2;
  /** Panes across the whole window. */
  cols: number;
  /** Rows below the transom (or in the whole window without one). */
  rowsLow: number;
  /** Rows in the top light (0 without a transom). */
  rowsTop: number;
  /** Transom height above the bottom (null: none). */
  transom: number | null;
  bar: number;
  rule: keyof typeof GLAZING;
}

export function glazingLayout(cls: BuildingClass, row: WindowRow | null | undefined, w: number, h: number, archRise = 0): GlazingLayout {
  const rule = glazingClass(cls, row);
  const g = GLAZING[rule];
  const leaves: 1 | 2 = w >= CASEMENT.twoLeafMin ? 2 : 1;
  const cols = leaves * g.perLeaf;
  const total = h + archRise;
  // transom: arched heads spring the top light at the springer; straight heads >= 2.6 m at 3/4 h [N]
  const transom = archRise > 0 ? (total >= CASEMENT.transomMin ? h : null) : total >= CASEMENT.transomMin ? h * CASEMENT.transomAt : null;
  const paneW = (w - 2 * CASEMENT.frame) / cols;
  const paneH = g.paneH ?? paneW * g.aspect;
  const low = transom ?? h;
  let rowsLow = Math.max(1, Math.round(low / paneH));
  if (g.rows) rowsLow = Math.min(g.rows[1], Math.max(g.rows[0], rowsLow));
  const rowsTop = transom !== null && archRise === 0 ? Math.max(1, Math.round((h - transom) / paneH)) : 0;
  return { leaves, cols, rowsLow, rowsTop, transom, bar: g.bar, rule };
}

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
  /**
   * KB-I17: ONE continuous main cornice across the palace group (CdL, arms, W wing, kitchen wing, all eaves at 356.0
   * [HMS 08 §1.2]; D Schneider 1988 "continuous cornices"): same profile on every building of the group, so it runs
   * through the junctions. Size 1/15 of the 11.2 m eaves height above the court [N 02 §2.6 1/14-1/18].
   */
  palace: { height: 0.75, projection: 0.68, tag: 'HMS one cornice at 356.0 on the palace group; D Schneider 1988; size N 1/15 eaves height' },
} as const;

/**
 * Cornice of a building (KB-I17): the palace-group cornice where the building's eaves sit on the continuous palace
 * eaves (catalogue defaults `eaves_continuous` + `eaves_palace`), else the class cornice.
 */
export function corniceFor(cls: string, eaves: number, defaults?: { eaves_continuous?: boolean; [k: string]: unknown } | null): { height: number; projection: number } {
  const palace = Number(defaults?.eaves_palace);
  if (defaults?.eaves_continuous && Number.isFinite(palace) && Math.abs(eaves - palace) < 0.05) return CORNICE.palace;
  return (CORNICE as Record<string, { height: number; projection: number }>)[cls] ?? CORNICE.default;
}

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
  // KB-I17: flat corner strip (Ecklisene), not quoins [HMS 06 §3.2 corner strips only on the wings; research/09 G8]
  ecklisene: { width: 0.6, projection: 0.02 },
  plinthProjection: 0.08, // [N] 0.05-0.10
  // KB-I17: plain flat window band 0.20 m, projection 0.03 m, no hood on the wings [HMS; N 0.18-0.22] (research/09 G7)
  surround: { face: 0.2, projection: 0.03 },
  bandRustica: { course: 0.4, joint: 0.035 }, // [N]
  pedimentPitch: 22, // [N] 20-25 deg
} as const;

/**
 * KB-I17 facade members (research/09 §3.4, G7-G9):
 *  - `stringCourse`: Gurtgesims only on the CdL (optional there [HMS]); none on WING2/RANGE1 and the other classes [HMS]
 *  - `hoodedAxes`: window caps (Verdachungen) only on the CdL centre axes (the risalit of the Louisenhof core) of the
 *    Beletage [HMS; N 02 §2.3]; plain bands everywhere else
 *  - `balconets`: iron balconets before upper portes-fenêtres only where a source shows a balcony (catalogue portals
 *    with a balcony / portico [D LC 1790 B02 head; HMS]); none as a default [research/09 §3.5]
 */
export const MEMBERS = {
  stringCourse: new Set<BuildingClass>(['CDL']),
  hoodedAxes: new Set<BuildingClass>(['CDL']),
  tag: 'HMS one continuous cornice, corner strips only, no Gurtgesims on the wings, no Verdachungen on the wings (06 §3.2); D Schneider 1988 "continuous cornices"; research/09 §3.4 G7-G9',
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

/**
 * Garden norms of the 1780s (KB-I11..I13; skill skb-schlossgarten garden-grammar.md, research/11 §3-4, §6.2 S2-S4).
 * Facts (where, which species, which epoch) stay in the catalogue; consumers read these numbers, never hard-code them.
 */
export const GARDEN = {
  /** Belt and serpentine walks (Sckell 1825: walk 8/10/12 Fuß = 2.3-3.9 m; Herzogsgarten belt walk 10 Fuß) [N] */
  path: { drive: [4.4, 7.8], walk: [2.3, 3.9], footpath: [0.9, 1.6], beltWalk: 3.0, spur: 2.0 },
  /** Serpentine bend radius on slopes 15-25 m [I]; ribbon sampling step (m) for draped walk meshes [I] */
  serpentineRadius: [15, 25],
  ribbonStep: 2.0,
  /** Gravel ribbon lift above the 1 m terrain grid (m), avoids z-fighting [I, render] */
  ribbonLift: 0.06,
  /** Worn grass verge each side of a gravel walk, over which the gravel fades into the lawn (m) [I; wave-2 review] */
  walkVerge: 0.35,
  /** Garden terrace at the CdL garden door: 6-8 m gravel at the perron foot (research/11 S2 a) [D Petri no parterre; I width] */
  gardenTerrace: { depth: 7 },
  /**
   * Edge of a gravel terrace with a `coping` (wave-2 review): a dressed sandstone kerb (Bordstein) 0.3 m wide set
   * `proud` above the gravel [N edging practice; I]; the drawn gravel runs `edgeOut` m past the levelled polygon so the
   * 2 m ground-class raster edge lies under it [I, render]; where a walk leaves the terrace the kerb is flush and a
   * step takes up the fall [I].
   */
  terraceKerb: { proud: 0.06, edgeOut: 1.0, footDepth: 0.15, walkStepMin: 0.2 },
  /**
   * Garden perron at a door with steps onto a gravel terrace (research/11 S2 a "2-step perron"): as wide as `axes`
   * window axes, `depth` m landing, treads 0.4 m [N d'Argenville / Blondel perron; I width, depth]; red Buntsandstein
   * like the plinth (KB-I15 steps = plinth stone) [D-> HMS; I].
   */
  perron: { axes: 3, depth: 1.6, tread: 0.4, overThreshold: 0.02 },
  /**
   * Clumps (Petri plan "multicoloured shrub clumps", research/11 S2 c): D 8-25 m; shrubs 2-4 m 60 %, small trees 5-8 m
   * 30 %, and ONE conifer or poplar accent (two from D 18 m, `accents`) [D plan; I shares; wave-2 review: 10 % accents read
   * as scattered trees]. One plant per ~3.2 m² of clump area, so crowns overlap into a closed shrubbery mass [I]; plants
   * at least 1.3 m apart [I]. Tall plants stand inside `coreFrac` of the radius; shrubs form a staggered mantle, the
   * tallest inside (`shrubOuterFrac[0]` of R) and the lowest on the rim (`[1]`) [N shrubbery layering, Hirschfeld].
   */
  clump: { diameter: [8, 25], areaPerPlant: 3.2, minSpacing: 1.3, coreFrac: 0.55, shrubInnerFrac: 0.3, shrubOuterFrac: [0.7, 0.95], accents: { base: 1, largeFrom: 18 } },
  /** Tree heights in 1789 (research/11 §3.2): avenues/clumps planted 1778-88 -> 5-8 m; retained edge trees 18-25 m [D->/I] */
  youngTree: [5, 8],
  shrub: [2, 4],
  retainedTree: [18, 25],
  /** Lombardy poplar after 8-10 years 8-12 m [N]; spacing in rows 10-12 Fuß [N Sckell] */
  poplar: { height: [8, 12], spacing: 3.4 },
  /** Young avenue trees on 1-2 stakes (Baumpfähle), drawn only near (LOD0) [N] */
  stake: { height: 1.8, size: 0.06, perTree: 1, offset: 0.35 },
  /** Formal basin (S3): coping 0.4 x 0.25 m sandstone; top 0.15-0.3 m above water [N]; jet 3-8 m, 5 m chosen [N; U] */
  basin: { copingWidth: 0.4, copingHeight: 0.25, freeboard: 0.22, jet: 5, segments: 48 },
  /**
   * Basin look (wave-2 review): pale dressed sandstone coping and stag heads (recycled stone ranges red to grey-white,
   * research/09 M5 [D reuse; I hue]), a 1.2 m raked gravel band round the coping so the ring reads from the air [I],
   * dark deep water (#1E3036) that reflects the sky at grazing angles [I render], a jet column at least `jetMinPx`
   * pixels wide [I render].
   */
  basinLook: { coping: '#D6CCBC', surround: 1.2, water: '#1E3036', jetMinPx: 2.5 },
  /**
   * Flowering shrubs in July: Rosa, Spiraea, Hypericum still in flower, Syringa / Philadelphus over -> ~4 % of the
   * crown faces [N]; a face is far larger than a flower, so its colour is only `strength` of the way from leaf to
   * flower (reads as speckle, not as a pink triangle at eye level) [I render]
   */
  julyBloom: { colours: ['#D497A6', '#ECE6D2', '#E1C25A'], faceShare: [0.06, 0.06, 0.03], strength: 0.35 },
  /** Stag heads on the rim: head ~0.9 m on a 0.6 m block, antler spread ~0.9 m [I form; D presence] */
  stagHead: { block: 0.6, head: 0.9, antler: 0.9, rimAngle: 35 },
  /** Hedges and clipped work [N d'Argenville] */
  boxEdging: { height: 0.2, thickness: 0.18 },
  banquette: { height: 1.1, thickness: 0.6 },
  yewCone: { height: 0.9, spacing: 3.9 },
} as const;

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

// ---------------------------------------------------------------------------------------------
// KB-I24 (programme owner, additive): round temple pavilion - the Tempelzimmer / Rotunde at the gallery end
// (research/10 §b.1 KB-B07: Ionic pilasters, large glass doors, pedimented portico, three steps [D T5]; all numbers
// below are period norms [N] unless tagged). Read only by layout/rotunda.ts.
// ---------------------------------------------------------------------------------------------

export const ROTUNDA = {
  /**
   * Column height (base + shaft + capital) in lower diameters: Ionic 9, Doric 8, Tuscan 7 [N Vignola 1562, the
   * standard 18th-century handbook]; entablature 1/4 of the column height [N Vignola Ionic 4.5 of 18 modules].
   */
  orders: {
    ionic: { diameters: 9, entablature: 0.25, base: 0.5, capital: 0.36, taper: 0.85 },
    doric: { diameters: 8, entablature: 0.25, base: 0.5, capital: 0.5, taper: 0.83 },
    tuscan: { diameters: 7, entablature: 0.25, base: 0.5, capital: 0.5, taper: 0.8 },
  },
  /** Pilaster projection from the drum face in diameters [N 1/6-1/4 D]. */
  pilasterProjection: 0.2,
  /** Glazed door: clear width as a share of the bay between pilasters, head this far under the architrave [N; I fit]. */
  doorBayShare: 0.62,
  doorHeadGap: 0.45,
  /** Niche depth (m) of a blind bay [N]. */
  nicheDepth: 0.35,
  /** Steps in front of the portico: riser and tread (m) [N Blondel 2R + T ≈ 0.65 m, garden steps low and deep]. */
  step: { riser: 0.16, tread: 0.38 },
  /** Attic (plain parapet ring) above the entablature that hides the springing of the low dome [N]. */
  attic: 0.9,
  /** Drum wall thickness (m): a light timber-and-render pavilion like the gallery [I research/10 §b.1 KB-B06 origin]. */
  wall: 0.45,
  /** Pediment pitch (deg) [N 20-25, = ARTICULATION.pedimentPitch]. */
  pedimentPitch: 22,
  /**
   * Raised attic block behind the portico (wave-4 review): the portico roof ends against a block of the attic that stands
   * at least this far (m) above the pediment's lead roof, so neither runs into the dome [N Pantheon / Vignola practice].
   */
  atticBlockClear: 0.2,
  /** Lead roll seams (ribs) on the low dome [N sheet-lead practice; count I]. */
  domeRibs: 16,
} as const;

// ---------------------------------------------------------------------------------------------
// Exterior owner (KB-I18, KB-I22, KB-I23): roof cover, roof hardware and court furniture (research/09 §2.6-2.8, §3.5,
// §5, §6.1 G5, G6, G10, G11, §6.3 E3-E5, E9, §6.5 C6). Values are period norms unless tagged otherwise.
// ---------------------------------------------------------------------------------------------

/**
 * KB-I18 roof covers.
 *  - Biberschwanz: south-German plain tile 38 x 18 cm, double cover, ≈ 15 cm visible course (batten gauge)
 *    [D format dewiki Biberschwanz; D-> modern gauge 14.5-16.5 cm; research/09 §2.7, G10]. The clay-tile texture is
 *    scaled to this course and width (materials/index.ts TEXTURE_SIZE).
 *  - Lead deck: the flat top of a mansard (Plattform) is lead where the upper pitch is below `leadDeckMaxPitch`
 *    [HMS "flat light deck"; D Ludwigskirche lead flats; research/09 §2.6, E9].
 */
export const ROOF_COVER = {
  biberschwanz: { length: 0.38, width: 0.18, course: 0.15, tag: 'D format 38 x 18 cm (dewiki Biberschwanz); course D-> 14.5-16.5 cm gauge; research/09 §2.7 G10' },
  leadDeckMaxPitch: 10,
  leadDeckTag: 'HMS flat light deck on the mansards; D Ludwigskirche lead flats; research/09 §2.6 E9',
} as const;

/**
 * KB-I22 lightning rods (research/09 §2.8, G6, E4). Rods on every building [D T21 schloss-karlsberg.de, 10 §c.1];
 * Hemmer's "Fünfspitz" head (1 vertical + 4 points) [D name SSG 2026; HMS caption "Hemmer'sche Fünfspitzen"];
 * geometry [N/U]: iron mast 3.0 m above the ridge, Ø 0.03 m, 4 arms of 0.4 m raised `armRise` degrees, gilt or copper
 * tips; one iron down-conductor (0.02 m square) on brackets down one free building corner to the ground. One mast per
 * ≤ `spacing` m of ridge [N Hemmer 1786 practice; I spacing].
 */
export const LIGHTNING_ROD = {
  mast: 3.0,
  diameter: 0.03,
  arm: 0.4,
  armRise: 35,
  tip: 0.18,
  conductor: 0.02,
  standoff: 0.06,
  spacing: 18,
  tag: 'D rods on all buildings (T21; research/10 §c.1); D Hemmer Fünfspitz (SSG 2026, HMS caption); geometry N/U research/09 G6',
} as const;

/**
 * KB-I22 downpipes (research/09 §2.8, G5, E3): Ø 0.11 m, one per ≤ 18 m of eaves, at corners and in piers between
 * axes, a hopper head under the cornice; lead / iron grey `colour` [N]. Box gutters of court buildings drain through
 * them; farm buildings have drip eaves or hanging gutters and get none [N].
 */
export const DOWNPIPE = {
  diameter: 0.11,
  maxEaves: 18,
  /**
   * Largest distance between neighbouring pipes on a front (wave-4 review): with pipes at both corners and the risalit
   * flanks this keeps one pipe per 15–20 m of eaves on the long fronts (research/09 §2.8) [N; I value].
   */
  maxSpacing: 25,
  standoff: 0.09,
  hopper: { width: 0.3, height: 0.28, depth: 0.24 },
  shoe: 0.22,
  colour: '#5B6168',
  noPipeClasses: new Set<BuildingClass>(['FARM', 'FARM_GROUP', 'GARD', 'WALL']),
  tag: 'N research/09 §2.8 G5 (Ø 0.10-0.12 m, one per 15-20 m of eaves, hopper under the cornice; "a few downpipes at the corners and next to risalits"); placement corners, risalit flanks, free piers I; lead/iron grey N',
} as const;

/**
 * KB-I22 weather vanes [HMS 06 §3.2 t=16.5, 71.5, 76.5; research/09 §3.6, E5]: an iron spindle with cross arms carrying
 * N/O/S/W letters and a pennant, on the CdL Dachreiter and on pavilion (apex) roofs. Sizes [N/I].
 */
export const WEATHER_VANE = {
  spindle: 1.6,
  arms: 0.45,
  letter: 0.14,
  pennant: { length: 0.75, height: 0.32 },
  tag: 'HMS vanes with N/O/S/W letters and a pennant (06 §3.2); research/09 E5; sizes N/I',
} as const;

/**
 * KB-I23 court furniture (research/09 §5, §6.5 C6; research/06 §3.1-3.2).
 *  - Sentry boxes (Schilderhäuser): 1.0 x 1.0 m, 2.4 m high + 0.5 m domed cap, blue-white diagonal stripes
 *    (Wittelsbach colours), dark cap; a pair at each portal of the palace group that faces the Ehrenhof or the W
 *    approach [HMS t=16.5, 76.5, 88-89 pairs at the CdL entrance and the arm portals, S03 portico, S19 W gate;
 *    research/09 G11, C6]. Stripe width and blue hue [N/I].
 *  - Prellsteine: sandstone guard stones beside the Durchfahrten [HMS t=71.5, 76.5, 88-89; research/09 §5].
 *  - Cobbled carriage lanes (Katzenkopf) across the gravel Ehrenhof from the gate to the portals, sandstone gutters
 *    (Rinnen) along the court walls [N research/09 §5; HMS court cobbled or gravelled].
 *  - Grille: gilt tips on the gate leaves only, iron tips on the fence [D-> Schwetzingen "teilvergoldet"; LC dark;
 *    research/09 §3.5].
 */
export const COURT_FURNITURE = {
  sentry: { width: 1.0, depth: 1.0, height: 2.4, cap: 0.5, wall: 0.05, stripe: 0.24, blue: '#3C679C', white: '#EEECE4', capColour: '#3A3F45', gap: 0.35, setOut: 0.25, tag: 'HMS pairs of blue-white striped sentry boxes with dark domed caps (06 §3.2); size research/09 G11 HMS/N; stripe width and hue N/I' },
  prellstein: { height: 0.75, base: 0.42, top: 0.26, gap: 0.12, tag: 'HMS Prellsteine beside the gates (06 §3.2); size N' },
  /**
   * Cobbled carriage lanes (wave-4 review): flush with the gravel (lift 0.01 m + polygon offset), small rounded
   * Katzenkopf cobbles (row 0.13 m, stone ≈ 0.14 m) in sand joints, framed by 0.25 m dressed sandstone edging; the axis
   * lane one carriage track wide, the cross lanes to the arm Durchfahrten narrower. Width overall incl. edging.
   */
  lane: {
    width: 3.2,
    crossWidth: 2.2,
    edge: 0.25,
    row: 0.13,
    stone: 0.14,
    lift: 0.01,
    tag: 'N research/09 §5 cobbled (Katzenkopf) carriage lanes to the portals; width N one carriage track (cross lanes I narrower); edging and stone size N',
  },
  gutter: { width: 0.42, depth: 0.04, lift: 0.03, tag: 'N research/09 §5 sandstone gutters (Rinnen) along the court walls' },
  grilleTip: { height: 0.16, base: 0.035, tag: 'D-> Schwetzingen gate "schmiedeeisern, teilvergoldet"; gilt on the gate only research/09 §3.5' },
} as const;

// ---------------------------------------------------------------------------------------------
// Interiors: state-room finish system (KB-I26/I27, interiors owner)
// ---------------------------------------------------------------------------------------------

/**
 * Louis-seize state-room finish (research/09 §4.2, §6.4 I1-I7; research/10 §c.2-c.3):
 *  - `dado`: painted wooden dado (lambris d'appui) under silk walls, 0.9 m [N 0.8-1.0 m; research/09 I1].
 *  - `leiste`: gilt Tapetenleisten framing each silk field, 0.045 m wide, 0.022 m proud [D Jacob "Tapetenleisten"
 *    research/09 §4.1; size N].
 *  - `border`: the broad damask border inside the Leiste (Mannlich: damask in three contrasting colours with broad
 *    borders in flat and gold embroidery, T1 p. 365 / T5) [D rule; width N 0.10-0.14 m]; `borderGold` its gold
 *    embroidered edge line [D gold embroidery; width N].
 *  - `damask`: repeat of the woven figure (Lyon damask, a mirrored palmette in an ogee lattice), width x height in m,
 *    and the figure's sheen contrast [N Lyon damask repeats 0.5-0.6 m wide, 0.6-0.9 m high; contrast I].
 *  - `parquetPanel`: parquet de Versailles panel, 3 pieds de roi = 0.974 m [N research/09 §4.2 "≈ 1 m (≈ 3 pieds)
 *    square", I4; Karlsberg floors U].
 *  - `supraporte`: painted overdoor field over the enfilade double doors of state rooms, door width x 0.8-1.0 m
 *    [N research/09 I3]; `supraporteMin` the least height worth a canvas.
 *  - `rosette`: stucco ceiling rosette under each chandelier (radius m) [N research/09 §4.2 "centre rosette"].
 *  - `sconce`: gilt-bronze wall lights (bras de lumière), two arms, candle-lit, at 1.75 m beside the trumeau and on
 *    piers [D Knigge "Kronleuchter"; bras de lumière N research/09 I7].
 *  - `library`: Hofbibliothek oak cases floor to ceiling with a Greek-key frieze 4½ Zoll ≈ 0.12 m under a cornice
 *    [D T5 LA Speyer B3 2584 Bl. 191]; oak hue N; brass-wire doors on crimson taffeta (#9E1B32 N) [D T5]; wire mesh
 *    pitch I (drawn coarser than the real mesh so it does not alias).
 *  - `cabinet`: Naturalienkabinett white-painted glass cabinets [D T5]; white hue N.
 *  - `gallery`: Bildergalerie (KB-B06): 20 crystal chandeliers, 104 gilt curule chairs in the green damask, gilt-bronze
 *    side tables with six-arm candelabra on the piers [D T1 pp. 374 f., 394; T5]; spacing I.
 */
export const STATE_ROOM = {
  dado: 0.9,
  leiste: { width: 0.045, depth: 0.022 },
  border: { width: 0.15, gap: 0.02, borderGold: 0.012 },
  /** widest silk panel between two Tapetenleisten (long walls are split, wave-5 review) [N] */
  panelMax: 2.3,
  /** damask: value step figure vs ground (± ≈ 4 %) and the satin ground's gloss vs the matte figure [N Lyon damask] */
  damask: { repeat: [0.54, 0.72] as [number, number], contrast: 0.07, sheen: [0.86, 1.06] as [number, number] },
  parquetPanel: 0.974,
  supraporte: { inset: 0.06, min: 0.45 },
  rosette: { radius: 0.42 },
  sconce: { height: 1.75, offset: 0.35 },
  library: { oak: '#7A5434', oakDark: '#4E3420', oakLight: '#A07A4E', frieze: 0.12, cornice: 0.1, taffeta: '#9E1B32', mesh: 0.09 },
  cabinet: { white: '#EDEAE2' },
  gallery: { chandeliers: 20, chairs: 104 },
  tag: 'D Tapetenleisten, Lyon silks, damask borders, library and collection fittings (research/09 §4.1, research/10 §c.2-c.3); sizes and hues N',
} as const;

// ---------------------------------------------------------------------------------------------
// Garden owner, wave 5 (KB-I32..I38 and garden residuals; research/11 §4.2-4.6, S5-S8, S11, S13; skb-schlossgarten
// garden-grammar.md). Read by layout/garden.ts, site/features.ts, site/gardenFurniture.ts, site/gardenWall.ts and
// site/trees.ts. Values are period norms [N] unless tagged otherwise.
// ---------------------------------------------------------------------------------------------

export const GARDEN_DETAIL = {
  /**
   * Parterre à l'angloise (d'Argenville 1747, research/11 §4.3, S7, S8): lawn panels 8-20 m with cut corners, a sanded
   * sentier of 2-3 pieds (0.65-1.0 m) between lawn and plate-bande, plates-bandes of 3-6 pieds (1.0-2.0 m) raised
   * 0.1-0.2 m and box-edged, yew cones every 12 pieds (3.9 m) with a standard rose between, cross walks 2.5-5 m [N].
   * `border` = perimeter walk inside the enclosure (treillage / wings) [I]; `corner` = cut-corner leg of a panel [N].
   */
  angloise: { sentier: 0.8, plateBande: 1.3, raise: 0.15, crossWalk: 3.0, border: 1.6, corner: 1.2, panelMin: 6, coneSpacing: 3.9, roseStem: 1.1, roseCrown: 0.45, tag: "N d'Argenville 1747 (research/11 §4.3)" },
  /** Box edging of the plates-bandes (bordure de buis): 0.15-0.25 m high, 0.15-0.2 m thick, top bevel 0.05 m [N]. */
  box: { height: 0.2, thickness: 0.17, bevel: 0.04, tag: "N d'Argenville bordure de buis" },
  /** July border flowers (roses, sunflowers, hollyhocks on the terrace [HMS]; phlox, larkspur [N]) as soft speckle [I hues]. */
  borderFlowers: { colours: ['#C44A55', '#E8C33A', '#E9E2D2', '#B57AA8', '#6E8FC4'], share: 0.3, tallShare: 0.04, tag: 'HMS roses and sunflowers on the S terrace (research/06 §3.7); N period border plants; hues I; wave-5 fix: sparser (lawn-dominant type), tall spires 5 % I' },
  /**
   * Green treillage (lattice fence) round the S-wing terrace garden TF-08 (Le Clerc 1790 via Schneider fn 27, HMS;
   * research/11 S7): 1.8-2.5 m high, arched portals 2.8-3.5 m, laths 25-40 mm, posts every ~2 m, mesh 150-200 mm
   * [D presence; N/I dims]. Colour: period green-painted trellis [N; I hue].
   */
  treillage: { height: 2.2, portalHeight: 3.2, portalWidth: 2.4, post: 2.0, postSize: 0.06, lath: 0.03, mesh: 0.18, pilaster: 0.34, frieze: 0.3, colour: '#4B6648', tag: 'D LC 1790 / HMS presence; N/I dims (laths 25-40 mm at 150-200 mm, diagonal lattice); green paint N, hue I',
    /**
     * Wave 6 (period joinery instead of a mesh fence): framed bays between flat lattice pilasters (`pier` wide), frame
     * members `frame` m, a dado rail at `dado` m over a close square lattice, a square lattice in the field, a diagonal
     * frieze under a projecting cornice (`cornice` m deep each side) [N Le Clerc / d'Argenville treillage; I dims].
     */
    pier: 0.16, frame: 0.05, dado: 0.7, cornice: 0.07, wave6: 'N period treillage joinery (framed square-lattice panels, pilasters, cornice); I dims' },
  /**
   * Orangerie tubs (Kübel, research/11 S8, garden-grammar): 0.8 x 0.8 x 0.75 m, oak painted green with dark iron corner
   * bands, rows on the walk edges every 5 m; citrus standards with a 1.2 m clear stem and a 1.4-1.8 m crown, out
   * May-October [N/I; D tubs research/01 row 17].
   */
  tub: { size: 0.8, height: 0.75, spacing: 5, band: 0.06, colour: '#3F5A3A', iron: '#2B2B2A', citrusStem: 1.2, citrusCrown: 1.6, tag: 'D tubs research/01 row 17; size, paint N/I' },
  /**
   * Garden benches (research/11 §4.6, S6): 52 green-painted benches in the Orangerie cellar (Schügens damage list via
   * Schneider) [D colour, count]; form N: 2.0 x 0.55 m, seat 0.45 m, back 0.9 m; on slopes a 3 x 2 m levelled gravel
   * platform [D Schneider "small levelled platforms, still visible today"].
   */
  bench: { length: 2.0, depth: 0.55, seat: 0.45, back: 0.9, colour: '#3F5A3A', platform: [3.0, 2.0], slopePlatform: 0.12, tag: 'D colour #3F5A3A and count (52, Orangerie cellar); form N; platform D Schneider' },
  /**
   * Garden sculpture (research/11 §4.6, research/10 O1): sandstone on 1.0-1.4 m pedestals; the surviving Flora herm is
   * yellowish sandstone, 40.5 cm (a bust-height fragment, HMP Speyer) [D]; herm shaft and pedestal proportions N.
   */
  sculpture: { pedestal: 1.2, pedestalWidth: 0.7, hermShaft: 1.25, bust: 0.55, colour: '#CDB78A', pedestalColour: '#BFB29C', tag: 'D Flora herm, yellowish sandstone (research/10 O1); pedestal 1.0-1.4 m N; herm form N' },
  /**
   * Kitchen and forcing garden (research/11 S11, §1.3 BSB 25r type [D->]): beds 1.2-1.5 m with 0.5 m paths [N],
   * quarters divided by 1.5-2 m cross walks [N], hotbed frames (Mistbeetkästen) with glass lights 1.3 x 1.0 m on
   * timber boxes tilted 10-15° to the S [D-> BSB 25r couches; N], espaliered fruit on the S-facing walls [N].
   */
  kitchen: {
    /**
     * July crops [N period kitchen garden: cabbages (blue-green), lettuce (light), beans and peas on sticks, onions and
     * leeks (glaucous), carrots, a bed just dug; I hues; wave-5 fix: lifted albedo, the rows read near-black from the air]
     */
    crops: ['#8FB09C', '#B8D27A', '#9CBC6E', '#ADB99E', '#98BA66', '#8A735C'],
    /** Bed soil (dry July loam) [I]; bean / pea poles: total height and spacing along the row [N ~1.8 m sticks; I] */
    soil: '#8A735C',
    beanHeight: [1.45, 1.8],
    beanSpacing: 1.5,
    bed: 1.35, path: 0.5, quarterWalk: 1.8, edge: 2.4, bedRaise: 0.12, frameLight: [1.3, 1.0], frameHigh: 0.45, frameLow: 0.25, frameRows: 2, espalierHeight: 2.0, espalierSpacing: 3.0, tag: 'N beds / paths (research/11 S11); D-> BSB 25r couches; N espaliers' },
  /**
   * Garden walls (enclosures, KB-B27 type): rendered rubble with a lime-wash [D-> catalogue "rendered rubble wall with
   * sandstone coping"], 0.6 m thick; coping a sandstone saddle 0.18 m high projecting 0.06 m each side [N]; the top
   * steps with the ground in bays of `bay` m, never lower than `minHeight` above it [N stepped garden walls]; piers
   * every `pierEvery` bays [N]; limewash variation and a darker foot (splash and damp) [N weathering; I strength];
   * coping a weathered grey-yellow sandstone (`copingColour`) so the top reads against the wash [I hue].
   */
  wall: { bay: 4.0, step: 0.3, minHeight: 2.2, copingHeight: 0.18, copingOverhang: 0.06, copingColour: '#A39684', pierEvery: 3, pierWidth: 0.55, pierProjection: 0.1, footAO: 0.66, footFade: 0.9, washJitter: 0.05, tag: 'N stepped rendered garden walls with sandstone coping; I weathering' },
  /**
   * Young garden trees planted 1778-88 (research/11 §3.2, wave-3 residual): nursery standards (Hochstämme) with one
   * clear stem of 2-2.5 m and a crown 4-6 m across at 5-8 m height, foliage paler and less saturated than the old
   * forest [N nursery practice: Hochstamm clear stem 2-2.5 m; I crown, hue].
   */
  standard: { clearStem: [2.0, 2.5], crownWidth: [4.0, 6.0], tag: 'N nursery Hochstamm, research/11 §3.2 planted 1778-88; I crown size, hue' },
  /** Herzogskastanien (research/11 S13, G17): Castanea in a loose grid of 8-10 m, 6-8 m high [D species / place; I layout]. */
  grove: { spacing: [8, 10], jitter: 1.6, height: [6, 8], tag: 'D species and place (research/11 G17); I layout' },
  /**
   * Terrain pad of a free-standing garden pavilion (prepare-terrain.py, KB-I61 residual): flat apron 3 m, then a long
   * blend to the natural lawn so the pad reads as a gentle mound, not a pit or a plinth on stilts [I generator rule].
   */
  pavilionPad: { apron: 3.0, blend: 12.0, tag: 'I generator rule' },
  /**
   * Double-stepped dome of the round garden pavilion KB-B87 (research/11 §1.2 Pavilion 1 "Rundpavillon mit doppelt
   * gestufter Kuppel" [D Schneider form]; wave-5 fix): a cornice at the drum head, a lower dome tier, a set-back ledge
   * and riser, an upper tier and a small lantern with a pointed cap. Fractions of the dome rise (rise = dome_rise_ratio
   * x diameter) and of the radius [N late-18th-c. garden pavilions (Laterne, gestufte Kuppel); I proportions].
   */
  steppedDome: {
    cornice: { overhang: 0.22, height: 0.28 },
    tier1: { rise: 0.3, endRadius: 0.72 },
    ledgeRadius: 0.62,
    riser: 0.08,
    tier2: { rise: 0.32 },
    lantern: { radius: 0.16, height: 0.6, capOverhang: 0.08, capRise: 0.08, spire: 0.38 },
    tag: 'D Schneider "double-stepped dome" (research/11 §1.2); N lantern and cornice; I proportions',
  },
  /**
   * Lean-to forcing house (Treibhaus) in the Holländische Gärtnerei (research/11 §1.2, G12, S11; wave-5 fix): solid
   * N back wall `backWall` m thick rising `backRise` m above the eaves, end walls and a S dwarf wall `dwarfWall` m high
   * (walls `wall` m), glazing sloped to the S over `glassDepth` of the depth, then a tiled lean-to strip to the back
   * wall; rafters every `rafter` m, lap bars every `lap` m [D Petri via Schneider "greenhouses facing due S"; D-> BSB 25r
   * serres; N form; I sizes, frame colour].
   */
  glasshouse: { backWall: 0.6, backRise: 0.5, dwarfWall: 0.6, wall: 0.4, glassDepth: 0.72, rafter: 0.95, lap: 0.55, frameColour: '#E4E0D4', tag: 'D Petri via Schneider (2 S-facing greenhouses); N lean-to form; I sizes' },
} as const;

// ---------------------------------------------------------------------------------------------
// Architecture owner, wave 6 (KB-I21 Fachwerk, KB-I28 Orangerie, KB-I29 Menagerie, interior residuals).
// Period norms [N] unless tagged otherwise; read by layout/fachwerk.ts, layout/menagerie.ts, exterior/facade.ts,
// exterior/menagerie.ts and interior/fixtures.ts.
// ---------------------------------------------------------------------------------------------

/**
 * KB-I21 rendered Fachwerk (research/09 §2.3, §6.1 G4): a timber-framed storey is 0.25-0.35 m thick against 0.6-0.8 m
 * of rubble, and from outside the only tell is the shallow window reveal (frame plane 0.12-0.15 m behind the render).
 * Lath and lime render over the whole face, the same limewash as the masonry [D Fachwerk at Karlsberg (fire 1793);
 * N sizes]. `masonryReveal` is the frame plane of the masonry walls (exterior/facade.ts, unchanged).
 */
export const FACHWERK = { wall: 0.3, reveal: 0.13, masonryReveal: 0.17, tag: 'D Fachwerk existed (1793 fire, research/09 §2.3); N 0.25-0.35 m wall, 0.12-0.15 m reveal' } as const;

/**
 * KB-I28 Orangerie joinery: "meterhohen, weiß gestrichenen Fenstern und Toren" (T5) [D white]; hue N (research/10 §c.1).
 */
export const ORANGERIE_JOINERY = { colour: '#F2F0EA', tag: 'D T5 white-painted windows and doors; hue #F2F0EA N (research/10 §c.1)' } as const;

/**
 * KB-I29 menagerie houses (research/10 §b.4, §c.1): KL-B40 "19 quadratische, schiefergedeckte, separierte Häuschen" on
 * a circle round the moat [D T20]; KL-B43 straight rows of single-storey heated houses with iron grille fronts, runs
 * crossed by a broad watercourse under an "elf Fuß hohes Netz" (11 Fuß ≈ 3.6 m D->) [D T1 pp. 383, 413]. House size,
 * pyramid pitch, grille pitch, run depth and post spacing are N/I (no find-spot detail beyond T20).
 */
export const MENAGERIE = {
  ringHouse: { width: 3.6, depth: 3.6, eaves: 2.6, pitch: 40 },
  loge: { width: 5.6, depth: 4.8, eaves: 3.6, pitch: 38 },
  /** Yard between a ring house front and the moat edge, closed by the radial grilles [I]. */
  ringYard: 1.2,
  // wave-6 review fix: slate like the documented ring houses (T20) [I by analogy; cover of the rows U], not red tile
  rowHouse: { width: 3.4, depth: 3.0, eaves: 2.4, pitch: 30, gap: 0.6, cover: 'slate' as const },
  /**
   * Seeded irregularity of a hand-built row [I]: house centre shifted along the row by up to `shift` m, width reduced by
   * up to `narrow` m, eaves varied by ± `eaves` m (mulberry32(hashString(id) ^ seed)).
   */
  rowJitter: { shift: 0.35, narrow: 0.3, eaves: 0.12 },
  // wave-6 review fix: square wrought-iron bars ≈ 25 mm at ≈ 0.2 m centres (a bear or wolf grille), not a mesh [N]
  grille: { bar: 0.2, barWidth: 0.026, height: 2.2, rail: 0.05 },
  /** Net over the runs: tarred yarn or wire on the ≈ 3.6 m posts (D T1 "aus Garn oder Drahtgeflecht"), drawn as a coarse grid of cords [I mesh]. */
  run: { depth: 9.0, netHeight: 3.6, postSpacing: 4.5, netCell: 1.5, cord: 0.014 },
  // "breiter Wasserlauf" (T1 p. 383) [D]; width I
  channel: { width: 2.2, kerb: 0.35 },
  /** Dry sandstone retaining wall along each row's back line: the ≈ 1 m LiDAR terrace steps (KL-02) [D height; I wall]. */
  terraceWall: { thickness: 0.55, minRise: 0.35, maxRise: 1.6, coping: 0.12, step: 3.0 },
  /** Trampled grass and earth inside the runs [I]. */
  runGround: '#8A7B5A',
  /** Island in the KL-B40 moat: 10 m square (LiDAR, D), sandstone quay wall with a coping; foundations and spiral stair (D T20). */
  island: { coping: 0.14, copingOver: 0.08, foundationWall: 0.6, foundationH: 0.35, stairRadius: 1.1, stairRise: 1.35, stairSteps: 8 },
  /** Hypothetical open superstructure on the island foundations (KL-B41a): slender painted timber posts [I, low]. */
  openPavilion: { post: 0.18, postsPerSide: 3, beam: 0.22 },
  tag: 'D T20 (19 square slate-roofed houses), T1 pp. 383 f., 413 (rows, grilles, broad watercourse, 11-Fuß net, in beech wood); LiDAR KL-01 (moat, 10 m island), KL-02 (≈ 1 m terraces); sizes N/I',
} as const;

/**
 * Wave-6 interior residuals (research/09 §4.2): Louis-seize cheminée à la française with console jambs, an inlaid
 * frieze, gilt-bronze mounts, a cast-iron fireback and gilt-bronze chenets; white statuary with Griotte-red inlays in
 * state rooms, Bleu-turquin grey with white inlays in private rooms [N; marble chimneypieces D Mannheim/Benrath].
 * Faience column stove (poêle en faïence): white tin glaze with a blue-grey band, tiles ≈ 0.21 m, a rectangular fire
 * box on brass feet and a fluted column with a cornice and a low urn [N; Niderviller/Strasbourg faience D regional].
 */
export const HEARTH = {
  marble: {
    state: { body: '#EEEBE4', vein: '#9A968F', inlay: '#8A3A30', inlayVein: '#D6B3A0' },
    private: { body: '#9EA4A8', vein: '#E6E4DE', inlay: '#ECE9E1', inlayVein: '#A5A29C' },
  },
  ironColour: '#2B2A29',
  faience: { glaze: '#F1EEE6', joint: '#BDB8AE', band: '#8FA6B2', brass: '#B8924E', tile: 0.21, flutes: 16 },
  tag: 'N research/09 §4.2 (marble cheminée, faience stoves; Mannheim/Benrath marble D, Niderviller/Strasbourg faience D regional)',
} as const;

/**
 * KB-I31 / KB-I39 / KB-I30 follies and small garden structures (layout/folly.ts, exterior/folly.ts). Existence is
 * documented per catalogue entry (D / D->); every form and size here is a period norm [N] or inferred [I], and every
 * position is a zone hypothesis (placement 'hypothetical', confidence low).
 */
export const FOLLY = {
  /**
   * Altan of the S wing (KB-B02a; D T5 Abb. 11 "Fundamente des Altans"; form N): an upper-floor terrace on rendered
   * piers with sandstone imposts, deck at the Beletage floor, stone balustrade. Pier rhythm: end piers, two piers
   * flanking the Durchfahrt mouth, extra piers so that no clear span exceeds `maxSpan` [N].
   */
  altan: {
    pier: 0.75,
    maxSpan: 4.4,
    /** wave-7 review fix: entablature under the deck = architrave (two fasciae) + frieze + cornice ≈ 0.6 m [N] */
    deck: 0.6,
    architrave: 0.18,
    frieze: 0.22,
    cornice: 0.2,
    corniceProjection: 0.22,
    balustrade: 1.0,
    baluster: 0.32,
    impost: 0.22,
    respond: 0.12,
    /** red Buntsandstein base course under each pier, up to the plinth top of the wing behind (≥ this) [N; D wing plinth] */
    baseCourse: 0.9,
    tag: 'D existence T5 Abb. 11; form N (piers on sandstone base courses, entablature, balustrade), sizes N',
  },
  /**
   * Chinese pavilion (UP-08 "Chinoise", V23 no. 31; research/11 S14): open octagon on a plinth with steps, slender
   * red-painted posts, green lattice railing, a concave tent roof with upturned eaves and a gilt finial [N form,
   * colours N "red and green paint" research/11 S14].
   */
  chinese: {
    sides: 8,
    plinth: 0.45,
    post: 0.2,
    postColour: '#9A2E24',
    railing: 0.9,
    railColour: '#3E6B4C',
    floorColour: '#C9C2B4',
    eaves: 3.4,
    overhang: 0.9,
    rise: 0.62,
    upturn: 0.55,
    /** wave-7 review fix: a deeper, matt painted green (was a light copper '#4E7558' that read mint) with red hip ribs [N] */
    roofColour: '#355440',
    finial: 0.9,
    /**
     * Wave-7 review fix: stacked gilt finial (knob, ball, two small parasol tiers, spike; cf. the pagoda-style finials of
     * the period chinoiseries) as [radius, height over the apex] rings, bottom to top [N].
     */
    finialProfile: [[0.13, -0.05], [0.16, 0.04], [0.06, 0.12], [0.06, 0.16], [0.15, 0.22], [0.17, 0.32], [0.11, 0.41], [0.04, 0.45], [0.04, 0.5], [0.3, 0.56], [0.04, 0.63], [0.04, 0.67], [0.21, 0.72], [0.035, 0.79], [0.03, 1.02], [0, 1.15]] as readonly (readonly [number, number])[],
    /** gilt bells hanging from the eight eave tips: length and mouth radius [N] */
    bell: { length: 0.26, radius: 0.08 },
    /** fretted valance board under the eaves (scalloped lower edge at LOD2) and the Chinese fret in the railing [N] */
    valance: 0.32,
    fretCells: 3,
    tag: 'N form and colours (research/11 S14 "octagonal, curved roof, red and green paint"); finial, bells, valance and fret N (period chinoiserie); sizes N',
  },
  /** Turkish tent (research/11 §0 item 5, S14 "striped tent 8-10 m"): round drum of canvas, conical roof, scalloped valance, pole knob [N]. */
  /**
   * Wave-7 review fix: blue and white (red and cream stripes on wall and roof read as a fairground tent): a light canvas
   * drum with narrow blue seam bands, a striped, slightly swelling roof, a solid blue scalloped valance with a gilt edge
   * band and a gilt crescent on a knob as the pole finial; colours and finial N
   * (period "Turkish" garden tents, comparison only: the painted Koppartälten at Haga 1787 - no Karlsberg source).
   */
  tent: {
    segments: 24,
    wall: 2.6,
    rise: 2.6,
    /** roof swell: the mid ring sits this fraction of the rise above the straight cone [N] */
    swell: 0.1,
    valance: 0.5,
    pole: 0.55,
    stripeA: '#33507A',
    stripeB: '#E9E4D6',
    door: 1.6,
    crescent: 0.32,
    tag: 'D presence (Saarpfalz-Touristik; Schwan via homburg1, research/11 §0 item 5); form N "striped tent 8-10 m" (S14); colours and crescent finial N',
  },
  /**
   * Hay-wagon folly (research/11 S14 "a full-size wagon form"): four spoked wheels, a low ladder-sided bed, a domed and
   * irregular hay load overhanging the ladders, and a shaft [N]. Wave-7 review fix: rounder, higher load (`loadOver`
   * 0.5 m), lighter warm straw colour, tufts at LOD2, lower ladders [N].
   */
  hayWagon: { length: 4.6, bed: 1.7, bedH: 0.95, wheelRear: 1.35, wheelFront: 1.05, wheelW: 0.12, loadH: 2.15, loadOver: 0.5, shaft: 3.0, wood: '#6B5236', hay: '#FFE7A2', ladder: 0.6, ladderFlare: 0.3, tag: 'D presence (research/11 §0 item 5); form N full-size wagon (S14)' },
  /** Aviary pavilion (V23 no. 20 "Volierenpavillon"; T25 Schwan 2023): rendered octagonal core with a slate pyramid and two wire-cage wings [N]. */
  aviary: { core: 4.6, coreEaves: 3.4, pitch: 38, wing: 5.0, wingH: 3.0, post: 0.09, bars: 0.45, wire: '#3A3F44', tag: 'D-> V23 no. 20 (schematic); T25 Schwan 2023 on the Voliere; form N, sizes N' },
  /** Monopteros (V23 no. 2, W end of the Karlsbergweiher): round stylobate with three steps, eight Tuscan columns, entablature ring, shallow lead dome [N]. */
  /**
   * Wave-7 review fix: Tuscan order with a base (plinth + torus) and a capital (necking, echinus, abacus), an entablature
   * that reads (architrave, frieze, projecting cornice), a hemispherical-ish lead dome of rise 0.5 × radius and a ball
   * finial on a short neck (cf. the monopteroi of Schwetzingen, Hohenheim and Wörlitz; comparisons only) [N].
   */
  monopteros: {
    columns: 8,
    steps: 3,
    step: 0.18,
    column: 0.48,
    height: 4.2,
    /** column parts (m): base plinth + torus, capital necking + echinus + abacus [N Tuscan, ≈ 0.5 D each] */
    base: { plinth: 0.12, torus: 0.12 },
    capital: { necking: 0.06, echinus: 0.11, abacus: 0.09 },
    /** entablature: architrave, frieze, cornice heights (sum 0.75 ≈ 1/5.6 of the order) and the cornice projection [N] */
    entablature: 0.75,
    architrave: 0.24,
    frieze: 0.26,
    corniceProjection: 0.24,
    domeRise: 0.5,
    domeSegments: 32,
    domeColour: '#6C7278',
    finialBall: 0.34,
    tag: 'D-> V23 no. 2 (schematic); form N (round open colonnade, research/10 §b.6; Tuscan order, lead dome), sizes N',
  },
  /** Bienenhaus (UP-05, V23 no. 16): timber bee shelter, open to the S, three shelves of straw skeps under a tiled lean-to [N]. */
  apiary: { back: 2.7, front: 2.1, shelves: [0.45, 1.05, 1.65] as readonly number[], skep: 0.42, skepH: 0.48, spacing: 0.6, timber: '#7A5F44', straw: '#B79E62', tag: 'D-> V23 no. 16 (schematic); form N (timber apiary pavilion, research/10 §b.6)' },
} as const;

/**
 * KB-I35 vineyard LP06 30 (research/11 S10; D PV "La vigne", rows over red-brown soil): single-stake training
 * (Pfahlerziehung), one vine per stake [N period practice]. Rows run down the slope 1.1 m apart, stakes 1.0 m apart in
 * the row, the plant phase shifted by `rowShift` m from row to row, grassy contour walks `walk` m wide every
 * `walkEvery` m [N/I]. These numbers are mirrored by the ground shader (viewer/src/landcoverBake.ts VINE_GLSL: 1.1,
 * 0.37, 30), so the 3D plants stand on the drawn rows (test). July canopy: a loose leaf column round the stake from
 * `canopy[0]` to `canopy[1]` m, `canopyR` m in radius, the stake head showing above it [N; I sizes]. Drawn in 3D only
 * within `near` m of the camera (the ground shader's analytic rows reach that far, viewer/src/vines.ts).
 */
export const VINEYARD = {
  rowDistance: 1.1,
  stakeSpacing: 1.0,
  rowShift: 0.37,
  walkEvery: 30,
  walk: 1.6,
  // wave-7 review fix: the stake head stands ~0.2 m above the leaf column (1.6 m read as fence posts) [I]
  stakeHeight: 1.5,
  stakeWidth: 0.035,
  canopy: [0.3, 1.32] as readonly [number, number],
  canopyR: 0.3,
  near: 170,
  // the 3D plants shrink away over the last `fade` m of `near` while the ground paints their far cover [I]
  fade: 60,
  tag: 'D PV 1791 "La vigne" (rows on stakes over red-brown soil); N Pfahlerziehung one vine per stake; S10 rows 1.1 m, stakes ~1.5 m (0.2 m above the leaf) every 1.0 m N/I; canopy sizes I',
} as const;

/**
 * Wave-7 review fix (KB-I36, KB-B54 / KB-B56): the glazing of the lean-to forcing houses (exterior/glasshouse.ts) read as a
 * modern photovoltaic array. Period forcing-house glazing: movable timber sashes laid on heavy rafters, each sash with
 * thin sash bars and small lapped panes of green-grey crown glass (no horizontal bars, the panes overlap like scales);
 * dark oiled timber; the flue of the Kanalheizung rises in chimneys on the back wall; rolled straw night-mats lie along
 * the top of the glazing in summer [N period practice, research/11 §1.2 (forcing houses); I sizes].
 * `pane` = [across, up the slope] m; `panesPerBay` panes between two rafters; `sashes` sash lengths up the slope;
 * `jitter` = per-pane normal jitter (rad; hand-blown crown glass bedded by hand, more than the palace's 0.026) [N; I].
 */
export const GLASSHOUSE = {
  pane: [0.3, 0.42] as readonly [number, number],
  panesPerBay: 3,
  sashes: 3,
  jitter: 0.045,
  lap: 0.008,
  rafter: { width: 0.08, proud: 0.07 },
  sashBar: { width: 0.028, proud: 0.03 },
  rail: { width: 0.07, proud: 0.05 },
  barColour: '#4E473C',
  chimney: { width: 0.55, depth: 0.45, height: 1.3, inset: 1.4 },
  nightMat: { radius: 0.15, colour: '#9C8656' },
  tag: 'N period forcing-house practice (lapped crown-glass panes on timber sashes, Kanalheizung flues, straw night-mats); I sizes',
} as const;

/**
 * KB-I68 (garden): free-standing fences of `kind: 'fence'` terrain features (site/fence.ts layout, site/features.ts
 * render). `postRail`: the post-and-rail fence Le Clerc 1790 draws in front of the court-mouth guard houses [D presence,
 * research/11 §1.5]; posts, rails and spacing are period field-fence practice [N] with sizes [I]. `barriere`: the
 * turnpike (Schlagbaum) between the valley-entrance guard houses, PV 1791 legend 1 "… pour le corps de garde et la
 * barrière" [D existence]; a beam on a pivot post with a counterweight box, resting in a forked post across the
 * carriageway [N Schlagbaum form], beam length and sizes [I]; painted in the blue and white of the sentry boxes
 * (COURT_FURNITURE.sentry) [I by analogy; N striped barrier beams].
 */
export const FENCE = {
  postRail: { spacing: 2.6, post: 0.14, rail: [0.09, 0.06] as readonly [number, number], rails: 2, sag: 0.025, lean: 0.03, colour: '#6F6455' },
  barriere: { beam: 7.0, beamSize: [0.2, 0.16] as readonly [number, number], tip: 0.1, post: 0.3, pivotH: 1.0, restH: 0.95, counter: 1.5, weight: [0.45, 0.4, 0.5] as readonly [number, number, number], stripe: 0.7 },
  /** keep posts and the beam this far from a building face (m) */
  clear: 0.35,
  tag: 'D post-and-rail at the court-mouth guard houses (Le Clerc 1790, research/11 §1.5) and a barrière at the valley entrance (PV 1791 l. 1); N period field fence and Schlagbaum forms; I sizes and colours',
} as const;

/**
 * KB-I48 Festbeleuchtung (layout/festival.ts): the 1785 wedding illuminations [D event, research/01 §4.2; lampions on
 * the 1785 rotunda's archivolts and cornice, research/10 §c.4] drawn over the 1789 state. Period fêtes lit cornices,
 * window sills, parterre borders and basin rims with thousands of small glass lamps (SPSG) [D->]; the arrangement and
 * every spacing here are a hypothesis [I]. Flames 1800-1900 K [D-> candles 1800-1930 K, look-and-period §5].
 * `buildings` / `features` name what is lit (art direction of the hypothesis, not a building fact); KB-B13 (the 1785
 * rotunda) only shows in a 1785 scene year (inEpoch).
 */
export const FESTIVAL = {
  kelvin: [1800, 1900] as readonly [number, number],
  buildings: ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B07', 'KB-B10', 'KB-B11', 'KB-B12', 'KB-B13'] as readonly string[],
  /** on the top of the main cornice: `inset` back from its front edge, `lift` above the eaves line */
  cornice: { spacing: 1.2, inset: 0.22, lift: 0.07 },
  /** two lampions per window sill, `across` × width from the axis, `out` in front of the wall plane */
  sill: { across: 0.36, out: 0.16, lift: 0.07 },
  /**
   * rotunda rings and archivolts: denser (the centrepiece of the 1785 fête, research/10 §c.4 marks them on the 1785
   * rotunda section) [D for 1785]. They belong to that event only: `event.buildings` in a scene of `event.year` whose
   * epoch contains it (wave-8 review: not on the 1789 Tempelzimmer KB-B07, which gets the ordinary cornice line and a
   * pair of lampions at each glazed door like any lit building [I]).
   */
  rotunda: { spacing: 0.75, out: 0.35, reveal: 0.25, event: { year: 1785, buildings: ['KB-B13'] as readonly string[] } },
  /** pots-à-feu on low posts round the court [N fêtes; I], kept `clear` m off the building faces */
  court: { features: ['TF-01'] as readonly string[], spacing: 6.5, inset: 2.5, height: 1.15, clear: 1.5 },
  /** lampions on the ground along the parterre borders */
  parterre: { features: ['TF-08', 'TF-15'] as readonly string[], spacing: 2.2, inset: 0.35, height: 0.1, clear: 0.6 },
  /** lampions on the basin coping */
  rim: { features: ['HG-04'] as readonly string[], spacing: 1.4, out: 0.25, lift: 0.4 },
  tag: 'D illuminations 1785 (Fürstenwärther 1786; research/01 §4.2, 10 §c.4); D-> period fête lamps (SPSG); I arrangement and spacing',
} as const;

/**
 * Wave-8 audit rank 11: the Chinese pavilion KL-B50 read like a Victorian bandstand (one level-eaved lathe roof). Period
 * chinoiserie pavilions (Chambers 1757 "Designs of Chinese Buildings"; Wörlitz, Oranienbaum and the Chinesisches Haus
 * Potsdam, comparison only) carry a double roof: a lower skirt roof over the posts, a short lantern drum and an upper
 * roof, both with corners swept up and out at the hips and a bell at every corner tip [N]. Sizes are [I] from FOLLY.chinese.
 * `drum` = lantern radius as a fraction of the post ring; `lowerRise` = rise of the skirt; `drumHeight` = lantern wall;
 * `upperOverhang` = eave projection of the upper roof beyond the drum; `cornerLift` / `cornerOut` = extra rise and
 * outward reach of the hip tips at the eave (fading quadratically towards the ridge and towards the side midpoints).
 */
export const CHINESE_ROOF = {
  drum: 0.52,
  lowerRise: 0.75,
  drumHeight: 0.85,
  upperOverhang: 0.55,
  upperRise: 0.85,
  cornerLift: 0.45,
  cornerOut: 0.3,
  /** gilt accents: ridge ball on each hip tip of the lower roof and a gilt band on the drum (polychrome + gilt) [N] */
  giltBand: 0.08,
  tag: 'N double roof with up-swept hip corners and bells (Chambers 1757; Wörlitz/Oranienbaum/Potsdam chinoiseries, comparison only); I sizes',
} as const;

/**
 * Wave-8 audit rank 10 (+ wave-8 review fix): Hemmer rods read as a picket of thin wires along every ridge, then as TV
 * aerials (a tall mast with a wide flat cross on small houses, intermediates on long ridges).
 *  - Head: Hemmer's "Fünfspitz" is "eine senkrechte Stange und ein waagerechtes Stangenkreuz" [D NDB 8 (1969) 510 f.,
 *    F. Klemm, "Hemmer, Johann Jacob"; research/09 §2.8]: one vertical point and four horizontal points in a cross, so
 *    the points stay level (a raised crown would contradict the source). Wave-9 (review leftover): a flat cross on thin
 *    arms still read as a TV aerial, so the head is now a gilt knob (`knob` radius) with a dominant vertical spike
 *    (`spike` m, base radius `spikeRadius`) and four short level points growing straight out of the knob (`point` m
 *    from the mast axis, base radius `pointRadius`): from the court it reads as a gilt point with a small star, no
 *    crossbar [N sizes; Schwetzingen photos not checked, U].
 *  - Mast: ≈ 2–4 m above the ridge (research/09 G6 [N]), scaled to the roof: `mastRoofShare` × the roof rise above the
 *    eaves, between `mastMin` and `mast` [I] (palace wings 3.0 m, Orangerie ranges ≈ 2 m). Small buildings (footprint
 *    under `pointArea` m²: guard houses, garden huts) carry only a short point (`pointMast` m) at the ridge centre: the
 *    rod need not stand far above a low roof that the palace masts out-top [I; Hemmer's own spacing / height rules in
 *    the Anleitung (Offenbach 1782, ²1788) not seen, U].
 *  - Placement: the high points only, i.e. one mast `endInset` from each ridge end (a raised centre roof carries the
 *    vane instead) and one central mast on a ridge shorter than `single`; no intermediate masts on long ridges until
 *    Hemmer's Anleitung (Offenbach 1782, ²1788, per NDB; research/09 cites 1786) or Schwan 2024 (T25) gives a spacing
 *    [I]. A mast never stands on a chimney (moved `chimneyClear` m clear of the stack, toward the ridge centre) [I], and
 *    buildings under `minArea` m² of footprint carry none [I].
 */
export const HEMMER_ROD = {
  endInset: 1.2,
  single: 14,
  mast: 3.0,
  mastMin: 1.2,
  mastRoofShare: 0.4,
  minArea: 50,
  /** wave 9: footprints under this area carry a short point only (`pointMast` above the ridge) [I] */
  pointArea: 120,
  pointMast: 0.5,
  chimneyClear: 0.9,
  baseRadius: 0.03,
  topRadius: 0.014,
  /** gilt knob (ball) at the mast head, radius */
  knob: 0.055,
  /** vertical gilt spike above the knob: height and base radius */
  spike: 0.38,
  spikeRadius: 0.03,
  /** four level gilt points out of the knob: reach from the mast axis and base radius (no arms) */
  point: 0.17,
  pointRadius: 0.022,
  ironColour: '#2E2B28',
  tag: 'D rods on all buildings (T21; research/10 §c.1); D NDB 8 (1969) 510 f. Fünfspitz = vertical rod + horizontal cross; placement on the ridge ends / central mast I (no source spacing yet); sizes N (research/09 G6), mast scaled to the roof I, short points on small buildings I',
} as const;

/**
 * Wave-8 audit rank 3: the CdL court portal read as one plain arched door in a 25-axis front. A palace main portal of the
 * 1780s is framed in exposed sandstone: flanking pilaster strips and an entablature (architrave, frieze, cornice) over
 * the arch with its keystone [N period portal grammar, cf. research/09 §3.4; LC grey-pink sandstone #BFAEA5 D LC 1790
 * via KB-I15]; drawn on portals without a portico (B02's has columns). Sizes N.
 */
export const PORTAL_FRAME = {
  pilaster: 0.45,
  projection: 0.12,
  /** entablature bottom above the surround crown, its architrave + frieze height and the cornice slab */
  above: 0.2,
  frieze: 0.55,
  cornice: 0.18,
  corniceProjection: 0.24,
  tag: 'N 1780s palace portal frame (pilaster strips + entablature); sandstone #BFAEA5 D LC 1790 (KB-I15); sizes N',
} as const;

/**
 * Wave-8 review fix (KB-I72): the CdL court Freitreppe [10 steps D-> 1.4 m Sockel; HMS short stair between the
 * sentry boxes] read as a short red stair hemmed in by the sentry boxes. A main perron of the 1780s is as broad as the portal
 * frame plus a margin, with a top landing, cheek walls (Wangen) stepped with the treads and a pedestal (Postament) at
 * each foot [N Blondel / d'Argenville perron practice; I sizes]: `beyondFrame` m wider than the PORTAL_FRAME pilasters
 * on each side, treads `tread` (2 × 0.14 + 0.32 = 0.60 m step rule N), `landing` m at the top (depth ≈ 3.5 m for 10
 * steps), cheeks `cheek` thick rising `cheekAbove` over each tread, pedestals `pedestal` = [width, depth, height above
 * grade]. Steps red Buntsandstein (plinth), cheeks and pedestals the grey-pink portal sandstone (KB-I15) [I].
 * Wave 9 (audit #3 rest) widened the flight over the three central axes; the wave-9 review withdrew that: no source
 * shows a perron that broad, research/07 §1.1 gives Le Clerc's broad 10-12-step Freitreppe to the S-wing W head
 * pavilion (KB-B02), and the only CdL depiction (HMS, research/06 §3.3) is a short straight stair of ≈ 5 steps between
 * the sentry boxes. So the width is back to the portal frame + `beyondFrame` 0.9 m (closest to HMS) and the sentry pair
 * stands on the first piers beside the cheek pedestals (`perronSentryAlong`). 10 steps stay D-> from the 1.4 m Sockel
 * at 0.145 m; HMS shows about 5 (the HMS step count conflicts and is the secondary reading). Treads in the grey-pink
 * portal sandstone (`stoneTreads`, pale nosings), risers the same stone at `riser` albedo so the 0.14 m rhythm survives
 * in shade and at dusk (with the baked step-corner AO, shade.ts AO.stepCorner) [I render].
 */
export const MAIN_PERRON = {
  beyondFrame: 0.9,
  stoneTreads: true,
  riser: 0.68,
  tread: 0.32,
  landing: 0.6,
  cheek: 0.4,
  cheekAbove: 0.18,
  pedestal: [0.56, 0.6, 1.0] as readonly [number, number, number],
  tag: '10 steps D-> (1.4 m Sockel / 0.145); stair HMS short straight ~5 steps between sentries (secondary, step count conflicts); width N Blondel / d\'Argenville (portal frame + 0.9 m, stepped cheeks, foot pedestals); sizes, grey-pink treads and darker risers I; low',
} as const;

/**
 * Wave-8 review fix (KB-I72): columned porch in front of a carriage passage carrying a balcony at the Beletage floor
 * [D LC 1790 "columned porch in the N wing centre" + D PL "balcony in each wing's centre" (research/07 §1.1); HMS
 * junction-pavilion portico on grouped Tuscan columns with an iron balcony (research/06 §1.3)]. Columns in pairs
 * either side of the passage (`inner` m clear of the passage edge, pair spacing `pair` m axis to axis) on pedestals,
 * `depth` m deep; entablature under the balcony deck; wrought-iron railing `railing` m high [N 09 §3.5]. Sizes N/I.
 */
export const PASSAGE_PORTICO = {
  depth: 3.0,
  columnDiameter: 0.6,
  inner: 0.45,
  pair: 0.9,
  pedestal: 0.8,
  entablature: 0.7,
  slab: 0.2,
  railing: 1.0,
  tag: 'D LC 1790 columned porch in the N wing centre; D PL balcony in each wing centre (07 §1.1); grouped Tuscan columns + iron balcony HMS (06, junction portico); sizes N/I',
} as const;

/**
 * Wave-8 review fix (KB-I72): a continuous balcony across the portes-fenêtres of one catalogue entry (Festsaal garden
 * balcony, wing-centre balconies) instead of one balconet per door: a sandstone slab `slab` m thick on `console`
 * consoles (one per pier and at the ends), `depth` m deep by default, overhanging the outer doors by `overhang` m,
 * wrought-iron railing `railing` m high with straight bars [N research/09 §3.5 Louis-seize ironwork; I sizes].
 */
export const BALCONY = {
  depth: 1.1,
  slab: 0.2,
  overhang: 0.5,
  console: [0.3, 0.45] as readonly [number, number],
  railing: 1.0,
  bar: 0.12,
  tag: 'N research/09 §3.5 (wrought-iron balconies with straight bars, top rail ≈ 1.0 m); stone slab on consoles N; sizes I',
} as const;

/**
 * Wave 9 (garden, audit #1): the sward at eye level, drawn as short grass-blade cards near the camera (viewer
 * grassBlades.ts). The pleasure-ground lawn (Petri's lawn, parterre panels, terrace lawns) is scythed and rolled turf
 * a few centimetres high [N Hirschfeld / Sckell lawn practice, research/11 §4]; the outer hay meadows in mid-July show
 * the aftermath (Grummet) regrowth after the June first cut, 8-22 cm with some stubble [N, research/11 §3.1 July look].
 * Heights in m; `card` = card width : height of one tuft card [I].
 */
export const GRASS_SWARD = {
  // KB-I78: lawn cards half as wide (finer grain, half the fill cost at retina)
  lawn: { height: [0.045, 0.085] as readonly [number, number], card: 1.7 },
  meadow: { height: [0.09, 0.22] as readonly [number, number], card: 1.7 },
  tag: 'N scythed and rolled pleasure-ground lawn (Hirschfeld, Sckell; research/11 §4); N July aftermath regrowth after the first hay cut (research/11 §3.1); I heights',
} as const;

/**
 * Wave 9 (garden, audit #1): graded framing groups in Petri's Herzogsgarten (catalogue TF-45..47). Petri's plan shows
 * "multicoloured shrub clumps", columnar (poplar-like) trees and dark pointed conifers (research/11 S2 c) [D plan]; the
 * groups are layered low to tall away from the lawn so they frame the view instead of standing as a single mass: low
 * July-flowering shrubs in front (Rosa, Spiraea, Hypericum flower in July, research/11 §3.1), tall flowering shrubs
 * behind, young trees, Pyramidenpappeln and conifers at the back [N 1780s shrubbery practice; I heights and spacing].
 * Heights in m; `spacing` = least distance between plants of the layer; `depth` = the group's depth as a share of its
 * radius (an elongated mass along the lawn edge) [I].
 */
export const GARDEN_GRADED = {
  front: { height: [0.8, 1.5] as readonly [number, number], spacing: 1.5 },
  mid: { height: [2.4, 3.6] as readonly [number, number], spacing: 2.1 },
  back: { spacing: 3.4 },
  /** layer split along the front direction, in units of the depth half-axis: front above, back below */
  split: [0.3, -0.35] as readonly [number, number],
  depth: 0.7,
  /** wave-9 review fix: a Pyramidenpappel keeps this far (m) off the line of sight from the lawn eye to the jet [I] */
  sightClear: 7,
  /** wave-9 review fix: the young limes as feathered Heister (6-7 m, branched from 1.2-1.5 m) [N nursery Heister; I] */
  heister: { height: [6, 7] as readonly [number, number] },
  tag: 'D Petri plan clumps, columnar trees and conifers (research/11 S2 c); N July-flowering roses, Spiraea, Hypericum (research/11 §3.1); N graded shrubbery low to tall; I heights, spacing, positions',
} as const;

/**
 * Wave-9 review fix (garden): a graded carriage drive with flanking walls (site/drive.ts; KB-V2 to the Ehrenhof gate).
 * Carriage ramps at most 1:10 with walled sides (research/09 §5) [N]; retaining walls of Buntsandstein ashlar with a
 * coping (research/02 terraces) [N]; thickness, run-out and the fill below which the wall ends [I]. scripts/
 * prepare-terrain.py mirrors wallThick / runout / wallMinFill (DRIVE_WALL_THICK_M, DRIVE_WALL_RUNOUT_M,
 * DRIVE_WALL_MIN_FILL_M).
 */
export const DRIVE = {
  wallThick: 0.8,
  /** the ground reaches its own level this far beyond the wall's outer face (prepare-terrain) */
  runout: 0.8,
  /** walls end where the drive stands less than this above the ground outside */
  wallMinFill: 0.9,
  /** walls start this far inside the drive's top end (behind the terrace wall's inner face) */
  wallStart: 0.4,
  pieceLen: 3,
  maxGrade: 0.1,
  tag: 'N carriage ramps <= 1:10 with walled sides (research/09 §5); N ashlar retaining walls with a coping (research/02); I sizes',
} as const;
