/**
 * Schnitte 1:200 through the Corps de logis (cuts defined in sections.ts, shared with the plan
 * markers): cut walls / slabs / openings from the same room cells as the floor plans, the roof
 * profile from the same roof solid as the roof plan, stairs from the interiors' stair planner,
 * buildings beyond the cut as elevations, 1789 ground (catalogue levels) and today's DTM.
 * SC-01 additionally carries a 1:1000 Geländeschnitt along the whole main axis.
 */
import type { BuildingLayout } from '../../../model/src/layout/building.ts';
import { sidePoint, stToEN } from '../../../model/src/layout/footprint.ts';
import { FLOOR_BUILD_UP, WALL_THICKNESS } from '../../../model/src/layout/grammar.ts';
import { pointInPolygon } from '../../../model/src/layout/geom.ts';
import { builtAvenueTrees } from '../geom/trees.ts';
import { WALK_KINDS, collectOpenings } from '../../../model/src/interior/openings.ts';
import { flightGoing } from '../../../model/src/interior/stairPlan.ts';
import type { Building, EN, SiteSpec, ST } from '../../../model/src/spec.ts';
import { CONF_DE, evidenceNote, sourcesNote, sw } from '../evidence.ts';
import { dimChain, drawDimChain } from '../geom/dims.ts';
import { type Rect, coverAlong, gaps, planCells, rectOf } from '../geom/plan.ts';
import { buildingRoof } from '../geom/roof3d.ts';
import { type Flight, stairPlans } from '../geom/stairs.ts';
import { type ElevView, elevView } from '../geom/transform.ts';
import { type SectionDef, sectionDefs } from '../sections.ts';
import { type LegendItem, MARGIN, SHEET_MM, Sheet, type SheetSize, scaleBar } from '../sheet.ts';
import { type P2, de, g, line, path, rect, rel, text, textWidth } from '../svg.ts';
import { DTM_ATTRIBUTION, type Dtm, loadDtm } from '../terrain.ts';
import { roofDe, shortName } from './ansicht.ts';
import { datumOf, placedBuildings, shortStorey } from './common.ts';
import { type HeightMark, alongRange, depthRange, drawElevation, drawGround, ground1789, heightColumn } from './elevation.ts';
import { spacesOf } from './grundriss.ts';

const SCALE = 200;

export interface SchnittReq {
  sheetNo: string;
  slug: string;
  title: string;
  section: 'A' | 'B';
  size: SheetSize;
}

export function schnittRequests(): SchnittReq[] {
  return [
    { sheetNo: 'SC-01', slug: 'Laengsschnitt_A-A', title: 'Längsschnitt A–A (Hauptachse)', section: 'A', size: 'A2' },
    { sheetNo: 'SC-02', slug: 'Querschnitt_B-B_Prunktreppe', title: 'Querschnitt B–B (Prunktreppe)', section: 'B', size: 'A3' },
  ];
}

/** Geometry helpers of one cut. r = coordinate along the cut line (building-local s or t). */
interface Cut {
  d: SectionDef;
  L: BuildingLayout;
  v: ElevView;
  st(r: number, off?: number): ST;
  en(q: ST): EN;
  X(r: number): number;
  Y(h: number): number;
  /** Depth of a building-local point (0 = cut plane, > 0 = beyond). */
  depth(q: ST): number;
  /** Component of a building-local point along the cut (r). */
  rOf(q: ST): number;
}

function makeCut(d: SectionDef, L: BuildingLayout, scale: number, paperX0: number, r0: number, h0: number, baseY: number): Cut {
  const st = (r: number, off = 0): ST => (d.along === 't' ? [d.at + off, r] : [r, d.at + off]);
  const en = (q: ST) => stToEN(L.frame, q);
  const o = en(st(0));
  const probe = elevView(scale, o, d.lookAz, h0, [0, 0]);
  const e0 = en(st(r0));
  const x0 = probe.along(e0[0], e0[1]);
  const v = elevView(scale, o, d.lookAz, h0, [paperX0 - x0 * probe.k, baseY]);
  return {
    d,
    L,
    v,
    st,
    en,
    X: (r) => {
      const e = en(st(r));
      return v.toPaper(e[0], e[1], h0)[0];
    },
    Y: (h) => v.at(0, h)[1],
    depth: (q) => {
      const e = en(q);
      return v.depthOf(e[0], e[1]);
    },
    rOf: (q) => (d.along === 't' ? q[1] : q[0]),
  };
}

export function schnittSheet(spec: SiteSpec, layoutOf: (b: Building) => BuildingLayout, r: SchnittReq): Sheet {
  const d = sectionDefs(spec).find((x) => x.id === r.section)!;
  const b = spec.buildings.find((x) => x.id === d.building)!;
  const L = layoutOf(b);
  const dtm = loadDtm();
  const g89 = ground1789(spec, dtm);
  const datum = datumOf(spec, layoutOf, b);
  const k = 1000 / SCALE;
  const sheet = new Sheet(r.size, `${r.sheetNo} ${r.title}`);
  const [W] = SHEET_MM[r.size];
  const colW = 64;
  const r0 = d.siteFrom;
  const r1 = d.siteTo;
  // the paper +x direction may run against r: find out from a probe
  const probeCut = makeCut(d, L, SCALE, 0, 0, 0, 0);
  const sign = probeCut.X(1) > probeCut.X(0) ? 1 : -1;
  const drawW = (r1 - r0) * k + colW;
  const left = MARGIN.left + (W - MARGIN.left - MARGIN.right - drawW) / 2;
  const rLeft = sign > 0 ? r0 : r1;
  const roofTop = buildingRoof(L);
  const topH = Math.max(L.roof.ridge_h, ...roofTop.raised.map((x) => x.rr.section.ridge_h), ...roofTop.turrets.map((t) => t.top)) + 1.5;
  const hLow = L.stack.base_h - 3.5;
  const top = MARGIN.top + 16;
  const stripH = r.section === 'A' ? 78 : 0;
  const avail = sheet.bandTop - top - stripH - 24;
  const baseY = top + (topH - hLow) * k + Math.max(0, (avail - (topH - hLow) * k) / 2);
  const c = makeCut(d, L, SCALE, left, rLeft, hLow, baseY);

  const parts: string[] = [];
  // 1. beyond the cut: other buildings as elevations (depth > 0)
  const others = placedBuildings(spec)
    .filter((x) => x.id !== b.id)
    .map((x) => layoutOf(x))
    .filter((X) => {
      const [dn, df] = depthRange(X, c.v);
      const [a0, a1] = alongRange(X, c.v);
      const [lo, hi] = [Math.min(c.v.along(...c.en(c.st(r0))), c.v.along(...c.en(c.st(r1)))), Math.max(c.v.along(...c.en(c.st(r0))), c.v.along(...c.en(c.st(r1))))];
      return df > 0 && dn < 140 && a1 > lo && a0 < hi;
    });
  const behind = others.filter((X) => depthRange(X, c.v)[0] > 0.05);
  const xRight = left + (r1 - r0) * k;
  sheet.defs(`<clipPath id="clip-${r.sheetNo}"><rect x="${left}" y="${top}" width="${xRight - left}" height="${c.Y(hLow) - top}"/></clipPath>`);
  parts.push(g({ class: 'beyond', 'clip-path': `url(#clip-${r.sheetNo})` }, drawElevation(behind, c.v, { behindDepth: 0, detail: 'simple' }), trees(spec, c, r0, r1, g89)));

  // 2. ground along the cut
  const gl = drawGround(c.v, g89, dtm, { origin: c.en(c.st(0)), dir: dirEN(c), x0: r0, x1: r1, bottomY: c.Y(hLow) + 1 });
  parts.push(gl.svg);

  // 3. the cut building
  const cutParts = cutBuilding(c, b, L);
  parts.push(cutParts.svg);
  // 4. other buildings crossed by the cut (gate, guard houses ...) as simplified cuts
  for (const X of others.filter((X) => depthRange(X, c.v)[0] <= 0.05)) parts.push(simpleCut(c, X));
  // today's terrain on top of everything (the palace is gone)
  if (gl.today.length > 1) parts.push(path(gl.today, false, { class: 'pen-s red hid' }));
  // feature labels on the ground
  parts.push(groundLabels(spec, c, r0, r1, left, xRight - 2, g89));

  // heights
  const marks: HeightMark[] = [];
  marks.push({ h: L.stack.base_h, label: 'Hof / Terrasse' });
  for (const lv of L.stack.levels) if (lv.kind !== 'plinth') marks.push({ h: lv.floor_h, label: `FFB ${shortStorey(lv.name)}` });
  marks.push({ h: L.stack.eaves_h, label: 'Traufe' });
  if (L.roof.break_h) marks.push({ h: L.roof.break_h, label: 'Dachknick' });
  marks.push({ h: L.roof.ridge_h, label: 'First' });
  for (const x of roofTop.raised) marks.push({ h: x.rr.section.ridge_h, label: 'First Mittelpavillon' });
  for (const t of roofTop.turrets) marks.push({ h: t.top, label: 'Laterne (U)' });
  const merged: HeightMark[] = [];
  for (const m of marks.sort((a, b) => a.h - b.h)) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.h - m.h) < 0.03) last.label += ` / ${m.label}`;
    else merged.push({ ...m });
  }
  parts.push(heightColumn(c.v, merged, datum.h, xRight - 2, xRight + 4));

  // dimension chain of the cut walls (bottom) and storey heights (left of the building)
  const yDim = c.Y(hLow) + 5;
  const pos = cutParts.dimPos;
  parts.push(drawDimChain(dimChain(pos, k), { origin: [c.X(0), yDim], dir: [sign, 0], out: [0, 1], k, ext: 1.2 }));
  const outlineR = cutParts.outlineR;
  parts.push(drawDimChain(dimChain(outlineR, k), { origin: [c.X(0), yDim + 6], dir: [sign, 0], out: [0, 1], k, ext: 1.2 }));
  const xH = Math.min(c.X(outlineR[0]), c.X(outlineR[1])) - 9;
  const hs = [L.stack.base_h, ...L.stack.levels.filter((l) => l.kind !== 'plinth').map((l) => l.floor_h), L.stack.eaves_h, ...(L.roof.break_h ? [L.roof.break_h] : []), cutParts.ridgeAtCut];
  parts.push(rect(xH - 5.5, c.Y(Math.max(...hs)) - 1, 6.5, c.Y(hs[0]) - c.Y(Math.max(...hs)) + 2, { fill: '#fff', stroke: 'none', opacity: 0.85 }));
  parts.push(drawDimChain(dimChain(hs.map((h) => h - hLow), k, 1.8), { origin: [xH, c.Y(hLow)], dir: [0, -1], out: [-1, 0], k, ext: 1.2 }));

  // direction labels at the ends
  const yLbl = c.Y(topH) + 2;
  const endName = (rr: number) => compass(c, rr);
  parts.push(text([left + 2, yLbl], `◄ ${endName(rLeft)}`, { size: 2.2, class: 'b' }));
  parts.push(text([xRight - 2, yLbl], `${endName(rLeft === r0 ? r1 : r0)} ►`, { size: 2.2, class: 'b', anchor: 'end' }));

  sheet.add(g({ id: 'section' }, ...parts));
  if (r.section === 'A') sheet.add(gelaendeschnitt(spec, layoutOf, d, L, g89, dtm, sheet, c.Y(hLow) + 22, rLeft, r0, r1));
  sheet.frame();
  sheet.add(text([MARGIN.left + 6, MARGIN.top + 8], d.title, { size: 3.0, class: 'b' }));
  sheet.add(text([MARGIN.left + 6, MARGIN.top + 12.5], `Schnittführung: Grundrisse ${b.id} (GR-01/02), Blickrichtung ${de(d.lookAz, 1)}° (Gitter); Bauteile hinter der Schnittebene in Ansicht, verdeckte Teile gestrichelt.`, { size: 1.8, class: 'muted' }));
  sheet.band({
    title: {
      sheetNo: r.sheetNo,
      title: r.title,
      subtitle: `${b.name_de} (${b.id})`,
      scale: r.section === 'A' ? '1:200 / 1:1000' : '1:200',
      info: [
        `Konfidenz Gebäude: ${CONF_DE[b.confidence]} · Dach: ${roofDe(L)}`,
        'Wände, Decken, Öffnungen aus Raumzellen der Grundrisse; Treppe = Treppenplaner des 3D-Modells',
        'Konstruktion (Gewölbe, Dachstuhl, Deckenaufbau) nicht belegt: schematisch (N/U)',
      ],
    },
    info: [`±0,00 = ${de(datum.h)} m ü. NHN`, `(${datum.label})`, 'Höhen in m ü. NHN (DHHN2016)', 'Gelände 1789: Katalogniveaus', 'Gelände heute: DGM1 (rot gestr.)'],
    scale: SCALE,
    legend: sectionLegend(),
    notes: [evidenceNote()[0], 'Schnitt: geschnittene Außenwände schwarz (Lage dokumentiert), Innenwände/Decken schraffiert (erschlossen). Wandstärken, Deckenstärken, Fenster- und Türhöhen nach Epochennorm (N, research/02).', `Gelände heute: ${DTM_ATTRIBUTION}.`, sourcesNote()[3]],
  });
  return sheet;
}

function dirEN(c: Cut): EN {
  const a = c.en(c.st(0));
  const b = c.en(c.st(1));
  return [b[0] - a[0], b[1] - a[1]];
}

function compass(c: Cut, r: number): string {
  const a = c.en(c.st(0));
  const b = c.en(c.st(r));
  const az = ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
  const names = ['Norden', 'Osten', 'Süden', 'Westen'];
  const side = c.d.along === 't' ? (r > 0 ? 'Ehrenhof' : 'Garten') : '';
  return `${names[Math.round(az / 90) % 4]}${side ? ' / ' + side : ''}`;
}

// ---------------------------------------------------------------------------------------------
// The cut building
// ---------------------------------------------------------------------------------------------

function cutBuilding(c: Cut, b: Building, L: BuildingLayout): { svg: string; dimPos: number[]; outlineR: [number, number]; ridgeAtCut: number } {
  const { d, X, Y } = c;
  const parts: string[] = [];
  const labels: string[] = [];
  const outline: Rect = { s0: -L.frame.length / 2, s1: L.frame.length / 2, t0: -L.frame.width / 2, t1: L.frame.width / 2 };
  const oR: [number, number] = d.along === 't' ? [outline.t0, outline.t1] : [outline.s0, outline.s1];
  const wallT = WALL_THICKNESS[b.cls];
  const slab = FLOOR_BUILD_UP[b.cls] || 0.4;
  const axis = d.along === 't' ? 't' : 's';
  const box = (ra: number, rb: number, h0: number, h1: number, a: Record<string, string>) => {
    const x0 = Math.min(X(ra), X(rb));
    const x1 = Math.max(X(ra), X(rb));
    return rect(x0, Y(h1), x1 - x0, Y(h0) - Y(h1), a);
  };
  const dimPos = new Set<number>([oR[0], oR[1]]);
  const ops = collectOpenings(b, L);
  const levels = L.stack.levels;
  const firstFloor = levels.find((l) => l.kind !== 'plinth')!;

  // plinth zone: foundation walls + earth fill, EG floor slab
  const footBottom = L.stack.base_h - 1.2;
  parts.push(box(oR[0] + wallT, oR[1] - wallT, footBottom, firstFloor.floor_h - slab, { fill: 'url(#hatch-earth)', class: 'pen-xs' }));
  parts.push(box(oR[0], oR[0] + wallT, footBottom, firstFloor.floor_h, { class: 'poche-d' }));
  parts.push(box(oR[1] - wallT, oR[1], footBottom, firstFloor.floor_h, { class: 'poche-d' }));
  parts.push(box(oR[0] + wallT, oR[1] - wallT, firstFloor.floor_h - slab, firstFloor.floor_h, { class: 'poche-i' }));
  labels.push(text([(X(oR[0]) + X(oR[1])) / 2, Y((L.stack.base_h + firstFloor.floor_h - slab) / 2) + 0.6], 'Sockelzone / Souterrain – Teilung unbekannt (U)', { size: 1.5, anchor: 'middle', class: 'halo muted i' }));

  // storeys
  const roomLevels = levels.filter((l) => l.kind !== 'plinth');
  for (const lv of roomLevels) {
    const si = lv.index;
    const { rects } = spacesOf(b, si);
    const hasRooms = rects.length > 0;
    const cells = planCells(outline, rects, { outerThickness: wallT + 0.25, outerWall: wallT });
    const top = lv.top_h;
    const ceil = top - slab;
    const outer = coverAlong(cells.walls.filter((w) => w.outer), axis, d.at);
    const inner = coverAlong(cells.walls.filter((w) => !w.outer), axis, d.at);
    const voids = coverAlong(cells.voids, axis, d.at);
    if (!hasRooms) {
      parts.push(box(oR[0], oR[0] + wallT, lv.floor_h, top, { class: 'poche-d' }));
      parts.push(box(oR[1] - wallT, oR[1], lv.floor_h, top, { class: 'poche-d' }));
    }
    for (const [a, bb] of outer) {
      parts.push(box(a, bb, lv.floor_h, top, { class: 'poche-d' }));
      if (lv === roomLevels[0]) {
        dimPos.add(a);
        dimPos.add(bb);
      }
    }
    for (const [a, bb] of inner) {
      parts.push(box(a, bb, lv.floor_h, ceil, { class: 'poche-i' }));
      parts.push(box(a, bb, lv.floor_h, ceil, { class: 'pen-s' }));
      if (lv === roomLevels[0]) {
        dimPos.add(a);
        dimPos.add(bb);
      }
    }
    for (const [a, bb] of voids) parts.push(box(a, bb, lv.floor_h, ceil, { class: 'void' }));
    // ceiling slab between the outer walls, open over stair halls rising through it
    const holes: [number, number][] = [];
    for (const stc of b.stairs ?? []) {
      if (!(stc.storey_from <= si && si < stc.storey_to)) continue;
      const hq = rectOf(stc.polygon);
      if (!hq) continue;
      const perpIn = d.along === 't' ? hq.s0 < d.at && hq.s1 > d.at : hq.t0 < d.at && hq.t1 > d.at;
      if (perpIn) holes.push(d.along === 't' ? [hq.t0, hq.t1] : [hq.s0, hq.s1]);
    }
    for (const [a, bb] of gaps(holes.sort((x, y) => x[0] - y[0]), oR[0] + wallT, oR[1] - wallT)) {
      parts.push(box(a, bb, ceil, top, { class: 'poche-i' }));
      parts.push(box(a, bb, ceil, top, { class: 'pen-s' }));
    }
    // openings crossed by the cut
    for (const o of ops) {
      if (o.storey !== si) continue;
      const wallAlong = d.along === 't' ? Math.abs(o.dir[1]) < 0.2 : Math.abs(o.dir[0]) < 0.2;
      if (!wallAlong) continue;
      const perp = d.along === 't' ? o.centre[0] : o.centre[1];
      if (Math.abs(perp - d.at) > o.width / 2 - 0.05) continue;
      const rr = d.along === 't' ? o.centre[1] : o.centre[0];
      const iv = [...outer, ...inner].find(([a, bb]) => rr >= a - 0.35 && rr <= bb + 0.35);
      if (!iv) continue;
      const [a, bb] = iv;
      parts.push(box(a, bb, o.bottom_h, o.top_h, { fill: '#fff', stroke: 'none' }));
      parts.push(line([X(a), Y(o.top_h)], [X(bb), Y(o.top_h)], { class: 'pen-m' }));
      parts.push(line([X(a), Y(o.bottom_h)], [X(bb), Y(o.bottom_h)], { class: 'pen-m' }));
      if (!WALK_KINDS.has(o.kind)) {
        // glazing in the middle of the wall, sill
        const m = (a + bb) / 2;
        parts.push(line([X(m) - 0.15, Y(o.top_h)], [X(m) - 0.15, Y(o.bottom_h)], { class: 'pen-xs' }));
        parts.push(line([X(m) + 0.15, Y(o.top_h)], [X(m) + 0.15, Y(o.bottom_h)], { class: 'pen-xs' }));
      } else if (o.facade) {
        // door leaf (open) drawn as a thin line
        parts.push(line([X(bb), Y(o.bottom_h)], [X(bb), Y(o.top_h)], { class: 'pen-xs' }));
      }
    }
    // room names
    for (const rm of b.rooms ?? []) {
      if (rm.storey !== si) continue;
      const q = rectOf(rm.polygon);
      if (!q) continue;
      const perpIn = d.along === 't' ? q.s0 < d.at && q.s1 > d.at : q.t0 < d.at && q.t1 > d.at;
      if (!perpIn) continue;
      const [ra, rb] = d.along === 't' ? [q.t0, q.t1] : [q.s0, q.s1];
      const wmm = Math.abs(X(rb) - X(ra)) - 1.5;
      const cx = (X(ra) + X(rb)) / 2;
      const name = rm.name_de.replace(/\s*\(.*?\)/g, '');
      const words = wrapWords(name, wmm, 1.9);
      const stair = (b.stairs ?? []).find((x) => x.id === `stair-${rm.id}`);
      const sp = stair ? stairPlans(b, L).get(stair.id) : undefined;
      const hl = sp ? ceil - 0.6 : lv.floor_h + 1.0;
      words.forEach((w, i) => labels.push(text([cx, Y(hl) - (words.length - 1 - i) * 2.4], w, { size: 1.9, anchor: 'middle', class: 'halo' })));
      const sub = sp ? `${sp.risers} Stg. ${de(sp.riser * 100, 1)}/${de(sp.tread * 100, 1)} cm · LH ${de(ceil - lv.floor_h)}` : `LH ${de(ceil - lv.floor_h)}`;
      labels.push(text([cx, Y(hl) + 2.4], sub, { size: 1.5, anchor: 'middle', class: 'halo muted' }));
    }
    // floor level marks inside
    const xm = (X(oR[0]) + X(oR[1])) / 2;
    void xm;
  }

  // stairs
  parts.push(stairsInSection(c, b, L, slab));

  // roof
  const roof = buildingRoof(L);
  const eaves = L.stack.eaves_h;
  const prof: P2[] = [];
  const profIn: P2[] = [];
  const N = 240;
  let ridgeAtCut = eaves;
  const roofT = 0.35;
  const roofUnion = (q: ST) => roof.heightAt(q[0], q[1]);
  const roofMax = Math.max(L.roof.ridge_h, ...roof.raised.map((x) => x.rr.section.ridge_h));
  for (let i = 0; i <= N; i++) {
    const rr = oR[0] + ((oR[1] - oR[0]) * i) / N;
    const q = c.st(Math.min(Math.max(rr, oR[0] + 1e-3), oR[1] - 1e-3));
    const h = clampH(roofUnion(q), eaves, roofMax);
    ridgeAtCut = Math.max(ridgeAtCut, h);
    prof.push([X(rr), Y(h)]);
  }
  for (let i = N; i >= 0; i--) {
    const rr = oR[0] + ((oR[1] - oR[0]) * i) / N;
    const ri = Math.min(Math.max(rr, oR[0] + wallT * 0.6), oR[1] - wallT * 0.6);
    const q = c.st(ri);
    const h = clampH(roofUnion(q) - roofT, eaves, roofMax);
    profIn.push([X(rr), Y(h)]);
  }
  // the building's own interior hides everything beyond the cut plane
  parts.unshift(path([[X(oR[0]), Y(footBottom)], ...prof, [X(oR[1]), Y(footBottom)]], true, { fill: '#fff', stroke: 'none' }));
  parts.push(path([...prof, ...profIn], true, { class: 'poche-i' }));
  parts.push(path(prof, false, { class: 'pen-xl' }));
  parts.push(path(profIn, false, { class: 'pen-s' }));
  // collar beam at the break (mansard): schematic
  if (L.roof.break_h) {
    const ys = Y(L.roof.break_h);
    const inside = profIn.filter(([, y]) => y <= ys + 0.01);
    if (inside.length > 1) {
      const xs = inside.map((p) => p[0]);
      parts.push(line([Math.min(...xs), ys], [Math.max(...xs), ys], { class: 'pen-s hyp' }));
      labels.push(text([(Math.min(...xs) + Math.max(...xs)) / 2, ys - 0.8], 'Dachstuhl / Kehlbalkenlage schematisch (U)', { size: 1.4, anchor: 'middle', class: 'muted halo i' }));
    }
  }
  labels.push(text([(X(oR[0]) + X(oR[1])) / 2, Y(eaves + 1.2)], 'Mansardgeschoss (keine Raumdaten, U)', { size: 1.6, anchor: 'middle', class: 'muted halo i' }));
  // cornice projection at the eaves on both faces
  for (const [rr, dir] of [
    [oR[0], -1],
    [oR[1], 1],
  ] as const) {
    const x = X(rr);
    const dx = (X(rr + dir * 0.9) - x);
    parts.push(path([[x, Y(eaves)], [x + dx, Y(eaves)], [x + dx, Y(eaves - 0.35)], [x, Y(eaves - 1.0)]], true, { class: 'poche-d' }));
  }
  // lantern
  for (const t of roof.turrets) {
    const cr = d.along === 't' ? [-t.tw, t.tw] : [t.s0, t.s1];
    const crosses = d.along === 't' ? t.s0 < d.at && t.s1 > d.at : -t.tw < d.at && t.tw > d.at;
    const q0 = c.st(cr[0]);
    const base = Math.min(roof.heightAt(q0[0], q0[1]), t.base);
    const body = t.base + (t.top - t.base) * 0.62;
    const xa = X(cr[0]);
    const xb = X(cr[1]);
    const xm = (xa + xb) / 2;
    const cls = crosses ? 'pen-l' : 'pen-s';
    parts.push(path([[xa, Y(base)], [xb, Y(base)], [xb, Y(body)], [xa, Y(body)]], true, { fill: '#fff', class: cls }));
    parts.push(path([[xa - 0.6, Y(body)], [xb + 0.6, Y(body)], [xm, Y(t.top)]], true, { fill: '#fff', class: cls }));
    labels.push(text([xb + 2, Y(body)], 'Laterne (U)', { size: 1.5, class: 'halo muted' }));
  }
  // outline of the building cut (thick)
  return { svg: g({ class: 'cut' }, ...parts, ...labels), dimPos: [...dimPos].sort((a, b) => a - b), outlineR: oR, ridgeAtCut };
}

function clampH(h: number, lo: number, hi: number): number {
  return Number.isFinite(h) ? Math.min(hi, Math.max(lo, h)) : lo;
}

function wrapWords(s: string, widthMm: number, size: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size) > widthMm) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out.slice(0, 3);
}

/** Stairs: flights crossed by the cut as poché, flights beyond as views (dashed if hidden). */
function stairsInSection(c: Cut, b: Building, L: BuildingLayout, slab: number): string {
  const { d, X, Y } = c;
  const parts: string[] = [];
  const waist = 0.3;
  const perpOf = (q: ST) => (d.along === 't' ? q[0] : q[1]);
  for (const st of b.stairs ?? []) {
    const plan = stairPlans(b, L).get(st.id);
    if (!plan) continue;
    const hall = rectOf(st.polygon);
    const visibleRoom = hall ? (d.along === 't' ? hall.s0 <= d.at && hall.s1 >= d.at : hall.t0 <= d.at && hall.t1 >= d.at) : false;
    for (const f of plan.flights) {
      const going = flightGoing(f.risers, f.tread);
      const nrm: ST = [-f.dir[1], f.dir[0]];
      const corners: ST[] = [-1, 1].flatMap((kk) => [0, going].map((x) => [f.start[0] + f.dir[0] * x + nrm[0] * kk * (f.width / 2), f.start[1] + f.dir[1] * x + nrm[1] * kk * (f.width / 2)] as ST));
      const ds = corners.map((q) => c.depth(q));
      const dmin = Math.min(...ds);
      const dmax = Math.max(...ds);
      const parallel = d.along === 't' ? Math.abs(f.dir[1]) > 0.9 : Math.abs(f.dir[0]) > 0.9;
      const hTop = f.h0 + f.risers * f.riser;
      if (dmax < -0.01) continue; // in front of the cut
      const crossed = dmin < 0 && dmax > 0;
      if (parallel) {
        // profile along the cut: sawtooth
        const pts: P2[] = [];
        for (let i = 0; i < f.risers; i++) {
          const x0 = i * f.tread;
          const q0 = add2(f.start, f.dir, x0);
          pts.push([X(c.rOf(q0)), Y(f.h0 + i * f.riser)]);
          pts.push([X(c.rOf(q0)), Y(f.h0 + (i + 1) * f.riser)]);
          if (i < f.risers - 1) {
            const q1 = add2(f.start, f.dir, x0 + f.tread);
            pts.push([X(c.rOf(q1)), Y(f.h0 + (i + 1) * f.riser)]);
          }
        }
        const qs = add2(f.start, f.dir, 0);
        const qe = add2(f.start, f.dir, going);
        const under: P2[] = [
          [X(c.rOf(qe)), Y(hTop - waist - f.riser)],
          [X(c.rOf(qs)), Y(f.h0 - waist + f.riser * 0.3)],
        ];
        if (crossed) {
          parts.push(path([...pts, ...under], true, { class: 'poche-i' }));
          parts.push(path([...pts, ...under], true, { class: 'pen-l' }));
        } else {
          parts.push(path(pts, false, { class: visibleRoom ? 'pen-s' : 'pen-xs hid' }));
          parts.push(path(under, false, { class: visibleRoom ? 'pen-xs' : 'pen-xs hid' }));
          // handrail 0.95 m above the pitch line
          const hr: P2[] = [
            [X(c.rOf(qs)), Y(f.h0 + f.riser + 0.95)],
            [X(c.rOf(qe)), Y(hTop + 0.95)],
          ];
          if (visibleRoom) parts.push(path(hr, false, { class: 'pen-xs' }));
        }
      } else {
        // flight runs in depth: crossed -> one tread in section; beyond -> nosings as lines
        const rr = [-1, 1].map((kk) => c.rOf(add2(f.start, nrm, (kk * f.width) / 2)));
        if (crossed) {
          // position along the flight where the cut plane lies
          const perp0 = perpOf(f.start);
          const dirP = perpOf(f.dir);
          const x = Math.abs(dirP) > 1e-6 ? (d.at - perp0) / dirP : 0;
          const i = Math.max(0, Math.min(f.risers - 1, Math.floor(x / f.tread + 1e-9)));
          const h = f.h0 + (i + 1) * f.riser;
          parts.push(path([[X(rr[0]), Y(h)], [X(rr[1]), Y(h)], [X(rr[1]), Y(h - waist - 0.15)], [X(rr[0]), Y(h - waist - 0.15)]], true, { class: 'poche-i' }));
          parts.push(path([[X(rr[0]), Y(h)], [X(rr[1]), Y(h)], [X(rr[1]), Y(h - waist - 0.15)], [X(rr[0]), Y(h - waist - 0.15)]], true, { class: 'pen-l' }));
        } else if (visibleRoom) {
          for (let i = 0; i < f.risers; i++) {
            const h = f.h0 + (i + 1) * f.riser;
            parts.push(line([X(rr[0]), Y(h)], [X(rr[1]), Y(h)], { class: 'pen-xs' }));
          }
          parts.push(path([[X(rr[0]), Y(f.h0)], [X(rr[0]), Y(hTop)]], false, { class: 'pen-s' }));
          parts.push(path([[X(rr[1]), Y(f.h0)], [X(rr[1]), Y(hTop)]], false, { class: 'pen-s' }));
        } else {
          // hidden behind a wall: outline only
          parts.push(path([[X(rr[0]), Y(f.h0)], [X(rr[1]), Y(f.h0)], [X(rr[1]), Y(hTop)], [X(rr[0]), Y(hTop)]], true, { class: 'pen-xs hid' }));
        }
      }
    }
    for (const l of plan.landings) {
      const cornersL: ST[] = [
        [l.rect.s0, l.rect.t0],
        [l.rect.s1, l.rect.t0],
        [l.rect.s1, l.rect.t1],
        [l.rect.s0, l.rect.t1],
      ];
      const ds = cornersL.map((q) => c.depth(q));
      const dmin = Math.min(...ds);
      const dmax = Math.max(...ds);
      if (dmax < -0.01) continue;
      const [ra, rb] = d.along === 't' ? [l.rect.t0, l.rect.t1] : [l.rect.s0, l.rect.s1];
      const thick = l.kind === 'mid' ? waist + 0.1 : slab;
      if (dmin < 0 && dmax > 0) {
        const box: P2[] = [[X(ra), Y(l.h)], [X(rb), Y(l.h)], [X(rb), Y(l.h - thick)], [X(ra), Y(l.h - thick)]];
        parts.push(path(box, true, { class: 'poche-i' }));
        parts.push(path(box, true, { class: 'pen-m' }));
      } else {
        parts.push(line([X(ra), Y(l.h)], [X(rb), Y(l.h)], { class: visibleRoom ? 'pen-s' : 'pen-xs hid' }));
        parts.push(line([X(ra), Y(l.h - thick)], [X(rb), Y(l.h - thick)], { class: visibleRoom ? 'pen-xs' : 'pen-xs hid' }));
      }
    }
  }
  return g({ class: 'stairs' }, ...parts);
}

function add2(a: ST, b: ST | readonly number[], k: number): ST {
  return [a[0] + b[0] * k, a[1] + b[1] * k];
}

/** Simplified cut of another building crossing the section line (walls + roof outline). */
function simpleCut(c: Cut, X: BuildingLayout): string {
  // intersection of its footprint ring with the cut line (sampled)
  const rs: number[] = [];
  for (let r = c.d.siteFrom; r <= c.d.siteTo; r += 0.1) {
    const e = c.en(c.st(r));
    if (pointInPolygon([e[0], e[1]], X.ring)) rs.push(r);
  }
  if (rs.length < 3) return '';
  const a = Math.min(...rs);
  const b = Math.max(...rs);
  const xa = c.X(a);
  const xb = c.X(b);
  const top = X.roof.type === 'none' ? X.stack.eaves_h : X.stack.eaves_h;
  const x0 = Math.min(xa, xb);
  const w = Math.abs(xb - xa);
  const parts = [rect(x0, c.Y(top), Math.max(w, 0.4), c.Y(X.stack.base_h) - c.Y(top), { class: w < 3 ? 'poche-d' : 'poche-i' }), rect(x0, c.Y(top), Math.max(w, 0.4), c.Y(X.stack.base_h) - c.Y(top), { class: 'pen-m' })];
  if (X.roof.type !== 'none' && X.roof.type !== 'flat' && w > 2) parts.push(path([[x0, c.Y(top)], [x0 + w / 2, c.Y(X.roof.ridge_h)], [x0 + w, c.Y(top)]], true, { fill: '#fff', class: 'pen-m' }));
  parts.push(text([x0 + w / 2, c.Y(Math.max(X.roof.ridge_h, top)) - 1.5], `${shortName(X.building)} (${X.id}, vereinfacht)`, { size: 1.6, anchor: 'middle', class: 'halo' }));
  return g({ class: 'simplecut' }, ...parts);
}

/** Avenue trees beyond the cut (within 30 m), schematic crowns. */
function trees(spec: SiteSpec, c: Cut, r0: number, r1: number, g89: (E: number, N: number) => { h: number }): string {
  const out: { x: number; dpt: number; h: number; g: number }[] = [];
  const lo = Math.min(c.X(r0), c.X(r1));
  const hi = Math.max(c.X(r0), c.X(r1));
  for (const f of spec.terrain_features) {
    if (f.kind !== 'avenue' || !f.trees || f.geometry.type !== 'LineString') continue;
    for (const t of builtAvenueTrees(spec, f)) {
      const dpt = c.v.depthOf(t.E, t.N);
      if (dpt < 0 || dpt > 30) continue;
      const x = c.v.toPaper(t.E, t.N, 0)[0];
      if (x < lo || x > hi) continue;
      out.push({ x, dpt, h: f.trees.height ?? 8, g: g89(t.E, t.N).h });
    }
  }
  out.sort((a, b) => b.dpt - a.dpt);
  const k = c.v.k;
  const parts = out.map((t) => {
    const yb = c.Y(t.g);
    const ht = t.h * k;
    const rx = Math.max(1.2, t.h * 0.32 * k);
    const cy = yb - ht + rx * 1.1;
    return g({}, line([t.x, yb], [t.x, cy + rx * 0.6], { class: 'pen-s grey' }), `<ellipse cx="${t.x.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${(rx * 1.15).toFixed(2)}" class="pen-xs grey" style="fill:#fff;fill-opacity:.85"/>`);
  });
  return g({ class: 'trees' }, ...parts);
}

/** Names of the levelled terrain features crossed by the cut, written on the ground line. */
function groundLabels(spec: SiteSpec, c: Cut, r0: number, r1: number, xLo: number, xHi: number, g89: (E: number, N: number) => { h: number; src: string; id?: string }): string {
  const runs: { id: string; a: number; b: number; h: number }[] = [];
  for (let r = r0; r <= r1; r += 0.5) {
    const e = c.en(c.st(r));
    const q = g89(e[0], e[1]);
    if (q.src !== 'level' || !q.id) continue;
    const last = runs[runs.length - 1];
    if (last && last.id === q.id && r - last.b <= 0.6) last.b = r;
    else runs.push({ id: q.id, a: r, b: r, h: q.h });
  }
  const parts: string[] = [];
  for (const run of runs) {
    const xa = c.X(run.a);
    const xb = c.X(run.b);
    const w = Math.abs(xb - xa);
    if (w < 12) continue;
    const f = spec.terrain_features.find((x) => x.id === run.id)!;
    const nm = (f.name ?? f.id).replace(/\s*\(.*?\)/g, '');
    const s = `${nm} ${de(run.h)} [${run.id}]`;
    const size = textWidth(s, 1.7) < w - 2 ? 1.7 : 1.4;
    const tw = textWidth(s, size) / 2 + 1;
    const cx = Math.min(Math.max((xa + xb) / 2, xLo + tw), xHi - tw);
    parts.push(text([cx, c.Y(run.h) + 5.5], s, { size, anchor: 'middle', class: 'halo muted' }));
  }
  return g({ class: 'groundlabels' }, ...parts);
}

// ---------------------------------------------------------------------------------------------
// SC-01: Geländeschnitt 1:1000 along the whole axis
// ---------------------------------------------------------------------------------------------

function gelaendeschnitt(spec: SiteSpec, layoutOf: (b: Building) => BuildingLayout, d: SectionDef, L: BuildingLayout, g89: (E: number, N: number) => { h: number; src: string; id?: string }, dtm: Dtm | null, sheet: Sheet, yTop: number, _rLeft: number, r0: number, r1: number): string {
  const scale = 1000;
  const k = 1000 / scale;
  const a = sheet.area;
  // range along t: west (court) 120 m to east 440 m
  const rWest = 120;
  const rEast = -440;
  const hMin = 334;
  const hMax = 370;
  const y0 = yTop + 6 + (hMax - hMin) * k;
  const cTmp = makeCut(d, L, scale, 0, 0, hMin, y0);
  const sign = cTmp.X(1) > cTmp.X(0) ? 1 : -1;
  const width = (rWest - rEast) * k;
  const x0 = a.x0 + (a.x1 - a.x0 - width) / 2;
  const c = makeCut(d, L, scale, x0, sign > 0 ? rEast : rWest, hMin, y0);
  const parts: string[] = [];
  parts.push(text([x0, yTop + 2], 'Geländeschnitt in der Hauptachse 1:1000 (gleiche Schnittlinie, verlängert) – Gelände 1789 (Katalog) und heute (DGM1)', { size: 2.2, class: 'b' }));
  // grid lines every 10 m height
  for (let h = Math.ceil(hMin / 10) * 10; h <= hMax; h += 10) {
    parts.push(line([x0, c.Y(h)], [x0 + width, c.Y(h)], { class: 'pen-xs grey hid' }));
    parts.push(text([x0 - 1, c.Y(h) + 0.6], `${h}`, { size: 1.5, anchor: 'end', class: 'muted' }));
  }
  const gl = drawGround(c.v, g89, dtm, { origin: c.en(c.st(0)), dir: dirEN(c), x0: rEast, x1: rWest, step: 1, bottomY: c.Y(hMin) });
  parts.push(gl.svg);
  // buildings crossed by the axis: silhouettes
  for (const b of placedBuildings(spec)) {
    const X = layoutOf(b);
    const rs: number[] = [];
    for (let r = rEast; r <= rWest; r += 0.5) {
      const e = c.en(c.st(r));
      if (pointInPolygon([e[0], e[1]], X.ring)) rs.push(r);
    }
    if (!rs.length) continue;
    const ra = Math.min(...rs);
    const rb = Math.max(...rs);
    const xa = Math.min(c.X(ra), c.X(rb));
    const xb = Math.max(c.X(ra), c.X(rb));
    let topH = X.stack.eaves_h;
    if (X.id === L.id) {
      const roof = buildingRoof(L);
      const pts: P2[] = [];
      for (let r = ra; r <= rb + 1e-9; r += 0.25) {
        const q = c.st(r);
        pts.push([c.X(r), c.Y(Math.max(L.stack.eaves_h, roof.heightAt(q[0], q[1])))]);
      }
      parts.push(path([[c.X(ra), c.Y(X.stack.base_h)], ...pts, [c.X(rb), c.Y(X.stack.base_h)]], true, { fill: '#1d1d1d', class: 'pen-s' }));
      topH = Math.max(...pts.map((p) => hMin + (y0 - p[1]) / k));
    } else {
      parts.push(rect(xa, c.Y(X.stack.eaves_h), Math.max(xb - xa, 0.3), c.Y(X.stack.base_h) - c.Y(X.stack.eaves_h), { fill: '#555', class: 'pen-xs' }));
    }
    parts.push(text([(xa + xb) / 2, c.Y(topH) - 1.2], X.id, { size: 1.5, anchor: 'middle', class: 'halo' }));
  }
  // the 1:200 extract
  const ya = c.Y(hMax - 2);
  parts.push(rect(Math.min(c.X(r0), c.X(r1)), ya, Math.abs(c.X(r1) - c.X(r0)), c.Y(hMin + 4) - ya, { class: 'pen-s blue hid' }));
  parts.push(text([Math.min(c.X(r0), c.X(r1)) + 1, ya + 2.4], 'Ausschnitt 1:200 oben', { size: 1.5, style: 'fill:#2c5d8a' }));
  // feature labels: crossed terrain features (all kinds with polygons) and avenue
  const runs: { id: string; a: number; b: number }[] = [];
  for (let r = rEast; r <= rWest; r += 1) {
    const e = c.en(c.st(r));
    const q = g89(e[0], e[1]);
    if (q.src !== 'level' || !q.id) continue;
    const last = runs[runs.length - 1];
    if (last && last.id === q.id && r - last.b <= 1.1) last.b = r;
    else runs.push({ id: q.id, a: r, b: r });
  }
  let alt = 0;
  for (const run of runs) {
    const xa = c.X(run.a);
    const xb = c.X(run.b);
    const f = spec.terrain_features.find((x) => x.id === run.id)!;
    const e = c.en(c.st((run.a + run.b) / 2));
    const y = c.Y(g89(e[0], e[1]).h) + 4 + (alt++ % 2) * 2.4;
    parts.push(text([(xa + xb) / 2, y], `${run.id} ${(f.name ?? '').replace(/\s*\(.*?\)/g, '').slice(0, 34)}`, { size: 1.4, anchor: 'middle', class: 'halo muted' }));
  }
  const av = spec.terrain_features.find((f) => f.id === 'TF-11');
  if (av) {
    const xr = c.X(rEast + 40);
    const e = c.en(c.st(rEast + 40));
    parts.push(text([xr, c.Y(dtm ? dtm.at(e[0], e[1]) : 350) - 12], `${(av.name ?? 'Ostallee').replace(/\s*\(.*?\)/g, '')} [TF-11] ►`, { size: 1.6, anchor: 'middle', class: 'halo' }));
  }
  // scale bar of the strip
  parts.push(scaleBar([x0 + width - 62, c.Y(hMin) + 4], scale, 55));
  // west/east
  const leftName = sign > 0 ? 'Osten' : 'Westen';
  const rightName = sign > 0 ? 'Westen' : 'Osten';
  parts.push(text([x0, c.Y(hMin) + 4], `◄ ${leftName}`, { size: 1.8, class: 'b' }));
  parts.push(text([x0 + width, c.Y(hMin) + 9], `${rightName} ►`, { size: 1.8, class: 'b', anchor: 'end' }));
  parts.push(text([x0 + 20, c.Y(hMin) + 4], `Höhen m ü. NHN; 1:1000 ohne Überhöhung; ±0,00 = ${de(L.stack.levels.find((l) => l.kind !== 'plinth')!.floor_h)} m ü. NHN (${rel(L.stack.base_h, L.stack.levels.find((l) => l.kind !== 'plinth')!.floor_h)} Hofniveau)`, { size: 1.5, class: 'muted' }));
  return g({ id: 'gelaendeschnitt' }, ...parts);
}

function sectionLegend(): LegendItem[] {
  return [
    { swatch: sw.fill('#1d1d1d', 'pen-s'), label: 'geschnittene Außenwand (Lage D)' },
    { swatch: (x, y) => g({}, rect(x, y + 0.5, 10, 3, { class: 'poche-i' }), rect(x, y + 0.5, 10, 3, { class: 'pen-s' })), label: 'Innenwand, Decke, Treppe, Dach geschnitten (I/N)' },
    { swatch: (x, y) => rect(x, y + 0.5, 10, 3, { class: 'void' }), label: 'ohne Raumbefund (U)' },
    { swatch: (x, y) => rect(x, y + 0.5, 10, 3, { fill: 'url(#hatch-earth)', class: 'pen-xs' }), label: 'Sockelzone / Erdreich' },
    { swatch: sw.line('pen-s'), label: 'Ansichtskante hinter der Schnittebene' },
    { swatch: sw.line('pen-xs hid'), label: 'verdeckt (hinter Wand)' },
    { swatch: (x: number, y: number) => g({}, path([[x, y + 2], [x + 10, y + 2], [x + 10, y + 4], [x, y + 4]], true, { fill: 'url(#hatch-earth)', stroke: 'none' }), line([x, y + 2], [x + 10, y + 2], { class: 'pen-l' })), label: 'Gelände 1789 (Hypothese)' },
    { swatch: sw.line('pen-s red hid'), label: 'Gelände heute (DGM1 2025)' },
  ];
}

export type { Flight };
void sidePoint;
