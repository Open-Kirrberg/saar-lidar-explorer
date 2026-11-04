/**
 * Grundrisse 1:200 (floor plans) of the buildings with interiors, one sheet per storey:
 *   cellar   : Kellergeschoss (documented cellars without room division, or basement rooms)
 *   rooms    : storey with catalogue rooms (EG, Beletage / OG)
 *   mansard  : Mansardgeschoss = roof level at the eaves, cut at +1.20 m (no room data: U)
 * Everything comes from layoutBuilding() + b.rooms / b.openings / b.stairs.
 */
import type { BuildingLayout } from '../../../model/src/layout/building.ts';
import { sidePoint } from '../../../model/src/layout/footprint.ts';
import { PASSAGE_PORTICO, WALL_THICKNESS } from '../../../model/src/layout/grammar.ts';
import { freitreppePlan } from '../../../model/src/layout/facade.ts';
import { outerWall } from '../../../model/src/layout/fachwerk.ts';
import { roomArea } from '../../../model/src/layout/rooms.ts';
import type { Building, Opening, SideName, SiteSpec, ST } from '../../../model/src/spec.ts';
import { CONF_DE, PLACEMENT_DE, evidenceNote, sourcesNote, sw, tagShort } from '../evidence.ts';
import { dimChain, drawDimChain } from '../geom/dims.ts';
import { type Rect, partitionThickness, planCells, rectOf, rectPoly, wallDepth } from '../geom/plan.ts';
import { buildingRoof, roofLevelSet } from '../geom/roof3d.ts';
import { columnsOf, flightPoly, flightWalk, nosings, stairPlans } from '../geom/stairs.ts';
import { planView } from '../geom/transform.ts';
import { type SectionDef, sectionDefs, sectionLineEN } from '../sections.ts';
import { type LegendItem, MARGIN, Sheet, type SheetSize, SHEET_MM, TITLE_H, northArrow, wrap } from '../sheet.ts';
import { type P2, circle, de, el, g, line, path, rel, text, textWidth } from '../svg.ts';
import { add, bboxOf, datumOf, planUpAzimuth, shortStorey, stPaper, swingArc } from './common.ts';

const SCALE = 200;

export type PlanKind = 'cellar' | 'rooms' | 'mansard';
export interface PlanReq {
  building: string;
  kind: PlanKind;
  /** Storey index (cellar/rooms); mansard uses the eaves. */
  storey: number;
  sheetNo: string;
}

/** Which floor plans exist (documented cellars only where known). */
export function planRequests(spec: SiteSpec): PlanReq[] {
  const ids = ['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B05', 'KB-B06', 'KB-B10'];
  const out: PlanReq[] = [];
  let k = 1;
  const no = () => `GR-${String(k++).padStart(2, '0')}`;
  for (const id of ids) {
    const b = spec.buildings.find((x) => x.id === id);
    if (!b) continue;
    // documented cellars: KB-B02 (LiDAR KB-02, vaulted cellars, floor 342.4 [D LiDAR])
    if (id === 'KB-B02') out.push({ building: id, kind: 'cellar', storey: 0, sheetNo: no() });
    const storeys = [...new Set((b.rooms ?? []).map((r) => r.storey))].sort((a, c) => a - c);
    for (const s of storeys) out.push({ building: id, kind: 'rooms', storey: s, sheetNo: no() });
    if (b.roof.type === 'mansard') out.push({ building: id, kind: 'mansard', storey: b.storeys.length, sheetNo: no() });
  }
  return out;
}

/** Cellar floor of KB-B02 [D LiDAR research/05 design levels]. */
const CELLAR_FLOOR: Record<string, { h: number; tag: string }> = {
  'KB-B02': { h: 342.4, tag: 'D LiDAR KB-02 (research/05 design levels): vaulted cellars ≈ 2 m below the court' },
};

interface Ctx {
  spec: SiteSpec;
  b: Building;
  L: BuildingLayout;
  P: (s: number, t: number) => P2;
  dirP: (v: ST) => P2;
  k: number;
  outline: Rect;
  spaces: Rect[];
  parts: string[];
  labels: string[];
}

function storeyName(b: Building, req: PlanReq): string {
  if (req.kind === 'mansard') return 'Mansardgeschoss';
  if (req.kind === 'cellar') return 'Kellergeschoss';
  const nm = shortStorey(b.storeys[req.storey].name);
  return /^Erdgeschoss|^Saal|^Galerie/i.test(nm) ? nm : nm;
}

export function grundrissSheet(spec: SiteSpec, layoutOf: (b: Building) => BuildingLayout, req: PlanReq): Sheet {
  const b = spec.buildings.find((x) => x.id === req.building)!;
  const L = layoutOf(b);
  const up = planUpAzimuth(L, spec);
  const outline: Rect = { s0: -L.frame.length / 2, s1: L.frame.length / 2, t0: -L.frame.width / 2, t1: L.frame.width / 2 };
  // size: plan bbox + 34 mm each side for dims/axes; pick the smallest sheet that fits
  const probe = planView(SCALE, L.frame.centreEN, [0, 0], up);
  const pp = stPaper(L, probe);
  const corners = rectPoly(outline).map(([s, t]) => pp.P(s, t));
  const bb = bboxOf(corners);
  const need: [number, number] = [bb.x1 - bb.x0 + 2 * 36, bb.y1 - bb.y0 + 2 * 36];
  const size = pickSize(need);
  const sheet = new Sheet(size, `${req.sheetNo} ${b.id} ${storeyName(b, req)}`);
  const [W, H] = SHEET_MM[size];
  const areaH = H - MARGIN.top - MARGIN.bottom - TITLE_H - 3;
  const cx = MARGIN.left + (W - MARGIN.left - MARGIN.right) / 2;
  const cy = MARGIN.top + areaH / 2 + 2;
  const view = planView(SCALE, L.frame.centreEN, [cx - (bb.x0 + bb.x1) / 2, cy - (bb.y0 + bb.y1) / 2], up);
  const { P, dirP, k } = stPaper(L, view);

  const ctx: Ctx = { spec, b, L, P, dirP, k, outline, spaces: [], parts: [], labels: [] };
  const datum = datumOf(spec, layoutOf, b);
  let floorH: number;
  let infoExtra: string[] = [];
  if (req.kind === 'mansard') {
    floorH = L.stack.eaves_h;
    drawMansard(ctx, floorH);
    infoExtra = ['Dachgeschoss: keine Raumdaten im Katalog (U); dargestellt sind Dachschnitt in 1,20 m Höhe, Dachknick, Gauben (Layout).'];
  } else if (req.kind === 'cellar' && !(b.rooms ?? []).some((r) => r.storey === req.storey)) {
    const cf = CELLAR_FLOOR[b.id];
    floorH = cf?.h ?? L.stack.base_h - 2.4;
    drawCellarOutline(ctx, req.storey, cf?.tag ?? 'U');
    infoExtra = [`Kellersohle ${de(floorH)} m ü. NHN [${tagShort(cf?.tag) || 'U'}]; Gewölbe und Raumteilung unbekannt (U).`];
  } else {
    floorH = L.stack.levels[req.storey].floor_h;
    drawRooms(ctx, req.storey);
  }
  // floor level box
  const lvlLabel = `FFB ${rel(floorH, datum.h)} = ${de(floorH)} m ü. NHN`;

  // dimension chains, axes, section markers
  dims(ctx, req);
  const sections = sectionDefs(spec).filter((d) => d.building === b.id);
  for (const d of sections) sectionMarker(ctx, d);

  sheet.add(g({ id: 'plan' }, ...ctx.parts));
  sheet.add(g({ id: 'labels' }, ...ctx.labels));
  sheet.frame();
  sheet.add(northArrow([MARGIN.left + 16, MARGIN.top + 17], up, L.frame.centreEN[0], L.frame.centreEN[1]));

  const rooms = (b.rooms ?? []).filter((r) => r.storey === req.storey && req.kind !== 'mansard');
  const nD = rooms.filter((r) => /(^|[^A-Za-z])D(?![A-Za-z-])/.test(r.tag) || /HMS/.test(r.tag)).length;
  sheet.band({
    title: {
      sheetNo: req.sheetNo,
      title: `Grundriss ${storeyName(b, req)}`,
      subtitle: `${b.name_de} (${b.id})`,
      scale: '1:200',
      info: [
        `Konfidenz Gebäude: ${CONF_DE[b.confidence]} · Lage: ${PLACEMENT_DE[b.placement]}`,
        rooms.length ? `${rooms.length} Räume, davon ${nD} mit Namens-/Funktionsbeleg (D/HMS); Lage der Räume erschlossen (I/N)` : (infoExtra[0] ?? ''),
        `Außenmaße ${de(L.frame.length)} × ${de(L.frame.width)} m · Traufe ${de(L.stack.eaves_h)} m ü. NHN`,
      ].filter(Boolean),
    },
    info: [lvlLabel, `±0,00 = ${de(datum.h)} m ü. NHN`, `(${datum.label})`, 'Maße in m; Wandstärken N'],
    scale: SCALE,
    legend: planLegend(req.kind),
    notes: [
      evidenceNote()[0],
      'Raumprogramm: research/05 §e + Katalog v2 (scripts/catalogue-v2/programme.ts); Raumnamen z. T. belegt (Raumführer, LP06-Legende, PV 1791), ihre Lage erschlossen. Tür-/Fenstermaße und Wandstärken nach Epochennorm (research/02).',
      sourcesNote()[1],
    ],
  });
  return sheet;
}

function pickSize(need: [number, number]): SheetSize {
  for (const s of ['A3', 'A2'] as SheetSize[]) {
    const [W, H] = SHEET_MM[s];
    const aw = W - MARGIN.left - MARGIN.right;
    const ah = H - MARGIN.top - MARGIN.bottom - TITLE_H - 3;
    if (need[0] <= aw && need[1] <= ah) return s;
  }
  return 'A2';
}

// ---------------------------------------------------------------------------------------------
// Rooms storey
// ---------------------------------------------------------------------------------------------

export function spacesOf(b: Building, storey: number): { rects: Rect[]; ids: Map<string, Rect> } {
  const ids = new Map<string, Rect>();
  const rects: Rect[] = [];
  for (const r of b.rooms ?? []) {
    if (r.storey !== storey) continue;
    const q = rectOf(r.polygon);
    if (q) {
      rects.push(q);
      ids.set(r.id, q);
    }
  }
  for (const st of b.stairs ?? []) {
    if (storey < st.storey_from || storey > st.storey_to) continue;
    const q = rectOf(st.polygon);
    if (q && !rects.some((r) => Math.abs(r.s0 - q.s0) < 0.01 && Math.abs(r.t0 - q.t0) < 0.01 && Math.abs(r.s1 - q.s1) < 0.01)) rects.push(q);
  }
  return { rects, ids };
}

function drawRooms(c: Ctx, storey: number): void {
  const { b, L, P, parts } = c;
  const { rects, ids } = spacesOf(b, storey);
  c.spaces = rects;
  const wallT = outerWall(b, storey).thickness; // KB-I21: 0.30 m on Fachwerk storeys
  const cells = planCells(c.outline, rects, { outerThickness: wallT + 0.25, outerWall: wallT });
  const poly = (r: Rect) => rectPoly(r).map(([s, t]) => P(s, t));
  for (const v of cells.voids) parts.push(path(poly(v), true, { class: 'void' }));
  for (const w of cells.walls) parts.push(path(poly(w), true, { class: w.outer ? 'poche-d' : 'poche-i' }));
  // room edges: faces of outer walls solid, faces of inferred partitions dashed
  for (const r of rects) {
    const pts = rectPoly(r);
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const q = pts[(i + 1) % 4];
      const mid: ST = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2];
      const dir: ST = [q[0] - a[0], q[1] - a[1]];
      const len = Math.hypot(dir[0], dir[1]);
      const outN: ST = [dir[1] / len, -dir[0] / len]; // CCW rect: outward = edge rotated CW
      const probe = add(mid, outN, 0.08);
      const onOuter = cells.walls.some((w) => w.outer && probe[0] > w.s0 && probe[0] < w.s1 && probe[1] > w.t0 && probe[1] < w.t1);
      parts.push(line(P(a[0], a[1]), P(q[0], q[1]), { class: onOuter ? 'pen-l' : 'pen-m hid' }));
    }
  }
  for (const v of cells.voids) {
    const ar = (v.s1 - v.s0) * (v.t1 - v.t0);
    if (ar < 6) continue;
    const cp = P((v.s0 + v.s1) / 2, (v.t0 + v.t1) / 2);
    c.labels.push(text(cp, 'ohne Raumbefund [U]', { size: 1.8, anchor: 'middle', class: 'halo muted i' }));
  }
  parts.push(path(rectPoly(c.outline).map(([s, t]) => P(s, t)), true, { class: 'pen-xl' }));

  // openings: facade (layout) then interior (catalogue)
  for (const o of L.openings) if (o.storey === storey) facadeOpening(c, o.side, o.a, o.width, o.kind, storey);
  for (const o of b.openings ?? []) if (o.storey === storey) interiorOpening(c, o, ids);
  freitreppen(c, storey);
  for (const st of b.stairs ?? []) if (storey === st.storey_from || storey === st.storey_to) drawStair(c, st, storey);
  drawColumns(c, storey);
  roomLabels(c, storey);
}

/** Opening in an exterior side (white-out of the wall, window / door symbol). */
function facadeOpening(c: Ctx, side: SideName, a: number, w: number, kind: string, storey?: number): void {
  const { L, P, parts } = c;
  const sd = L.frame.sides[side];
  const tan = sd.tangent;
  const nin: ST = [-sd.normal[0], -sd.normal[1]];
  const face = sidePoint(L.frame, side, a, 0);
  const D = wallDepth(add(face, nin, 0.01), nin, c.spaces, 2.6, storey === undefined ? WALL_THICKNESS[c.b.cls] : outerWall(c.b, storey).thickness) + 0.01;
  const pA = add(face, tan, -w / 2);
  const pB = add(face, tan, w / 2);
  const iA = add(pA, nin, D);
  const iB = add(pB, nin, D);
  const Pp = (q: ST) => P(q[0], q[1]);
  parts.push(path([Pp(pA), Pp(pB), Pp(iB), Pp(iA)], true, { fill: '#fff', stroke: 'none' }));
  parts.push(line(Pp(pA), Pp(iA), { class: 'pen-l' }), line(Pp(pB), Pp(iB), { class: 'pen-l' }));
  if (kind === 'window' || kind === 'porte_fenetre' || kind === 'cellar_window' || kind === 'stall_window') {
    const m1 = add(pA, nin, D / 2 - 0.05);
    const m2 = add(pB, nin, D / 2 - 0.05);
    const m3 = add(pA, nin, D / 2 + 0.05);
    const m4 = add(pB, nin, D / 2 + 0.05);
    parts.push(line(Pp(m1), Pp(m2), { class: 'pen-s' }), line(Pp(m3), Pp(m4), { class: 'pen-s' }));
    parts.push(line(Pp(pA), Pp(pB), { class: 'pen-xs' }));
    if (kind !== 'porte_fenetre') parts.push(line(Pp(iA), Pp(iB), { class: 'pen-xs' }));
    else {
      // two casements opening inwards
      const hA = iA;
      const hB = iB;
      const mid = add(iA, tan, w / 2);
      const oA = add(hA, nin, w / 2);
      const oB = add(hB, nin, w / 2);
      parts.push(line(Pp(hA), Pp(oA), { class: 'pen-xs' }), line(Pp(hB), Pp(oB), { class: 'pen-xs' }));
      parts.push(el('path', { d: swingArc(Pp(hA), Pp(mid), Pp(oA)), class: 'pen-xs' }), el('path', { d: swingArc(Pp(hB), Pp(mid), Pp(oB)), class: 'pen-xs' }));
    }
    return;
  }
  if (kind === 'passage') {
    parts.push(line(Pp(pA), Pp(pB), { class: 'pen-xs hid' }), line(Pp(iA), Pp(iB), { class: 'pen-xs hid' }));
    return;
  }
  // doors, portals, Durchfahrten: leaves open inwards from the inner face
  const leaves = w > 1.25 ? 2 : 1;
  doorLeaves(parts, Pp, iA, iB, nin, tan, w, leaves);
}

function doorLeaves(parts: string[], Pp: (q: ST) => P2, hingeA: ST, hingeB: ST, into: ST, tan: ST, w: number, leaves: 1 | 2 | number): void {
  if (leaves >= 2) {
    const lw = w / 2;
    const oA = add(hingeA, into, lw);
    const oB = add(hingeB, into, lw);
    const mid = add(hingeA, tan, lw);
    parts.push(line(Pp(hingeA), Pp(oA), { class: 'pen-m' }), line(Pp(hingeB), Pp(oB), { class: 'pen-m' }));
    parts.push(el('path', { d: swingArc(Pp(hingeA), Pp(mid), Pp(oA)), class: 'pen-xs' }), el('path', { d: swingArc(Pp(hingeB), Pp(mid), Pp(oB)), class: 'pen-xs' }));
  } else {
    const oA = add(hingeA, into, w);
    parts.push(line(Pp(hingeA), Pp(oA), { class: 'pen-m' }));
    parts.push(el('path', { d: swingArc(Pp(hingeA), Pp(hingeB), Pp(oA)), class: 'pen-xs' }));
  }
}

function interiorOpening(c: Ctx, o: Opening, ids: Map<string, Rect>): void {
  const { P, parts } = c;
  const Pp = (q: ST) => P(q[0], q[1]);
  if (o.wall.kind === 'side') {
    facadeOpening(c, o.wall.side, o.a, o.width, o.kind, o.storey);
    return;
  }
  let p0: ST;
  let u: ST;
  if (o.wall.kind === 'segment') {
    p0 = o.wall.p0;
    const dd: ST = [o.wall.p1[0] - p0[0], o.wall.p1[1] - p0[1]];
    const l = Math.hypot(dd[0], dd[1]) || 1;
    u = [dd[0] / l, dd[1] / l];
  } else {
    const room = c.b.rooms?.find((r) => r.id === (o.wall as { room: string }).room);
    if (!room) return;
    const e = o.wall.edge;
    p0 = room.polygon[e];
    const q = room.polygon[(e + 1) % room.polygon.length];
    const l = Math.hypot(q[0] - p0[0], q[1] - p0[1]) || 1;
    u = [(q[0] - p0[0]) / l, (q[1] - p0[1]) / l];
  }
  const cpt = add(p0, u, o.a);
  const nrm: ST = [-u[1], u[0]];
  let [ta, tb] = partitionThickness(cpt, nrm, c.spaces);
  if (o.wall.kind === 'room') {
    // wall lies outside the room edge: measure from the room face outwards (CCW room -> outward = −nrm)
    const out: ST = [u[1], -u[0]];
    ta = 0;
    tb = wallDepth(add(cpt, out, 0.01), out, c.spaces, 1.6, 0.16) + 0.01;
  }
  const w = o.width;
  const A = add(cpt, u, -w / 2);
  const B = add(cpt, u, w / 2);
  const a1 = add(A, nrm, ta);
  const b1 = add(B, nrm, ta);
  const a2 = add(A, nrm, -tb);
  const b2 = add(B, nrm, -tb);
  parts.push(path([Pp(a1), Pp(b1), Pp(b2), Pp(a2)], true, { fill: '#fff', stroke: 'none' }));
  parts.push(line(Pp(a1), Pp(a2), { class: 'pen-m' }), line(Pp(b1), Pp(b2), { class: 'pen-m' }));
  if (o.kind === 'passage') return;
  // swing into the second room of the pair if known, else to +nrm
  let into: ST = nrm;
  const target = o.wall.kind === 'segment' && o.wall.rooms ? ids.get(o.wall.rooms[1]) : undefined;
  if (target) {
    const probe = add(cpt, nrm, ta + 0.3);
    const inT = probe[0] > target.s0 && probe[0] < target.s1 && probe[1] > target.t0 && probe[1] < target.t1;
    if (!inT) into = [-nrm[0], -nrm[1]];
  }
  const sideOff = into === nrm ? ta : -tb;
  const hA = add(A, nrm, sideOff);
  const hB = add(B, nrm, sideOff);
  doorLeaves(parts, Pp, hA, hB, into, u, w, o.kind === 'double_door' ? 2 : 1);
}

/**
 * Exterior Freitreppe in front of portals with steps (entrance storey only); the main perron uses the 3D numbers
 * (freitreppePlan: width, landing, treads, cheeks, pedestals; wave-8 review fix KB-I72). Also the columned porch of a
 * Durchfahrt (columns cut, balcony deck above dashed) and continuous balconies on upper storeys (dashed, above the cut).
 */
function freitreppen(c: Ctx, storey: number): void {
  const { L, P, parts } = c;
  const Pp = (q: ST) => P(q[0], q[1]);
  for (const o of L.openings) {
    if (o.storey !== storey) continue;
    const sd = L.frame.sides[o.side];
    const out: ST = [sd.normal[0], sd.normal[1]];
    const tan = sd.tangent;
    // the stair / porch starts at the wall face, in front of a risalit where there is one (as in 3D)
    const rr = L.sides[o.side]?.risalits.find((r) => o.a >= r.a0 && o.a <= r.a1);
    const face = sidePoint(L.frame, o.side, o.a, rr ? (rr.risalit.projection ?? 0) : 0);
    const corner = (dx: number, dy: number) => Pp(add(add(face, tan, dx), out, dy));
    const rectAt = (x0: number, x1: number, y0: number, y1: number) => [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)];
    if (o.kind === 'durchfahrt' && o.portico) {
      const PP = PASSAGE_PORTICO;
      const cw = PP.columnDiameter;
      const pairs = Math.max(1, Math.round(o.portico.columns / 2));
      const xs: number[] = [];
      for (const sg of [-1, 1]) for (let i = 0; i < pairs; i++) xs.push(sg * (o.width / 2 + PP.inner + cw / 2 + i * PP.pair));
      const tc = o.portico.depth - cw / 2 - 0.15;
      for (const x of xs) {
        parts.push(path(rectAt(x - cw * 0.7, x + cw * 0.7, tc - cw * 0.7, tc + cw * 0.7), true, { class: 'pen-xs', fill: 'none' }));
        parts.push(circle(corner(x, tc), (cw / 2) * c.k, { class: 'pen-m', fill: '#222' }));
      }
      const e0 = Math.min(...xs) - cw / 2 - 0.15;
      const e1 = Math.max(...xs) + cw / 2 + 0.15;
      parts.push(path(rectAt(e0, e1, 0, o.portico.depth), true, { class: 'pen-s hid', fill: 'none' }));
      c.labels.push(text(corner(e1 + 0.4, o.portico.depth / 2), 'Säulenvorbau mit Balkon', { size: 1.6, class: 'halo' }));
      continue;
    }
    if (o.balconyRun) {
      const r = o.balconyRun;
      const x0 = r.a0 - o.a;
      const x1 = r.a1 - o.a;
      parts.push(path(rectAt(x0, x1, 0, r.depth), true, { class: 'pen-s hid', fill: 'none' }));
      c.labels.push(text(corner(x1 + 0.4, r.depth / 2), 'Balkon', { size: 1.6, class: 'halo' }));
      continue;
    }
    if (!o.steps) continue;
    const fp = freitreppePlan(o);
    const n = o.steps;
    if (fp?.main) {
      const hw = fp.halfWidth;
      parts.push(path(rectAt(-hw, hw, 0, fp.depth), true, { fill: '#fff', class: 'pen-m' }));
      for (let i = 0; i < n - 1; i++) {
        const y = fp.landing + i * fp.tread;
        parts.push(line(corner(-hw, y), corner(hw, y), { class: 'pen-xs' }));
      }
      for (const sg of [-1, 1]) {
        const x0 = sg * hw;
        const x1 = sg * (hw + fp.cheek);
        parts.push(path(rectAt(Math.min(x0, x1), Math.max(x0, x1), 0, fp.depth), true, { fill: '#efe9e6', class: 'pen-s' }));
        if (fp.pedestal) {
          const [pw, pd] = fp.pedestal;
          const pc = (x0 + x1) / 2;
          parts.push(path(rectAt(pc - pw / 2, pc + pw / 2, fp.depth - pd, fp.depth), true, { fill: '#efe9e6', class: 'pen-m' }));
        }
      }
      parts.push(line(corner(0, fp.depth - 0.2), corner(0, 0.4), { class: 'pen-xs', 'marker-end': 'url(#arrow)' }));
      c.labels.push(text(corner(hw + fp.cheek + 0.4, fp.depth / 2), `Freitreppe ${n} Stg.`, { size: 1.6, class: 'halo' }));
      continue;
    }
    const tread = 0.4;
    const width = o.width + 1.6;
    const depth = (n - 1) * tread + 1.2; // top landing 1.2 m [N]
    parts.push(path([corner(-width / 2, 0), corner(width / 2, 0), corner(width / 2, depth), corner(-width / 2, depth)], true, { fill: '#fff', class: 'pen-m' }));
    for (let i = 0; i < n - 1; i++) {
      const y = 1.2 + i * tread;
      parts.push(line(corner(-width / 2, y), corner(width / 2, y), { class: 'pen-xs' }));
    }
    const arrowFrom = corner(0, depth - 0.2);
    const arrowTo = corner(0, 0.6);
    parts.push(line(arrowFrom, arrowTo, { class: 'pen-xs', 'marker-end': 'url(#arrow)' }));
    c.labels.push(text(corner(width / 2 + 0.4, depth / 2), `Freitreppe ${n} Stg.`, { size: 1.6, class: 'halo' }));
  }
}

/**
 * Free-standing columns (Vestibül) from the interior programme: shaft cut at +1.20 m (poché circle), plinth
 * below the cut (thin square), architraves above the cut dashed between neighbouring columns of a row.
 */
function drawColumns(c: Ctx, storey: number): void {
  const cols = columnsOf(c.b, c.L, storey);
  if (!cols.length) return;
  const { P, parts } = c;
  for (const [s, t] of cols) {
    parts.push(path(rectPoly({ s0: s - 0.38, s1: s + 0.38, t0: t - 0.38, t1: t + 0.38 }).map(([a, b]) => P(a, b)), true, { class: 'pen-xs', fill: 'none' }));
    parts.push(circle(P(s, t), 0.29 * c.k, { class: 'poche-d' }));
  }
  // architraves: link columns sharing a row coordinate (s or t) to their nearest neighbour along the row
  const key = (v: number) => v.toFixed(2);
  for (const ax of [0, 1] as const) {
    const rows = new Map<string, ST[]>();
    for (const q of cols) {
      const k = key(q[ax]);
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k)!.push(q);
    }
    for (const row of rows.values()) {
      if (row.length < 2) continue;
      row.sort((a, b) => a[1 - ax] - b[1 - ax]);
      parts.push(line(P(row[0][0], row[0][1]), P(row[row.length - 1][0], row[row.length - 1][1]), { class: 'pen-xs hid' }));
    }
  }
}

function drawStair(c: Ctx, st: NonNullable<Building['stairs']>[number], storey: number): void {
  const { L, P, parts } = c;
  const Pp = (q: ST) => P(q[0], q[1]);
  const plan = stairPlans(c.b, L).get(st.id);
  if (!plan) return;
  const lower = storey === st.storey_from;
  const cut = plan.h0 + 1.2;
  for (const ld of plan.landings) {
    if (lower && ld.kind !== 'mid') continue; // upper slabs belong to the upper floor
    const overhead = lower && ld.h > cut;
    parts.push(path(rectPoly(ld.rect).map(([s, t]) => P(s, t)), true, { class: ld.kind === 'mid' && !overhead ? 'pen-s' : 'pen-s hid', fill: 'none' }));
  }
  plan.flights.forEach((f, fi) => {
    // on the lower storey a flight that starts above the cut plane (return flight) is seen from below: dashed
    const overhead = lower && f.h0 + f.riser > cut;
    parts.push(path(flightPoly(f).map(Pp), true, overhead ? { class: 'pen-s hid', fill: 'none' } : { class: 'pen-m', fill: '#fff' }));
    const nl = nosings(f);
    let cutDrawn = false;
    nl.forEach((ln, i) => {
      const hTop = f.h0 + (i + 1) * f.riser;
      const above = lower && hTop > cut;
      if (above && !cutDrawn && i > 0 && f.h0 + f.riser <= cut) {
        cutDrawn = true;
        const prev = nl[i - 1];
        const m1: ST = [(prev[0][0] * 2 + ln[0][0]) / 3, (prev[0][1] * 2 + ln[0][1]) / 3];
        const m2: ST = [(prev[1][0] + ln[1][0] * 2) / 3, (prev[1][1] + ln[1][1] * 2) / 3];
        parts.push(path([Pp(prev[0]), Pp(m1), Pp(m2), Pp(ln[1])], false, { class: 'pen-m' }));
      }
      parts.push(line(Pp(ln[0]), Pp(ln[1]), { class: above ? 'pen-xs hid' : 'pen-s' }));
    });
    const [w0, w1] = flightWalk(f);
    if (fi === 0) parts.push(circle(Pp(w0), 0.7, { class: 'pen-s', fill: '#fff' }));
    parts.push(line(Pp(w0), Pp(w1), { class: 'pen-s', 'marker-end': 'url(#arrow)' }));
  });
  const lab = `${plan.risers} Stg. ${de(plan.riser * 100, 1)}/${de(plan.tread * 100, 1)}`;
  const f0 = plan.flights[0];
  const lp = Pp([f0.start[0] - f0.dir[0] * 0.9, f0.start[1] - f0.dir[1] * 0.9]);
  c.labels.push(text(lp, lower ? lab : `${lab} · von ${shortStorey(L.building.storeys[st.storey_from].name)}`, { size: 1.6, anchor: 'middle', class: 'halo' }));
}

function roomLabels(c: Ctx, storey: number): void {
  const { b, P } = c;
  for (const r of b.rooms ?? []) {
    if (r.storey !== storey) continue;
    const q = rectOf(r.polygon);
    if (!q) continue;
    const corners = rectPoly(q).map(([s, t]) => P(s, t));
    const bb = bboxOf(corners);
    const w = bb.x1 - bb.x0;
    const h = bb.y1 - bb.y0;
    const isStair = (b.stairs ?? []).some((st) => {
      const sr = rectOf(st.polygon);
      return sr && Math.abs(sr.s0 - q.s0) < 0.05 && Math.abs(sr.t0 - q.t0) < 0.05;
    });
    const area = `${de(roomArea(r), 1)} m²`;
    const tags = `[${tagShort(r.tag) || 'U'}]`;
    const name = r.name_de;
    const rotate = h > w * 1.4 && textWidth(name, 2.0) > w - 1.5;
    const avail = (rotate ? h : w) - 1.5;
    let size = 2.0;
    let lines = wrap(name, avail, size);
    while ((lines.length > 3 || lines.some((l) => textWidth(l, size) > avail)) && size > 1.25) {
      size -= 0.15;
      lines = wrap(name, avail, size);
    }
    const all = [...lines, `${area} ${tags}`];
    const lh = size * 1.22;
    const cxy: P2 = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2];
    // stair halls: put the label near the hall edge so it does not sit on the steps
    let pos: P2 = cxy;
    if (isStair) {
      const st = (b.stairs ?? []).find((x) => {
        const sr = rectOf(x.polygon);
        return sr && Math.abs(sr.s0 - q.s0) < 0.05 && Math.abs(sr.t0 - q.t0) < 0.05;
      })!;
      const plan = stairPlans(b, c.L).get(st.id);
      const ld = plan?.landings.filter((x) => x.kind === 'mid').sort((x, y) => (y.rect.s1 - y.rect.s0) * (y.rect.t1 - y.rect.t0) - (x.rect.s1 - x.rect.s0) * (x.rect.t1 - x.rect.t0))[0];
      if (ld) {
        const lb = bboxOf(rectPoly(ld.rect).map(([s1, t1]) => P(s1, t1)));
        pos = [(lb.x0 + lb.x1) / 2, (lb.y0 + lb.y1) / 2];
        size = Math.min(size, 1.6);
      }
    }
    const total = all.length * lh;
    const parts = all.map((ln, i) => {
      const off = -total / 2 + lh * (i + 0.8);
      const p: P2 = rotate ? [pos[0] + off, pos[1]] : [pos[0], pos[1] + off];
      const last = i === all.length - 1;
      return text(p, ln, { size: last ? size * 0.85 : size, anchor: 'middle', rotate: rotate ? -90 : undefined, class: `halo${last ? ' muted' : ''}${/\bI\b|^I|\(\?\)|\?/.test(r.tag + name) && !last ? '' : ''}` });
    });
    c.labels.push(g({ class: 'room-label' }, ...parts));
  }
}

// ---------------------------------------------------------------------------------------------
// Cellar outline (documented cellar, no rooms)
// ---------------------------------------------------------------------------------------------

function drawCellarOutline(c: Ctx, storey: number, tag: string): void {
  const { b, L, P, parts } = c;
  const t = WALL_THICKNESS[b.cls] + 0.2;
  const inner: Rect = { s0: c.outline.s0 + t, s1: c.outline.s1 - t, t0: c.outline.t0 + t, t1: c.outline.t1 - t };
  c.spaces = [inner];
  const poly = (r: Rect) => rectPoly(r).map(([s, tt]) => P(s, tt));
  parts.push(el('path', { d: `${pathD(poly(c.outline))}${pathD(poly(inner))}`, 'fill-rule': 'evenodd', class: 'poche-d' }));
  parts.push(path(poly(inner), true, { class: 'void' }));
  parts.push(path(poly(inner), true, { class: 'pen-m hid' }));
  parts.push(path(poly(c.outline), true, { class: 'pen-xl' }));
  for (const o of L.openings) if (o.storey === storey && o.kind === 'cellar_window') facadeOpening(c, o.side, o.a, o.width, 'window');
  const cp = P(0, 0);
  c.labels.push(
    text(cp, `Gewölbekeller (Befund LiDAR KB-02) [${tagShort(tag) || 'U'}]\nWölbung, Stützen und Raumteilung unbekannt [U]\nKellerfenster je Achse im Sockel (HMS; Größe N)`, {
      size: 2.0,
      anchor: 'middle',
      class: 'halo',
    }),
  );
}

function pathD(pts: P2[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join('') + 'Z';
}

// ---------------------------------------------------------------------------------------------
// Mansard storey
// ---------------------------------------------------------------------------------------------

function drawMansard(c: Ctx, floorH: number): void {
  const { L, P, parts } = c;
  const Pp = (q: [number, number]) => P(q[0], q[1]);
  const roof = buildingRoof(L);
  const hc = floorH + 1.2;
  const out = rectPoly(c.outline).map(([s, t]) => P(s, t));
  parts.push(path(out, true, { fill: 'url(#hatch-roof)', stroke: 'none' }));
  // pieces: main roof outside raised ranges, raised roofs inside theirs
  const clips = roof.raised.map((r) => [r.solid.s0, r.solid.s1] as [number, number]).sort((a, b) => a[0] - b[0]);
  const ranges: [number, number, 'main' | number][] = [];
  let s = c.outline.s0;
  clips.forEach(([a, b], i) => {
    if (a > s) ranges.push([s, a, 'main']);
    ranges.push([a, b, i]);
    s = b;
  });
  if (s < c.outline.s1) ranges.push([s, c.outline.s1, 'main']);
  const pieces = ranges.map(([a, b, which]) => {
    if (which === 'main') return { a, b, poly: roofLevelSet(roof.main, L.roof, L.frame.length, 0, hc, a, b) };
    const r = roof.raised[which];
    return { a, b, poly: roofLevelSet(r.solid, r.rr.section, r.rr.length, r.rr.sMid, hc, a, b) };
  });
  let area = 0;
  for (const pc of pieces) {
    if (pc.poly.length < 3) continue;
    parts.push(path(pc.poly.map(Pp), true, { fill: '#fff', stroke: 'none' }));
    area += Math.abs(polyArea(pc.poly));
  }
  // stroke the cut line, skipping edges on the piece boundaries, and add the steps between pieces
  for (const pc of pieces) {
    const q = pc.poly;
    for (let i = 0; i < q.length; i++) {
      const A = q[i];
      const B = q[(i + 1) % q.length];
      const onClip = [pc.a, pc.b].some((x) => Math.abs(A[0] - x) < 1e-6 && Math.abs(B[0] - x) < 1e-6) && !(Math.abs(A[0] - c.outline.s0) < 1e-6 || Math.abs(A[0] - c.outline.s1) < 1e-6);
      if (!onClip) parts.push(line(Pp(A), Pp(B), { class: 'pen-xl' }));
    }
  }
  for (let i = 0; i + 1 < pieces.length; i++) {
    const x = pieces[i].b;
    const tA = tExtent(pieces[i].poly, x);
    const tB = tExtent(pieces[i + 1].poly, x);
    if (!tA || !tB) continue;
    for (const sgn of [-1, 1] as const) {
      const a = sgn < 0 ? tA[0] : tA[1];
      const b = sgn < 0 ? tB[0] : tB[1];
      if (Math.abs(a - b) > 0.01) parts.push(line(P(x, a), P(x, b), { class: 'pen-xl' }));
    }
  }
  parts.push(path(out, true, { class: 'pen-s hid' }));
  // mansard break line (above the cut: dashed)
  if (L.roof.type === 'mansard' && L.roof.break_inset) {
    const bi = L.roof.break_inset;
    const hipped = L.roofSpec.hipped_ends ?? true;
    const br: Rect = { s0: c.outline.s0 + (hipped ? bi : 0), s1: c.outline.s1 - (hipped ? bi : 0), t0: c.outline.t0 + bi, t1: c.outline.t1 - bi };
    const segs: [ST, ST][] = [
      [
        [br.s0, br.t0],
        [br.s1, br.t0],
      ],
      [
        [br.s1, br.t0],
        [br.s1, br.t1],
      ],
      [
        [br.s1, br.t1],
        [br.s0, br.t1],
      ],
      [
        [br.s0, br.t1],
        [br.s0, br.t0],
      ],
    ];
    for (const [a, b] of segs) {
      // split at raised ranges
      const xs = [a[0], b[0]].sort((x, y) => x - y);
      const pts: number[] = [xs[0], ...clips.flat().filter((x) => x > xs[0] && x < xs[1]), xs[1]];
      for (let i = 0; i + 1 < pts.length; i++) {
        const m = (pts[i] + pts[i + 1]) / 2;
        if (Math.abs(a[0] - b[0]) > 1e-6 && clips.some(([p, q]) => m > p && m < q)) continue;
        if (Math.abs(a[0] - b[0]) < 1e-6) {
          if (clips.some(([p, q]) => a[0] > p && a[0] < q)) continue;
          parts.push(line(P(a[0], a[1]), P(b[0], b[1]), { class: 'pen-s hid' }));
          break;
        }
        parts.push(line(P(pts[i], a[1]), P(pts[i + 1], a[1]), { class: 'pen-s hid' }));
      }
    }
  }
  // raised roof: hip lines and ridge (seen from below: dashed, above the cut)
  for (const r of roof.raised) {
    for (const f of r.solid.faces) {
      if (f.kind !== 'roof') continue;
      const top = f.pts.filter((p) => p[2] > hc + 0.01);
      void top;
    }
    const hw = L.roof.depth / 2;
    const ri = Math.min(hw, r.rr.length / 2);
    const rs0 = r.rr.sMid - (r.rr.length / 2 - ri);
    const rs1 = r.rr.sMid + (r.rr.length / 2 - ri);
    parts.push(line(P(rs0, 0), P(rs1, 0), { class: 'pen-s hid' }));
    for (const [es, et, rsx] of [
      [r.solid.s0, -hw, rs0],
      [r.solid.s0, hw, rs0],
      [r.solid.s1, -hw, rs1],
      [r.solid.s1, hw, rs1],
    ] as const)
      parts.push(line(P(es, et), P(rsx, 0), { class: 'pen-xs hid' }));
    if (r.rr.turret) {
      const tw = r.rr.turret.width / 2;
      parts.push(path(rectPoly({ s0: r.rr.sMid - tw, s1: r.rr.sMid + tw, t0: -tw, t1: tw }).map(([s1, t1]) => P(s1, t1)), true, { class: 'pen-s hid' }));
      c.labels.push(text(P(r.rr.sMid, -tw - 0.6), `Laterne (über)`, { size: 1.5, anchor: 'middle', class: 'halo muted' }));
    }
  }
  // dormers
  for (const ro of L.roofOpenings) {
    if (ro.kind !== 'dormer') continue;
    const sd = L.frame.sides[ro.side];
    const nin: ST = [-sd.normal[0], -sd.normal[1]];
    const front = sidePoint(L.frame, ro.side, ro.a, ro.inset);
    const cutInset = insetAtCut(roof, front, nin, hc);
    const depthBack = Math.max(0.3, cutInset - ro.inset);
    const A = add(front, sd.tangent, -ro.width / 2 - 0.12);
    const B = add(front, sd.tangent, ro.width / 2 + 0.12);
    const A2 = add(A, nin, depthBack);
    const B2 = add(B, nin, depthBack);
    parts.push(path([Pp(A), Pp(B), Pp(B2), Pp(A2)], true, { fill: '#fff', stroke: 'none' }));
    parts.push(line(Pp(A), Pp(A2), { class: 'pen-l' }), line(Pp(B), Pp(B2), { class: 'pen-l' }));
    const g1 = add(front, sd.tangent, -ro.width / 2);
    const g2 = add(front, sd.tangent, ro.width / 2);
    parts.push(line(Pp(g1), Pp(g2), { class: 'pen-s' }), line(Pp(add(g1, nin, 0.1)), Pp(add(g2, nin, 0.1)), { class: 'pen-s' }));
    parts.push(line(Pp(A), Pp(B), { class: 'pen-xs' }));
  }
  const cp = P(0, -L.frame.width / 4);
  c.labels.push(
    text(cp, `Mansardgeschoss – Raumteilung unbekannt [U]\nFläche mit lichter Höhe ≥ 1,20 m ca. ${de(area, 0)} m²\nDach: ${roofDe(L)}`, {
      size: 2.0,
      anchor: 'middle',
      class: 'halo',
    }),
  );
  c.spaces = [];
}

function roofDe(L: BuildingLayout): string {
  const r = L.roof;
  const t = r.type === 'mansard' ? `Mansarddach ${de(r.pitch_lower, 0)}°/${de(r.pitch_upper, 0)}°, Knick ${de(r.break_h ?? 0)}, First ${de(r.ridge_h)}` : `${r.type} ${de(r.pitch_lower, 0)}°, First ${de(r.ridge_h)}`;
  return `${t} m ü. NHN [${tagShort(L.roofSpec.tags) || 'U'}]`;
}

function insetAtCut(roof: ReturnType<typeof buildingRoof>, face: ST, nin: ST, hc: number): number {
  // march inwards from the eaves until the roof surface reaches the cut height
  const start = add(face, nin, -0.0001);
  for (let d = 0; d < 6; d += 0.02) {
    const p = add(start, nin, d);
    if (roof.heightAt(p[0], p[1]) >= hc) return d;
  }
  return 1.0;
}

function tExtent(poly: [number, number][], x: number): [number, number] | null {
  const ts = poly.filter((p) => Math.abs(p[0] - x) < 1e-6).map((p) => p[1]);
  return ts.length ? [Math.min(...ts), Math.max(...ts)] : null;
}

function polyArea(p: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

// ---------------------------------------------------------------------------------------------
// Dimensions, axes, section markers
// ---------------------------------------------------------------------------------------------

function frontProjection(c: Ctx, side: SideName): number {
  let m = 0;
  for (const o of c.L.openings) if (o.side === side && o.steps) m = Math.max(m, (o.steps - 1) * 0.4 + 1.2);
  return m;
}

function dims(c: Ctx, req: PlanReq): void {
  const { L, P, dirP, k, parts } = c;
  const mansard = req.kind === 'mansard';
  for (const side of ['court', 'garden'] as SideName[]) {
    const sd = L.frame.sides[side];
    const lay = L.sides[side];
    const base = 7 + frontProjection(c, side) * k;
    const outN = dirP(sd.normal);
    const tanP = dirP(sd.tangent);
    const at = (a: number, offMm: number): P2 => {
      const q = sidePoint(L.frame, side, a, 0);
      const p = P(q[0], q[1]);
      return [p[0] + outN[0] * offMm, p[1] + outN[1] * offMm];
    };
    const axesA = mansard ? L.roofOpenings.filter((r) => r.side === side && r.kind === 'dormer').map((r) => r.a) : lay.bays.map((x) => x.a);
    if (axesA.length) {
      const ch1 = dimChain([0, ...axesA, sd.length], k);
      parts.push(drawDimChain(ch1, { origin: at(0, base), dir: tanP, out: outN, k, ext: base - 2 }));
    }
    const ch2 = dimChain([0, sd.length], k);
    parts.push(drawDimChain(ch2, { origin: at(0, base + 7), dir: tanP, out: outN, k, ext: 3 }));
    // axis numbers
    const axisOff = base + 16;
    lay.bays.forEach((bay, i) => {
      const cpt = at(bay.a, axisOff);
      parts.push(line(at(bay.a, axisOff - 2.2), at(bay.a, 1.0), { class: 'pen-xs axis grey' }));
      parts.push(circle(cpt, side === 'court' ? 2.2 : 2.0, { fill: '#fff', class: 'pen-s' }));
      parts.push(text([cpt[0], cpt[1] + 0.65], side === 'court' ? String(i + 1) : `G${i + 1}`, { size: side === 'court' ? 1.9 : 1.45, anchor: 'middle' }));
    });
    if (lay.bays.length) {
      const lab = side === 'court' ? `Hofseite (${dirName(sd.normalAzimuth)}) · Achsen 1–${lay.bays.length}` : `Gartenseite (${dirName(sd.normalAzimuth)}) · Achsen G1–G${lay.bays.length}`;
      const p = at(-1.5, axisOff);
      const ang = (Math.atan2(tanP[1], tanP[0]) * 180) / Math.PI;
      const readable = ang > 90 || ang < -90;
      c.labels.push(text(readable ? at(sd.length + 1.5, axisOff) : p, lab, { size: 1.8, anchor: 'end', rotate: readable ? ang + 180 : ang, class: 'muted' }));
    } else {
      const lab = side === 'court' ? 'Hofseite' : 'Gartenseite';
      c.labels.push(text(at(sd.length / 2, base + 12), `${lab} (${dirName(sd.normalAzimuth)})`, { size: 1.8, anchor: 'middle', class: 'muted' }));
    }
  }
  // depth chain on end_b: wall + room depths at 2.5 m from the end, and overall
  const side: SideName = 'end_b';
  const sd = L.frame.sides[side];
  const outN = dirP(sd.normal);
  const tanP = dirP(sd.tangent);
  const at = (a: number, offMm: number): P2 => {
    const q = sidePoint(L.frame, side, a, 0);
    const p = P(q[0], q[1]);
    return [p[0] + outN[0] * offMm, p[1] + outN[1] * offMm];
  };
  const base = 8;
  if (c.spaces.length) {
    const sProbe = L.frame.length / 2 - 2.5;
    const edges: number[] = [];
    for (const r of c.spaces) if (sProbe > r.s0 && sProbe < r.s1) edges.push(r.t0, r.t1);
    const pos = [0, ...edges.map((t) => t + L.frame.width / 2), sd.length];
    parts.push(drawDimChain(dimChain(pos, k), { origin: at(0, base), dir: tanP, out: outN, k, ext: base - 2 }));
  }
  parts.push(drawDimChain(dimChain([0, sd.length], k), { origin: at(0, base + 7), dir: tanP, out: outN, k, ext: 3 }));
}

function dirName(az: number): string {
  const names = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

function sectionMarker(c: Ctx, d: SectionDef): void {
  const { L, parts, labels } = c;
  // beyond dims (2 chains) and axis circles: base 7 mm + front projection + 16 mm axes + 7 mm
  const sideAt = (r: number): SideName => (d.along === 't' ? (r < 0 ? 'garden' : 'court') : r < 0 ? 'end_a' : 'end_b');
  const extOf = (side: SideName) => (side === 'court' || side === 'garden' ? 7 + frontProjection(c, side) * c.k + 16 + 7 : 8 + 7 + 8) / c.k;
  const r0 = (d.along === 't' ? c.outline.t0 : c.outline.s0) - extOf(sideAt(-1));
  const r1 = (d.along === 't' ? c.outline.t1 : c.outline.s1) + extOf(sideAt(1));
  const [A, B] = sectionLineEN(L, d, r0, r1);
  // paper points via the building transform
  const toP = (r: number) => (d.along === 't' ? c.P(d.at, r) : c.P(r, d.at));
  const pA = toP(r0);
  const pB = toP(r1);
  void A;
  void B;
  parts.push(line(pA, pB, { class: 'pen-xs axis' }));
  const dirAB: P2 = [(pB[0] - pA[0]) / Math.hypot(pB[0] - pA[0], pB[1] - pA[1]), (pB[1] - pA[1]) / Math.hypot(pB[0] - pA[0], pB[1] - pA[1])];
  // view direction on paper
  const dv = c.dirP(viewST(L, d.lookAz));
  for (const [p, sgn] of [
    [pA, 1],
    [pB, -1],
  ] as const) {
    const q: P2 = [p[0] + dirAB[0] * sgn * 7, p[1] + dirAB[1] * sgn * 7];
    parts.push(line(p, q, { class: 'pen-xxl' }));
    const tip: P2 = [p[0] + dv[0] * 5, p[1] + dv[1] * 5];
    parts.push(line(p, tip, { class: 'pen-m', 'marker-end': 'url(#arrow)' }));
    labels.push(text([p[0] - dirAB[0] * sgn * 3.2, p[1] - dirAB[1] * sgn * 3.2 + 1.3], d.id, { size: 3.6, anchor: 'middle', class: 'b halo' }));
  }
}

/** Unit [s, t] vector of a grid azimuth in a building frame. */
function viewST(L: BuildingLayout, az: number): ST {
  const a = (az * Math.PI) / 180;
  const e: [number, number] = [Math.sin(a), Math.cos(a)];
  return [e[0] * L.frame.sDir[0] + e[1] * L.frame.sDir[1], e[0] * L.frame.tDir[0] + e[1] * L.frame.tDir[1]];
}

function planLegend(kind: PlanKind): LegendItem[] {
  const items: LegendItem[] = [
    { swatch: sw.fill('#1d1d1d', 'pen-xs'), label: 'Außenwand geschnitten, Lage belegt (LiDAR/LP06)' },
    { swatch: sw.fill('url(#hatch-i)', 'pen-xs'), label: 'Innenwand geschnitten, erschlossen (I/N)' },
    { swatch: sw.fill('url(#hatch-u)', 'pen-xs'), label: 'Fläche ohne Raumbefund (U)' },
    { swatch: sw.line('pen-l'), label: 'Wandfläche an belegter Außenwand' },
    { swatch: sw.line('pen-m hid'), label: 'Wandfläche erschlossen / über Schnittebene' },
    { swatch: (x, y) => g({}, circle([x + 1, y + 2], 0.7, { class: 'pen-s', fill: '#fff' }), line([x + 1.7, y + 2], [x + 10, y + 2], { class: 'pen-s', 'marker-end': 'url(#arrow)' })), label: 'Lauflinie aufwärts; Stg. h/b in cm' },
    { swatch: (x, y) => g({}, line([x, y + 2], [x + 10, y + 2], { class: 'pen-xxl' }), text([x + 5, y + 3.5], 'A', { size: 2.2, anchor: 'middle', class: 'b' })), label: 'Schnittführung (Blätter SC)' },
    { swatch: (x, y) => g({}, circle([x + 5, y + 2], 1.8, { class: 'pen-s', fill: '#fff' }), text([x + 5, y + 2.6], '7', { size: 1.6, anchor: 'middle' })), label: 'Fensterachse (von außen links → rechts)' },
  ];
  if (kind === 'mansard') {
    items.splice(0, 5, { swatch: sw.fill('url(#hatch-roof)', 'pen-xs'), label: 'Dachfläche unter 1,20 m lichter Höhe' }, { swatch: sw.line('pen-xl'), label: 'Dachschnitt in 1,20 m Höhe über FFB' }, { swatch: sw.line('pen-s hid'), label: 'Traufe, Dachknick, Grat (verdeckt)' });
  }
  return items;
}
