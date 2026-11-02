/**
 * Facade bay layout and openings (pure).
 *
 * Positions `a` are metres along a side from its left end p0 as seen from outside
 * (layout/footprint.ts). Axes are 0-based, counted left to right.
 */
import type { BuildingClass, Facade, FacadeSideSpec, HeadForm, OpeningKind, PortalSpec, Risalit, SideName } from '../spec.ts';
import {
  ARTICULATION,
  AXIS_SPACING,
  CELLAR_WINDOW,
  DORMER,
  MIN_END_PIER,
  BALCONY,
  MAIN_PERRON,
  PASSAGE_PORTICO,
  PORTAL,
  PORTAL_FRAME,
  PORTE_FENETRE_HEIGHT,
  PORTICO,
  SILL_WINDOW,
  MEMBERS,
  STAIR,
  WINDOW,
  type WindowRow,
  windowClass,
} from './grammar.ts';
import { type BuildingFrame, sidePoint, stToEN } from './footprint.ts';
import type { RoofSection } from './roof.ts';
import type { Level, StoreyStack } from './storeys.ts';

// ---------------------------------------------------------------------------------------------
// Rhythm and risalits
// ---------------------------------------------------------------------------------------------

/** "6 + 7 (centre risalit = Louisenhof core) + 6" -> [6, 7, 6]; null if not parseable. */
export function parseRhythm(text: string | undefined): number[] | null {
  if (!text) return null;
  const clean = text.replace(/\([^)]*\)/g, '');
  const parts = clean.split('+').map((p) => p.trim());
  if (parts.length < 2) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  return nums.every((n) => Number.isInteger(n) && n > 0) ? nums : null;
}

/**
 * Risalits implied by axis groups: odd group counts >= 3 have a centre risalit (middle group);
 * >= 5 groups also have corner risalits (first and last group). [N] 02 §2.6.
 */
export function risalitsFromGroups(side: SideName, groups: number[], projection = ARTICULATION.risalitProjection): Risalit[] {
  const out: Risalit[] = [];
  const n = groups.length;
  const starts: number[] = [];
  groups.reduce((acc, g) => {
    starts.push(acc);
    return acc + g;
  }, 0);
  if (n >= 3 && n % 2 === 1) {
    const m = (n - 1) / 2;
    out.push({ side, first_axis: starts[m], axis_count: groups[m], kind: 'centre', projection, tag: 'I from rhythm groups' });
  }
  if (n >= 5) {
    out.push({ side, first_axis: 0, axis_count: groups[0], kind: 'corner', projection, tag: 'I from rhythm groups' });
    out.push({ side, first_axis: starts[n - 1], axis_count: groups[n - 1], kind: 'corner', projection, tag: 'I from rhythm groups' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Bay layout
// ---------------------------------------------------------------------------------------------

export interface Bay {
  index: number;
  /** Axis centre along the side from p0 (m). */
  a: number;
  group: number;
  risalit: Risalit | null;
}

export interface RisalitSpan {
  risalit: Risalit;
  /** Extent along the side: half a spacing beyond the outer axes. */
  a0: number;
  a1: number;
}

export interface BayLayout {
  side: SideName;
  length: number;
  axes: number;
  spacing: number;
  from: number;
  to: number;
  /** Distance from `from` to the first axis-bay edge (= half the unused length). */
  margin: number;
  groups: number[];
  bays: Bay[];
  risalits: RisalitSpan[];
  /** Spacing had to be reduced to fit the axes. */
  compressed: boolean;
  blind: boolean;
}

export interface BayInput {
  side: SideName;
  length: number;
  axes: number;
  spacing?: number;
  from?: number;
  to?: number;
  groups?: number[];
  risalits?: Risalit[];
  cls?: BuildingClass;
  blind?: boolean;
}

export function layoutBays(inp: BayInput): BayLayout {
  const from = inp.from ?? 0;
  const to = inp.to ?? inp.length;
  const avail = Math.max(0, to - from);
  const axes = Math.max(0, Math.round(inp.axes));
  let spacing = inp.spacing ?? AXIS_SPACING[inp.cls ?? 'WING2'];
  let compressed = false;
  if (axes > 0 && axes * spacing > avail + 1e-6) {
    spacing = avail / axes;
    compressed = true;
  }
  const margin = (avail - axes * spacing) / 2;
  const groups = inp.groups && inp.groups.reduce((s, g) => s + g, 0) === axes ? inp.groups.slice() : [axes];
  const risalits = (inp.risalits ?? []).filter((r) => r.side === inp.side);
  const groupOf: number[] = [];
  groups.forEach((g, gi) => {
    for (let k = 0; k < g; k++) groupOf.push(gi);
  });
  const bays: Bay[] = [];
  for (let i = 0; i < axes; i++) {
    const a = from + margin + spacing * (i + 0.5);
    const r = risalits.find((q) => i >= q.first_axis && i < q.first_axis + q.axis_count) ?? null;
    bays.push({ index: i, a, group: groupOf[i] ?? 0, risalit: r });
  }
  const spans: RisalitSpan[] = risalits
    .filter((r) => r.first_axis >= 0 && r.first_axis + r.axis_count <= axes && r.axis_count > 0)
    .map((r) => {
      const a0 = from + margin + spacing * r.first_axis;
      const a1 = from + margin + spacing * (r.first_axis + r.axis_count);
      // corner risalits run out to the building corner
      return {
        risalit: r,
        a0: r.kind === 'corner' && r.first_axis === 0 ? Math.min(a0, 0) : a0,
        a1: r.kind === 'corner' && r.first_axis + r.axis_count === axes ? Math.max(a1, inp.length) : a1,
      };
    });
  return {
    side: inp.side,
    length: inp.length,
    axes,
    spacing,
    from,
    to,
    margin,
    groups,
    bays,
    risalits: spans,
    compressed,
    blind: !!inp.blind,
  };
}

/** Number of axes that fit on a side of length L at a spacing (with MIN_END_PIER at both ends). */
export function axesThatFit(length: number, spacing: number): number {
  return Math.max(0, Math.floor((length - 2 * MIN_END_PIER) / spacing + 1e-9));
}

/** Indices of the centre axis (odd) or the two centre axes (even). */
export function centreAxes(axes: number): number[] {
  if (axes <= 0) return [];
  return axes % 2 === 1 ? [(axes - 1) / 2] : [axes / 2 - 1, axes / 2];
}

/**
 * Resolve the axis spec of one side from a facade (v2 `sides` first, then v1 fields).
 * Long sides: v1 `axes_court_west` / `axes_garden_east` / `axes`. Ends: what fits.
 */
export function sideSpec(facade: Facade, side: SideName, sideLength: number, cls: BuildingClass): FacadeSideSpec {
  const v2 = facade.sides?.[side];
  if (v2) return v2;
  const spacing = facade.axis_spacing ?? AXIS_SPACING[cls];
  if (side === 'court' || side === 'garden') {
    const axes = (side === 'court' ? facade.axes_court_west : facade.axes_garden_east) ?? facade.axes;
    if (axes !== undefined) return { axes, spacing };
  }
  return { axes: axesThatFit(sideLength, spacing), spacing, tag: 'N axes that fit' };
}

// ---------------------------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------------------------

export interface FacadeOpening {
  side: SideName;
  storey: number;
  /** Axis index; for openings spanning two axes, the left one. */
  axis: number;
  kind: OpeningKind;
  a: number;
  width: number;
  height: number;
  /** Sill above the storey floor (negative for a Durchfahrt starting at court level). */
  sill: number;
  /** Absolute bottom and top (m DHHN2016). */
  bottom_h: number;
  top_h: number;
  head: HeadForm;
  /** Freitreppe steps in front (portal) or perron steps (door with `steps`). */
  steps?: number;
  /** Grade the steps start from (m DHHN2016); undefined = base_h. */
  grade_h?: number;
  /**
   * Columned portico in front (portal spec `portico`). On a Durchfahrt (wave-8 review fix, KB-I72) the columns stand on
   * the court and carry a balcony deck at `deck_h` (the floor of the storey above, PASSAGE_PORTICO).
   */
  portico?: { columns: number; balcony: boolean; depth: number; deck_h?: number; tag?: string };
  /** Window row of the storey (glazing class, KB-I16); null for plinth / basement / kneewall openings. */
  row?: WindowRow | null;
  /** KB-I17: window cap (Verdachung): only CdL Beletage axes in the centre risalit [HMS; research/09 G7]. */
  hood?: boolean;
  /** KB-I17: iron balconet in front (catalogue porte-fenêtre on an upper storey; never a class default). */
  balcony?: boolean;
  /**
   * Wave-8 review fix (KB-I72): continuous balcony (portal spec `balcony_run`, grammar BALCONY) from `a0` to `a1` along
   * the side, `depth` m deep, its deck at this opening's bottom_h; set on the first porte-fenêtre of the run only.
   */
  balconyRun?: { a0: number; a1: number; depth: number; tag?: string };
  tag: string;
}

/** Freitreppe in front of an opening with steps (no portico): the shared numbers of exterior, court and plans. */
export interface FreitreppePlan {
  /** Main perron (MAIN_PERRON: portal without portico) or a plain stair (doors). */
  main: boolean;
  /** Half width of the flight between the cheek walls (m, from the opening axis). */
  halfWidth: number;
  tread: number;
  /** Top landing depth (m). */
  landing: number;
  /** Total run from the wall face to the stair foot (m). */
  depth: number;
  cheek: number;
  cheekAbove: number;
  /** Foot pedestal [width, depth, height above grade] centred on each cheek; null = none. */
  pedestal: readonly [number, number, number] | null;
}

/**
 * Freitreppe numbers for an opening with steps and no portico. Main portals (wave-8 review fix, KB-I72) get the broad
 * MAIN_PERRON (as wide as the PORTAL_FRAME plus `beyondFrame`, landing, stepped cheeks, pedestals); doors keep the
 * plain stair (width + 1.2 m, 0.4 m treads, 0.3 m top step, 0.35 m cheeks).
 */
export function freitreppePlan(o: Pick<FacadeOpening, 'kind' | 'width' | 'steps' | 'portico'>): FreitreppePlan | null {
  const n = o.steps ?? 0;
  if (n <= 0 || o.portico) return null;
  if (o.kind === 'portal') {
    const P = MAIN_PERRON;
    const halfWidth = o.width / 2 + ARTICULATION.surround.face + PORTAL_FRAME.pilaster + P.beyondFrame;
    return { main: true, halfWidth, tread: P.tread, landing: P.landing, depth: P.landing + (n - 1) * P.tread, cheek: P.cheek, cheekAbove: P.cheekAbove, pedestal: P.pedestal };
  }
  return { main: false, halfWidth: (o.width + 1.2) / 2, tread: 0.4, landing: 0.3, depth: n * 0.4 + 0.3, cheek: 0.35, cheekAbove: 0.15, pedestal: null };
}

/**
 * Wave-9 review fix (KB-I72): along-facade offsets (from the portal axis, signed: [left, right]) of the sentry pair at
 * the foot of a main perron, snapped to the pier centres between the window bays of the portal storey, so the boxes
 * stand on the piers beside the cheek pedestals and not in front of a window. `clear` is the half width the stair keeps
 * (cheeks + pedestals), `box` the sentry box width, `gap` its gap to the stair. A pier is taken when the box still
 * clears the stair (`clear` + 0.05) and the pier centre is within 1.5 m of the unsnapped place; otherwise that place
 * is kept. Null for openings without a main perron.
 */
export function perronSentryAlong(
  o: Pick<FacadeOpening, 'kind' | 'width' | 'steps' | 'portico' | 'side' | 'storey' | 'a'>,
  openings: readonly Pick<FacadeOpening, 'side' | 'storey' | 'a' | 'width'>[],
  clear: number,
  box: number,
  gap: number,
): [number, number] | null {
  if (!freitreppePlan(o)?.main) return null;
  const want = clear + gap + box / 2;
  const min = clear + 0.05 + box / 2;
  const out: number[] = [];
  for (const sg of [-1, 1]) {
    // openings of the portal storey on this side of the axis, nearest first, as [near edge, far edge] offsets
    const bays = openings
      .filter((w) => w !== o && w.side === o.side && w.storey === o.storey && sg * (w.a - o.a) > 0.1)
      .map((w) => [sg * (w.a - o.a) - w.width / 2, sg * (w.a - o.a) + w.width / 2] as const)
      .sort((x, y) => x[0] - y[0]);
    let best = want;
    let dist = 1.5;
    for (let i = 0; i + 1 < bays.length; i++) {
      const c = (bays[i][1] + bays[i + 1][0]) / 2;
      if (c >= min - 1e-9 && Math.abs(c - want) <= dist) {
        best = c;
        dist = Math.abs(c - want);
      }
    }
    out.push(sg * best);
  }
  return [out[0], out[1]];
}

export interface FacadeOpeningInput {
  cls: BuildingClass;
  side: SideName;
  layout: BayLayout;
  stack: StoreyStack;
  portals?: PortalSpec[];
  /** Side window type (FacadeSideSpec.window_kind): 'window' turns class portes-fenêtres into sill windows. */
  windowKind?: 'window' | 'porte_fenetre';
  /** FacadeSideSpec.window_kind_storeys: storeys `windowKind` applies to (absent = all main storeys). */
  windowKindStoreys?: number[];
}

function fit(nominalH: number, level: Level, sill: number, lintel: number): number {
  return Math.min(nominalH, level.height - sill - lintel);
}

/** Resolve 'centre' to axis indices and the spanned axes. */
export function portalAxes(p: PortalSpec, axes: number): number[] {
  const span = Math.max(1, p.span_axes ?? 1);
  if (p.axis === 'centre') {
    const c = centreAxes(axes);
    if (span === 1) return c; // even axis count: the two centre axes
    const mid = (axes - span) / 2;
    const first = Math.round(mid);
    return Array.from({ length: span }, (_, k) => first + k);
  }
  return Array.from({ length: span }, (_, k) => (p.axis as number) + k);
}

/** All facade openings of one side, storey by storey. */
export function facadeOpenings(inp: FacadeOpeningInput): FacadeOpening[] {
  const { layout, stack, cls, side } = inp;
  if (layout.blind || layout.axes === 0) return [];
  const out: FacadeOpening[] = [];
  const wc = windowClass(cls);
  const portals = (inp.portals ?? []).filter((p) => p.side === side);
  const entrance = stack.floors[0]?.index ?? 0;

  // axes taken by portals, per storey (a Durchfahrt also removes the plinth window below)
  const taken = new Map<number, Set<number>>();
  const take = (storey: number, ax: number) => {
    if (!taken.has(storey)) taken.set(storey, new Set());
    taken.get(storey)!.add(ax);
  };
  const plinth = stack.levels.find((l) => l.kind === 'plinth');

  for (const p of portals) {
    const storey = p.storey ?? entrance;
    const level = stack.levels[storey];
    if (!level) continue;
    const axes = portalAxes(p, layout.axes).filter((i) => i >= 0 && i < layout.axes);
    if (!axes.length) continue;
    const a = (layout.bays[axes[0]].a + layout.bays[axes[axes.length - 1]].a) / 2;
    if (p.kind === 'porte_fenetre') {
      // one porte-fenetre per spanned axis
      const run = p.balcony_run && storey > entrance;
      const w = p.width ?? WINDOW[wc][level.row ?? 'ground'].width;
      for (const ax of axes) {
        const h = Math.min(p.height ?? PORTE_FENETRE_HEIGHT, level.height - 0.6);
        const o = mk(side, storey, ax, 'porte_fenetre', layout.bays[ax].a, w, h, 0, level, 'straight', p.tag ?? PORTAL.porte_fenetre.tag);
        // a catalogue porte-fenêtre above the entrance storey opens onto a balcony (the catalogue names it) [KB-I17]
        if (storey > entrance && p.balconet !== false && !run) o.balcony = true; // not onto an Altan / terrace (wave-7 fix)
        // wave-8 review fix (KB-I72): one continuous balcony across the run instead of a balconet per door
        if (run && ax === axes[0]) {
          const a0 = layout.bays[axes[0]].a - w / 2 - BALCONY.overhang;
          const a1 = layout.bays[axes[axes.length - 1]].a + w / 2 + BALCONY.overhang;
          o.balconyRun = { a0, a1, depth: p.balcony_run!.depth ?? BALCONY.depth, tag: typeof p.balcony_run!.tag === 'string' ? p.balcony_run!.tag : BALCONY.tag };
        }
        if (hooded(cls, level, layout.bays[ax])) o.hood = true;
        out.push(o);
        take(storey, ax);
      }
      continue;
    }
    const base = p.kind === 'carriage_gate' ? PORTAL.carriage_gate : p.kind === 'door' ? PORTAL.door : PORTAL[p.kind];
    const width = Math.min(p.width ?? base.width, layout.spacing * axes.length - 0.6);
    if (p.kind === 'durchfahrt' && plinth && storey === entrance) {
      // passage from court level through the plinth into the ground floor
      const sill = -(level.floor_h - plinth.floor_h);
      const height = Math.min(p.height ?? base.height, level.top_h - plinth.floor_h - 0.5);
      const o = mk(side, storey, axes[0], 'durchfahrt', a, width, height, sill, level, base.head, p.tag ?? base.tag);
      // wave-8 review fix (KB-I72): columned porch in front of the passage, balcony deck at the floor above
      const above = stack.levels.find((l) => l.index === storey + 1);
      if (p.portico) o.portico = { columns: p.portico.columns, balcony: p.portico.balcony, depth: p.portico.depth ?? PASSAGE_PORTICO.depth, deck_h: above?.floor_h, tag: typeof p.portico.tag === 'string' ? p.portico.tag : undefined };
      out.push(o);
      for (const ax of axes) take(plinth.index, ax);
    } else {
      const height = Math.min(p.height ?? base.height, level.height - 0.4);
      const o = mk(side, storey, axes[0], p.kind, a, width, height, 0, level, base.head, p.tag ?? base.tag);
      if (p.kind === 'portal' && plinth && storey === entrance) {
        o.steps = p.steps ?? Math.ceil((level.floor_h - plinth.floor_h) / STAIR.freitreppe.riser - 1e-6);
      } else if (p.steps) o.steps = p.steps; // perron in front of a door (fix round 1)
      if (p.grade_h !== undefined) o.grade_h = p.grade_h;
      if (p.portico) o.portico = { columns: p.portico.columns, balcony: p.portico.balcony, depth: p.portico.depth ?? PORTICO.depth, tag: p.portico.tag };
      out.push(o);
      if (plinth && storey === entrance && p.kind === 'portal') for (const ax of axes) take(plinth.index, ax);
      // wave-8 review fix (KB-I72): the broad main perron covers the cellar windows of the neighbouring axes
      const fp = freitreppePlan(o);
      if (plinth && storey === entrance && fp?.main) for (const b of layout.bays) if (Math.abs(b.a - a) < fp.halfWidth + fp.cheek + CELLAR_WINDOW.width / 2 + 0.1) take(plinth.index, b.index);
    }
    for (const ax of axes) take(storey, ax);
  }

  for (const level of stack.levels) {
    const free = (ax: number) => !taken.get(level.index)?.has(ax);
    if (level.kind === 'plinth') {
      if (level.height < CELLAR_WINDOW.height + CELLAR_WINDOW.sill + 0.1) continue;
      for (const b of layout.bays) {
        if (!free(b.index)) continue;
        out.push(mk(side, level.index, b.index, 'cellar_window', b.a, CELLAR_WINDOW.width, CELLAR_WINDOW.height, CELLAR_WINDOW.sill, level, 'straight', CELLAR_WINDOW.tag));
      }
      continue;
    }
    if (level.kind === 'kneewall') {
      if (level.height < 1.0) continue;
      const w = WINDOW.STABLE.upper;
      for (const b of layout.bays) {
        if (!free(b.index) || b.index % 2 === 1) continue;
        const h = fit(w.height, level, Math.min(w.sill, level.height / 4), 0.1);
        if (h > 0.3) out.push(mk(side, level.index, b.index, 'window', b.a, w.width, h, Math.min(w.sill, level.height / 4), level, w.head, w.tag));
      }
      continue;
    }
    if (level.kind === 'basement') {
      const w = WINDOW.WING2.ground;
      for (const b of layout.bays) {
        if (!free(b.index)) continue;
        const sill = Math.min(1.2, level.height * 0.25);
        const h = fit(w.height, level, sill, 0.8);
        if (h > 0.4) out.push(mk(side, level.index, b.index, 'window', b.a, w.width, h, sill, level, 'segmental', 'N basement window'));
      }
      continue;
    }
    if (!level.row) continue;
    const sillWindows = inp.windowKind === 'window' && WINDOW[wc][level.row].sill === 0 && (!inp.windowKindStoreys || inp.windowKindStoreys.includes(level.index));
    const w = sillWindows ? SILL_WINDOW[level.row] : WINDOW[wc][level.row];
    const kind: OpeningKind = cls === 'STABLE' && level.row === 'ground' ? 'stall_window' : w.sill === 0 ? 'porte_fenetre' : 'window';
    for (const b of layout.bays) {
      if (!free(b.index)) continue;
      const width = Math.min(w.width, layout.spacing - 0.8);
      const h = fit(w.height, level, w.sill, w.lintel);
      if (h <= 0.4 || width <= 0.3) continue;
      const o = mk(side, level.index, b.index, kind, b.a, width, h, w.sill, level, w.head, w.tag);
      if (hooded(cls, level, b)) o.hood = true;
      out.push(o);
    }
  }
  return out;
}

/** KB-I17: Verdachung only on the Beletage axes of a CdL centre risalit (MEMBERS.hoodedAxes) [HMS; research/09 G7]. */
function hooded(cls: BuildingClass, level: Level, bay: Bay | undefined): boolean {
  return MEMBERS.hoodedAxes.has(cls) && level.row === 'upper' && bay?.risalit?.kind === 'centre';
}

function mk(
  side: SideName,
  storey: number,
  axis: number,
  kind: OpeningKind,
  a: number,
  width: number,
  height: number,
  sill: number,
  level: Level,
  head: HeadForm,
  tag: string,
): FacadeOpening {
  const bottom_h = level.floor_h + sill;
  return { side, storey, axis, kind, a, width, height, sill, bottom_h, top_h: bottom_h + height, head, row: level.row, tag };
}

/**
 * Drop openings whose bottom lies below the terrain in front of them (e.g. the Orangerie
 * basement on the parterre side, cellar windows on rising ground). `groundAt(E, N)` returns
 * the terrain height (m DHHN2016) `probe` m in front of the wall, NaN = unknown (kept).
 * Windows need `clearance` above grade; sill-0 openings may be up to `doorTolerance` below it.
 * Durchfahrten, portals and carriage gates are always kept.
 */
export function cullBuriedOpenings(
  openings: FacadeOpening[],
  frame: BuildingFrame,
  groundAt: (E: number, N: number) => number,
  clearance = 0.1,
  probe = 1.0,
  doorTolerance = 0.3,
): FacadeOpening[] {
  return openings.filter((o) => {
    if (o.kind === 'durchfahrt' || o.kind === 'portal' || o.kind === 'carriage_gate') return true;
    const [E, N] = stToEN(frame, sidePoint(frame, o.side, o.a, -probe));
    const g = groundAt(E, N);
    if (!Number.isFinite(g)) return true;
    // doors / portes-fenetres may sit at grade or up to one step below it
    if (o.sill <= 0 || o.kind === 'door' || o.kind === 'porte_fenetre') return o.bottom_h >= g - doorTolerance;
    return o.bottom_h >= g + clearance;
  });
}

// ---------------------------------------------------------------------------------------------
// Roof openings (dormers, oculi)
// ---------------------------------------------------------------------------------------------

export interface RoofOpening {
  side: SideName;
  axis: number;
  kind: 'dormer' | 'oculus';
  a: number;
  /** Horizontal distance from the eaves line (wall face) to the opening's front plane (m). */
  inset: number;
  bottom_h: number;
  width: number;
  height: number;
  head: HeadForm;
  tag: string;
}

export interface RoofOpeningOptions {
  lower?: 'every' | 'alternate' | 'none';
  upper?: 'every' | 'alternate' | 'none';
  head?: HeadForm | 'alternating';
}

/**
 * Dormers in the mansard Brisis (one per axis [HMS]) and oculi in the Terrasson (every second
 * axis [HMS]) for a side; hip/gable roofs get plain dormers on every second axis when the roof
 * is tall enough. Returns [] for roofs without openings.
 */
export function roofOpenings(layout: BayLayout, section: RoofSection, opts: RoofOpeningOptions = {}): RoofOpening[] {
  const out: RoofOpening[] = [];
  if (layout.side !== 'court' && layout.side !== 'garden') return out;
  const pick = (mode: 'every' | 'alternate' | 'none', i: number) => mode === 'every' || (mode === 'alternate' && i % 2 === 0);
  if (section.type === 'mansard' && section.break_h !== undefined && section.break_inset !== undefined) {
    const lower = opts.lower ?? 'every';
    const hb = section.break_h - section.eaves_h;
    const h = Math.min(DORMER.lower.height, hb - DORMER.lower.sillAboveEaves - 0.2);
    for (const b of layout.bays) {
      if (!pick(lower, b.index) || h < 0.8) continue;
      const head: HeadForm = opts.head === 'alternating' ? (b.index % 2 ? 'triangular' : 'segmental') : (opts.head ?? DORMER.lower.head);
      const bottom = section.eaves_h + DORMER.lower.sillAboveEaves;
      out.push({
        side: layout.side,
        axis: b.index,
        kind: 'dormer',
        a: b.a,
        inset: (DORMER.lower.sillAboveEaves / hb) * section.break_inset,
        bottom_h: bottom,
        width: Math.min(DORMER.lower.width, layout.spacing - 0.8),
        height: h,
        head,
        tag: DORMER.lower.tag,
      });
    }
    const upper = opts.upper ?? 'alternate';
    if (section.pitch_upper >= 12 && section.deck_width === 0) {
      const up = section.rise - hb;
      const dOc = Math.min(DORMER.oculus.diameter, up * 0.5);
      for (const b of layout.bays) {
        if (!pick(upper, b.index) || dOc < 0.4) continue;
        const bottom = section.break_h + up * 0.25;
        const inset = section.break_inset + (up * 0.25) / Math.tan((section.pitch_upper * Math.PI) / 180);
        out.push({ side: layout.side, axis: b.index, kind: 'oculus', a: b.a, inset, bottom_h: bottom, width: dOc, height: dOc, head: 'round', tag: DORMER.oculus.tag });
      }
    }
    return out;
  }
  if ((section.type === 'hip' || section.type === 'gable') && section.rise >= 3.5) {
    const lower = opts.lower ?? 'alternate';
    const tanP = Math.tan((section.pitch_lower * Math.PI) / 180);
    for (const b of layout.bays) {
      if (!pick(lower, b.index)) continue;
      const bottom = section.eaves_h + 0.6;
      out.push({
        side: layout.side,
        axis: b.index,
        kind: 'dormer',
        a: b.a,
        inset: 0.6 / tanP,
        bottom_h: bottom,
        width: DORMER.hip.width,
        height: DORMER.hip.height,
        head: 'straight',
        tag: DORMER.hip.tag,
      });
    }
  }
  return out;
}
