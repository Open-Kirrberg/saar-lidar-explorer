/**
 * Storey stack (pure): absolute floor levels, ceilings, eaves and the plinth extension.
 *
 * Convention (catalogue v1 `conventions.storeys`): storeys are listed bottom-up including the
 * plinth; heights are floor-to-floor; eaves_h = base_h + Σ storeys. The first storey starts at
 * base_h (court / terrace level). Example CdL: base 344.8 + Sockel 1.2 -> EG floor 346.0,
 * + EG 4.8 -> Beletage 350.8, + 5.6 -> eaves / mansard floor 356.4 (research/05 §e).
 */
import type { Building, BuildingClass, Storey, StoreyKind } from '../spec.ts';
import { FLOOR_BUILD_UP, type WindowRow } from './grammar.ts';

/** How far a plinth is sunk below the lowest terrain sample so no gap shows (m) [I]. */
export const PLINTH_EMBED = 0.3;

export interface Level {
  index: number;
  name: string;
  kind: StoreyKind;
  /** Absolute floor level (m DHHN2016). For a plinth: base_h. */
  floor_h: number;
  /** Absolute top = floor of the next storey (or eaves). */
  top_h: number;
  height: number;
  /** Absolute clear ceiling (top_h − build-up of the floor above; = top_h for the top storey). */
  ceiling_h: number;
  build_up: number;
  /** Facade window row for this storey (null: no regular windows). */
  row: WindowRow | null;
  /** Walkable interior storey (interiors + plans use these). */
  walkable: boolean;
  tag: string;
}

export interface StoreyStack {
  base_h: number;
  levels: Level[];
  /** Walkable levels only. */
  floors: Level[];
  eaves_h: number;
  /** Plinth from `bottom_h` (embedded below the lowest terrain) up to base_h. */
  plinth: { bottom_h: number; extension: number };
  /** Total wall height above base_h. */
  wallHeight: number;
}

/** Infer a storey kind from its (German) name when the catalogue has none (v1). */
export function inferStoreyKind(s: Pick<Storey, 'name' | 'height' | 'kind'>): StoreyKind {
  if (s.kind) return s.kind;
  const n = s.name.toLowerCase();
  if (/erdh(ue|ü)gel|mound/.test(n)) return 'mound';
  if (/mauer|wall/.test(n)) return 'wall';
  if (/kniestock|heuboden/.test(n)) return 'kneewall';
  if (/mezzanin|entresol/.test(n)) return 'mezzanine';
  if (/kellergeschoss|basement/.test(n) && s.height >= 2.0) return 'basement';
  if (/^(sockel|kellersockel)|souterrain|plinth/.test(n)) return 'plinth';
  return 'floor';
}

export interface StackOptions {
  /** Lowest terrain under the footprint (default b.ground_dtm.min). */
  groundMin?: number;
  /** Override build-up per storey. */
  buildUp?: number;
}

export function storeyStack(
  b: Pick<Building, 'base_h' | 'storeys' | 'cls' | 'ground_dtm'>,
  opts: StackOptions = {},
): StoreyStack {
  if (b.base_h === null) throw new Error('storeyStack: base_h is null (unplaced building)');
  const base = b.base_h;
  const cls: BuildingClass = b.cls;
  const levels: Level[] = [];
  let h = base;
  let floorOrdinal = 0;
  b.storeys.forEach((s, index) => {
    const kind = inferStoreyKind(s);
    const floor_h = h;
    const top_h = h + s.height;
    h = top_h;
    let row: WindowRow | null = null;
    if (kind === 'floor') {
      row = floorOrdinal === 0 ? 'ground' : floorOrdinal === 1 || s.height >= 3.6 ? 'upper' : 'mezz';
      floorOrdinal++;
    } else if (kind === 'mezzanine') row = 'mezz';
    else if (kind === 'basement') row = 'ground';
    const walkable = kind === 'floor' || kind === 'mezzanine' || kind === 'basement';
    levels.push({
      index,
      name: s.name,
      kind,
      floor_h,
      top_h,
      height: s.height,
      ceiling_h: top_h,
      build_up: 0,
      row,
      walkable,
      tag: s.tag,
    });
  });
  // ceiling = next walkable floor minus its build-up; the top storey's ceiling is the eaves line
  for (let i = 0; i < levels.length - 1; i++) {
    const next = levels[i + 1];
    const bu = next.walkable ? (b.storeys[i + 1].floor_build_up ?? opts.buildUp ?? FLOOR_BUILD_UP[cls]) : 0;
    next.build_up = bu;
    levels[i].ceiling_h = next.floor_h - bu;
  }
  const groundMin = opts.groundMin ?? b.ground_dtm?.min ?? base;
  const bottom_h = Math.min(base, groundMin) - PLINTH_EMBED;
  return {
    base_h: base,
    levels,
    floors: levels.filter((l) => l.walkable),
    eaves_h: h,
    plinth: { bottom_h, extension: base - bottom_h },
    wallHeight: h - base,
  };
}

/** Level that contains an absolute height (floor_h <= y < top_h), or null. */
export function levelAt(stack: StoreyStack, y: number): Level | null {
  return stack.levels.find((l) => y >= l.floor_h && y < l.top_h) ?? null;
}

/** Index (into Building.storeys) of the first walkable storey - where doors / portals sit. */
export function entranceStorey(stack: StoreyStack): number {
  return stack.floors[0]?.index ?? 0;
}
