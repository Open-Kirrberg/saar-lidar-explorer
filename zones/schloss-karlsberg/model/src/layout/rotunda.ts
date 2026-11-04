/**
 * KB-I24: layout of a round temple pavilion (pure, no three.js) - the Tempelzimmer / Rotunde at the garden end of
 * the picture gallery (research/10 §0.2, §b.1 KB-B07: a round temple room "à la grecque" with Ionic pilasters and large
 * glass doors, outside an Ionic rotunda with a pedimented portico and three steps down to the garden, reached from
 * the gallery through a colonnade [D T5, T1 p. 375, R12]). Sizes and the order's proportions are period norms
 * (`ROTUNDA` in grammar.ts) [N].
 *
 * Everything is in the building frame [s, t] (origin = circle centre, layout/footprint.ts) with absolute heights, so
 * the 3D exterior (exterior/rotunda.ts) and the plan sheets draw the same drum, bays, portico, steps and colonnade.
 * Angles are radians in [s, t] (atan2(t, s)); bays run counter-clockwise seen from above, bay 0 on the portico axis.
 */
import { dirEN } from '../frame.ts';
import type { RotundaBayKind, ST } from '../spec.ts';
import type { BuildingLayout } from './building.ts';
import { ROTUNDA } from './grammar.ts';

export interface RotundaOrder {
  name: 'ionic' | 'doric' | 'tuscan';
  /** Lower column diameter (= pilaster width) in m. */
  D: number;
  /** Column / pilaster height incl. base and capital (m). */
  columnH: number;
  /** Absolute heights of the column foot and of the entablature (bottom, top). */
  foot_h: number;
  entablature: [number, number];
  /** Heights of base and capital (m). */
  baseH: number;
  capitalH: number;
  /** Top diameter / lower diameter. */
  taper: number;
}

export interface RotundaOpening {
  /** Clear width at the outer face (m) and its half-angle seen from the centre. */
  width: number;
  half: number;
  bottom_h: number;
  top_h: number;
}

export interface RotundaBay {
  index: number;
  kind: RotundaBayKind;
  /** Centre angle and half-angle of the bay (pilaster centre to pilaster centre). */
  angle: number;
  half: number;
  opening: RotundaOpening;
}

export interface RotundaColumn {
  at: ST;
  D: number;
  foot_h: number;
  top_h: number;
}

export interface RotundaSteps {
  count: number;
  riser: number;
  tread: number;
  /** Distance from the centre along `dir` of the top nosing; steps run outwards (down) from it. */
  from: number;
  /** Unit direction the flight descends in. */
  dir: ST;
  halfWidth: number;
  /** Floor height at the top of the flight. */
  top_h: number;
}

export interface RotundaPortico {
  columns: RotundaColumn[];
  /** Distance from the centre of the front column line, and of the podium front edge. */
  front: number;
  podiumFront: number;
  /** Half the podium width and half the distance between the outer column centres. */
  halfWidth: number;
  halfSpan: number;
  floor_h: number;
  entablature: [number, number];
  /** Pediment over the cornice: base and apex heights of the raking cornice, half width at its base (m). */
  pediment: { base_h: number; apex_h: number; halfWidth: number } | null;
  /**
   * Attic block the portico roof ends against (wave-4 review): distances from the centre along the axis (front, back),
   * half width and top height; top ≥ the pediment's roof + ROTUNDA.atticBlockClear. Null without a pediment, and
   * null when the roof runs into the drum under a lead collar (ROTUNDA.porticoCollar, wave 10).
   */
  atticBlock: { front: number; back: number; halfWidth: number; top_h: number } | null;
  steps: RotundaSteps;
  /** Plan outline (podium + steps), CCW [s, t]. */
  outline: ST[];
}

export interface RotundaColonnade {
  /** Distances from the centre along −axis: where it leaves the drum (inside the wall) and its far end. */
  from: number;
  to: number;
  halfWidth: number;
  floor_h: number;
  entablature: [number, number];
  columns: RotundaColumn[];
  /** Steps up from the colonnade floor to the rotunda floor at the drum (null when level). */
  steps: RotundaSteps | null;
  to_id?: string;
  /** Plan outline, CCW [s, t]. */
  outline: ST[];
}

export interface RotundaLayout {
  radius: number;
  inner: number;
  wall: number;
  /** Portico axis (outwards) as an angle and a unit vector in [s, t]. */
  axisAngle: number;
  axis: ST;
  floor_h: number;
  /** Ceiling springing (top of the order) and the eaves (top of the attic, where the dome springs). */
  order: RotundaOrder;
  attic: [number, number];
  bays: RotundaBay[];
  /** Pilaster centre angles (between bays). */
  pilasters: number[];
  portico: RotundaPortico | null;
  colonnade: RotundaColonnade | null;
  tag: string;
}

const rot = (v: ST, a: number): ST => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
const add = (p: ST, v: ST, k: number): ST => [p[0] + v[0] * k, p[1] + v[1] * k];

/** Column height and diameter of an order that fills `height` (column + entablature) [N Vignola]. */
export function orderFor(name: RotundaOrder['name'], foot_h: number, height: number): RotundaOrder {
  const o = ROTUNDA.orders[name];
  const columnH = height / (1 + o.entablature);
  const D = columnH / o.diameters;
  return { name, D, columnH, foot_h, entablature: [foot_h + columnH, foot_h + height], baseH: o.base * D, capitalH: o.capital * D, taper: o.taper };
}

/** Steps between two levels with the grammar riser (count rounded up so no riser exceeds it). */
export function stepsBetween(drop: number, maxRiser: number = ROTUNDA.step.riser + 0.01): { count: number; riser: number } {
  if (drop <= 0.02) return { count: 0, riser: 0 };
  const count = Math.max(1, Math.ceil(drop / maxRiser - 1e-9));
  return { count, riser: drop / count };
}

/** Rectangle along a direction: from distance d0 to d1 (from the centre) and ±hw across, CCW. */
function band(dir: ST, d0: number, d1: number, hw: number): ST[] {
  const n: ST = [-dir[1], dir[0]];
  const a = add(add([0, 0], dir, d0), n, -hw);
  const b = add(add([0, 0], dir, d1), n, -hw);
  const c = add(add([0, 0], dir, d1), n, hw);
  const d = add(add([0, 0], dir, d0), n, hw);
  // CCW when d1 > d0 (dir rotated +90° is n)
  return d1 > d0 ? [a, b, c, d] : [d, c, b, a];
}

/** Layout of a building with `facade.rotunda` on a round footprint; null otherwise. */
export function rotundaLayout(L: BuildingLayout): RotundaLayout | null {
  const b = L.building;
  const spec = b.facade.rotunda;
  const f = L.frame;
  if (!spec || f.shape !== 'round') return null;
  const R = f.radius ?? f.width / 2;
  const wall = ROTUNDA.wall;
  const d = dirEN(spec.axis_azimuth);
  const axis: ST = [d[0] * f.sDir[0] + d[1] * f.sDir[1], d[0] * f.tDir[0] + d[1] * f.tDir[1]];
  const axisAngle = Math.atan2(axis[1], axis[0]);

  // order: the first walkable storey (the Saal) carries pilasters + entablature; storeys above it are the attic
  const saal = L.stack.floors[0];
  if (!saal) return null;
  const floor_h = saal.floor_h;
  const order = orderFor(spec.order, floor_h, saal.top_h - saal.floor_h);
  const attic: [number, number] = [saal.top_h, L.stack.eaves_h];

  // bays and pilasters
  const n = spec.bays.length;
  const half = Math.PI / n;
  const chord = 2 * R * Math.sin(half);
  const clear = chord - order.D;
  const doorTop = order.entablature[0] - ROTUNDA.doorHeadGap;
  const bays: RotundaBay[] = spec.bays.map((kind, i) => {
    const angle = axisAngle + i * 2 * half;
    let width = clear * ROTUNDA.doorBayShare;
    let bottom = floor_h;
    if (kind === 'niche') {
      width = clear * 0.5;
      bottom = floor_h + 0.6;
    }
    if (kind === 'link' && spec.colonnade) width = Math.min(clear * 0.8, spec.colonnade.width - 2 * order.D - 0.4);
    return { index: i, kind, angle, half, opening: { width, half: Math.asin(Math.min(0.99, width / 2 / R)), bottom_h: bottom, top_h: doorTop } };
  });
  const pilasters = bays.map((x) => x.angle + half);

  // portico (prostyle, one row of columns on the axis, pediment over the front) [D T5 form; N size]
  let portico: RotundaPortico | null = null;
  if (spec.portico) {
    const p = spec.portico;
    const front = R + p.depth;
    const halfWidth = p.width / 2;
    const halfSpan = halfWidth - order.D * 0.75;
    const nrm: ST = [-axis[1], axis[0]];
    const columns: RotundaColumn[] = [];
    for (let i = 0; i < p.columns; i++) {
      const off = p.columns === 1 ? 0 : -halfSpan + (2 * halfSpan * i) / (p.columns - 1);
      columns.push({ at: add(add([0, 0], axis, front), nrm, off), D: order.D, foot_h: floor_h, top_h: order.entablature[0] });
    }
    const podiumFront = front + order.D * 0.75;
    // "drei Stufen" down to the garden [D T5]; riser and tread N
    const steps: RotundaSteps = { count: p.steps, riser: ROTUNDA.step.riser, tread: ROTUNDA.step.tread, from: podiumFront, dir: axis, halfWidth: halfWidth + 0.3, top_h: floor_h };
    const back = Math.sqrt(Math.max(0, R * R - halfWidth * halfWidth)) - 0.2;
    const pitch = (ROTUNDA.pedimentPitch * Math.PI) / 180;
    // the raking cornice spans the portico cornice (outer column face + 0.35 m) [N]
    const corniceHalf = halfSpan + order.D / 2 + 0.35;
    const pediment = p.pediment ? { base_h: order.entablature[1], apex_h: order.entablature[1] + corniceHalf * Math.tan(pitch), halfWidth: corniceHalf } : null;
    // attic block: from just in front of the drum cornice back into the dome, a little wider than the pediment; its top
    // clears the pediment's lead roof (0.07 m over the raking cornice) [N]
    // wave 10 (audit #10): no block when the roof is flashed into the drum (ROTUNDA.porticoCollar)
    const atticBlock = pediment && !ROTUNDA.porticoCollar
      ? {
          front: R + 0.45,
          back: Math.sqrt(Math.max(0, R * R - (corniceHalf + 0.1) ** 2)) - 0.3,
          halfWidth: corniceHalf + 0.1,
          top_h: Math.max(L.stack.eaves_h, pediment.apex_h + 0.07 + ROTUNDA.atticBlockClear),
        }
      : null;
    const outline = band(axis, back, podiumFront + steps.count * steps.tread, steps.halfWidth);
    portico = { columns, front, podiumFront, halfWidth, halfSpan, floor_h, entablature: order.entablature, pediment, atticBlock, steps, outline };
  }

  // colonnade towards the neighbouring range (opposite the portico) [D T1 p. 375, R12; I length, form]
  let colonnade: RotundaColonnade | null = null;
  if (spec.colonnade) {
    const c = spec.colonnade;
    const back: ST = [-axis[0], -axis[1]];
    const hw = c.width / 2;
    const from = Math.sqrt(Math.max(0, R * R - hw * hw)) - wall;
    const to = R + c.length;
    const co = orderFor(spec.order, c.floor_h, c.eaves_h - c.floor_h);
    const nrm: ST = [-back[1], back[0]];
    const columns: RotundaColumn[] = [];
    const k = Math.max(1, c.columns_per_side);
    const d0 = R + co.D * 0.9;
    const d1 = to - co.D * 0.9;
    for (let i = 0; i < k; i++) {
      const dd = k === 1 ? (d0 + d1) / 2 : d0 + ((d1 - d0) * i) / (k - 1);
      for (const sgn of [-1, 1]) columns.push({ at: add(add([0, 0], back, dd), nrm, sgn * (hw - co.D * 0.6)), D: co.D, foot_h: c.floor_h, top_h: co.entablature[0] });
    }
    const st = stepsBetween(floor_h - c.floor_h, 0.17);
    const steps: RotundaSteps | null = st.count
      ? { count: st.count, riser: st.riser, tread: 0.3, from: R - 0.05, dir: back, halfWidth: hw - co.D * 1.3, top_h: floor_h }
      : null;
    colonnade = { from, to, halfWidth: hw, floor_h: c.floor_h, entablature: co.entablature, columns, steps, to_id: c.to, outline: band(back, from, to, hw) };
  }

  return {
    radius: R,
    inner: R - wall,
    wall,
    axisAngle,
    axis,
    floor_h,
    order,
    attic,
    bays,
    pilasters,
    portico,
    colonnade,
    tag: spec.tag ?? 'D T5 form (research/10 §b.1); N size and proportions',
  };
}

/** Point on the drum at `angle` and radius `r` (plan [s, t]). */
export function drumPoint(angle: number, r: number): ST {
  return [r * Math.cos(angle), r * Math.sin(angle)];
}

export { rot as rotateST };
