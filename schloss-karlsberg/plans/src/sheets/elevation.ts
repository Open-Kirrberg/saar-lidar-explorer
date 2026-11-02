/**
 * Orthographic elevation renderer (pure string output): walls of the sides facing the viewer
 * with their layout openings, cornice, risalits, roof faces (incl. raised parts, dormers,
 * oculi, lantern), painted far -> near. Also the 1789 / today ground lines and a height column.
 */
import type { BuildingLayout } from '../../../model/src/layout/building.ts';
import { sidePoint, stToEN } from '../../../model/src/layout/footprint.ts';
import { CORNICE, PORTICO } from '../../../model/src/layout/grammar.ts';
import { wallFreeSpans } from '../../../model/src/layout/walls.ts';
import type { FacadeOpening } from '../../../model/src/layout/facade.ts';
import { pointAlong } from '../../../model/src/layout/geom.ts';
import { enToST } from '../../../model/src/layout/footprint.ts';
import { pointInPolygon } from '../../../model/src/layout/geom.ts';
import type { EN, SideName, SiteSpec, ST } from '../../../model/src/spec.ts';
import { SIDE_NAMES } from '../../../model/src/spec.ts';
import { type BuildingRoof, type V3, buildingRoof } from '../geom/roof3d.ts';
import type { ElevView } from '../geom/transform.ts';
import { type P2, de, g, line, path, rel, text } from '../svg.ts';
import type { Dtm } from '../terrain.ts';

const ROOF_FILL: Record<string, string> = { slate: '#dde0e4', tile: '#f1dccf', default: '#e6e6e6' };

function signedAreaP(p: P2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  return a / 2;
}

export interface ElevationOptions {
  /** Draw only buildings entirely behind this depth (sections: the cut plane). */
  behindDepth?: number;
  /** Detail level: 'full' draws glazing bars and dormers; 'simple' outlines only. */
  detail?: 'full' | 'simple';
  /** Footprints that free-standing walls are clipped against (default: the drawn buildings). */
  footprints?: EN[][];
}

/** Depth range of a building's footprint in a view. */
export function depthRange(L: BuildingLayout, v: ElevView): [number, number] {
  const d = L.ring.map(([E, N]) => v.depthOf(E, N));
  return [Math.min(...d), Math.max(...d)];
}

export function alongRange(L: BuildingLayout, v: ElevView): [number, number] {
  const a = L.ring.map(([E, N]) => v.along(E, N));
  return [Math.min(...a), Math.max(...a)];
}

export function topOf(L: BuildingLayout): number {
  const r = buildingRoof(L);
  return Math.max(L.roof.ridge_h, ...r.raised.map((x) => x.rr.section.ridge_h), ...r.turrets.map((t) => t.top));
}

/** All visible faces of the given buildings, painted far to near. */
export function drawElevation(layouts: BuildingLayout[], v: ElevView, o: ElevationOptions = {}): string {
  const order = layouts
    .filter((L) => o.behindDepth === undefined || depthRange(L, v)[0] > o.behindDepth + 0.05)
    .map((L) => ({ L, d: (depthRange(L, v)[0] + depthRange(L, v)[1]) / 2 }))
    .sort((a, b) => b.d - a.d);
  // walls coinciding with a building face (KB-B14 = KB-B10 basement front) are drawn only where free
  const rings = o.footprints ?? layouts.filter((L) => L.building.cls !== 'WALL' && L.building.footprint).map((L) => L.ring);
  return order.map(({ L }) => drawBuilding(L, v, o.detail ?? 'full', rings)).join('');
}

function drawBuilding(L: BuildingLayout, v: ElevView, detail: 'full' | 'simple', rings: EN[][] = []): string {
  const parts: string[] = [];
  const f = L.frame;
  const P3 = (s: number, t: number, h: number): P2 => {
    const [E, N] = stToEN(f, [s, t]);
    return v.toPaper(E, N, h);
  };
  const facing = (side: SideName) => {
    const sd = f.sides[side];
    const nE = sd.normal[0] * f.sDir[0] + sd.normal[1] * f.tDir[0];
    const nN = sd.normal[0] * f.sDir[1] + sd.normal[1] * f.tDir[1];
    return nE * v.depth[0] + nN * v.depth[1] < -0.02;
  };
  const bottom = Math.min(L.stack.plinth.bottom_h, L.stack.base_h - 1.5);
  const eaves = L.stack.eaves_h;
  const cls = L.building.cls;
  if (cls === 'WALL') {
    // free-standing / retaining wall: the band between the two long faces, only where it is not a building face
    const line0 = L.building.line;
    const spans: [number, number][] = line0 && line0.length >= 2
      ? wallFreeSpans(line0, rings.filter((r) => r !== L.ring)).map(([d0, d1]) => {
          const a = enToST(f, pointAlong(line0, d0).p as EN)[0];
          const c = enToST(f, pointAlong(line0, d1).p as EN)[0];
          return [Math.min(a, c), Math.max(a, c)] as [number, number];
        })
      : [[-f.length / 2, f.length / 2]];
    const w = f.width / 2;
    for (const [s0, s1] of spans) {
      for (const t of [-w, w]) parts.push(path([P3(s0, t, bottom), P3(s1, t, bottom), P3(s1, t, eaves), P3(s0, t, eaves)], true, { fill: '#f3ece6', class: 'pen-m' }));
    }
    return g({ class: `elev ${L.id}` }, ...parts);
  }
  const round = f.shape === 'round';
  // plinth band incl. a high basement storey (ashlar base, as in the 3D exterior)
  const plinthTop = L.stack.levels.find((l) => l.kind !== 'plinth' && l.kind !== 'basement')?.floor_h ?? L.stack.base_h;
  const sides = round ? [] : SIDE_NAMES.filter(facing);
  if (round) {
    // silhouette of a drum: the widest extent across the view
    const r = f.radius ?? f.width / 2;
    const c = v.toPaper(f.centreEN[0], f.centreEN[1], bottom);
    const k = v.k;
    parts.push(path([[c[0] - r * k, c[1]], [c[0] + r * k, c[1]], [c[0] + r * k, c[1] - (eaves - bottom) * k], [c[0] - r * k, c[1] - (eaves - bottom) * k]], true, { fill: '#fff', class: 'pen-l' }));
  }
  for (const side of sides) {
    const sd = f.sides[side];
    const quad = (h0: number, h1: number) => [P3(sd.p0[0], sd.p0[1], h0), P3(sd.p1[0], sd.p1[1], h0), P3(sd.p1[0], sd.p1[1], h1), P3(sd.p0[0], sd.p0[1], h1)];
    parts.push(path(quad(bottom, eaves), true, { fill: '#fff', class: 'pen-l' }));
    parts.push(path(quad(bottom, plinthTop), true, { fill: '#f2e6e0', class: 'pen-s' }));
    const ch = (CORNICE as Record<string, { height: number }>)[cls]?.height ?? CORNICE.default.height;
    parts.push(line(P3(sd.p0[0], sd.p0[1], eaves - ch), P3(sd.p1[0], sd.p1[1], eaves - ch), { class: 'pen-s' }));
    parts.push(line(P3(sd.p0[0], sd.p0[1], eaves - ch * 0.45), P3(sd.p1[0], sd.p1[1], eaves - ch * 0.45), { class: 'pen-xs' }));
    // string course at the upper floors
    for (const lv of L.stack.levels) {
      if (lv.kind === 'plinth' || lv.floor_h <= plinthTop + 0.01) continue;
      parts.push(line(P3(sd.p0[0], sd.p0[1], lv.floor_h - 0.1), P3(sd.p1[0], sd.p1[1], lv.floor_h - 0.1), { class: 'pen-xs' }));
    }
    // risalits
    const lay = L.sides[side];
    for (const r of lay.risalits) {
      for (const a of [r.a0, r.a1]) {
        if (a <= 0.01 || a >= sd.length - 0.01) continue;
        const q = sidePoint(f, side, a, 0);
        parts.push(line(P3(q[0], q[1], plinthTop), P3(q[0], q[1], eaves), { class: 'pen-m' }));
      }
    }
    for (const o of L.openings) {
      if (o.side !== side) continue;
      parts.push(openingElev(f, side, o.a, o.width, o.bottom_h, o.top_h, o.head, o.kind, P3, detail));
    }
    // Freitreppen / perrons and porticos in front of the portals (same layout portals as the 3D exterior)
    for (const o of L.openings) if (o.side === side && (o.steps ?? 0) > 0) parts.push(stepsElev(L, side, o, P3));
  }
  // roof
  const roof = buildingRoof(L);
  const cover = L.roofSpec.cover ?? 'default';
  const fill = ROOF_FILL[cover] ?? ROOF_FILL.default;
  const drawFaces = (faces: { pts: V3[]; kind: string }[]) => {
    const vis = faces
      .map((fc) => ({ fc, pts: fc.pts.map(([s, t, h]) => P3(s, t, h)) }))
      .filter(({ pts }) => signedAreaP(pts) < -1e-4 || signedAreaP(pts) > 1e-4)
      .filter(({ fc }) => faceTowardViewer(fc.pts, f, v));
    vis.sort((a, b) => faceDepth(b.fc.pts, f, v) - faceDepth(a.fc.pts, f, v));
    for (const { fc, pts } of vis) parts.push(path(pts, true, { fill: fc.kind === 'gable' ? '#fff' : fill, class: 'pen-m' }));
  };
  drawFaces(roof.main.faces);
  for (const r of roof.raised) drawFaces(r.solid.faces);
  if (detail === 'full' && !round) roofOpeningsElev(L, roof, v, P3, facing, parts);
  for (const t of roof.turrets) {
    const a = P3((t.s0 + t.s1) / 2, 0, t.base);
    const k = v.k;
    const w = (t.s1 - t.s0) * k;
    const hh = (t.top - t.base) * k;
    parts.push(path([[a[0] - w / 2, a[1]], [a[0] + w / 2, a[1]], [a[0] + w / 2, a[1] - hh * 0.6], [a[0] - w / 2, a[1] - hh * 0.6]], true, { fill: '#fff', class: 'pen-m' }));
    parts.push(path([[a[0] - w / 2 - 0.3, a[1] - hh * 0.6], [a[0], a[1] - hh], [a[0] + w / 2 + 0.3, a[1] - hh * 0.6]], true, { fill, class: 'pen-m' }));
    parts.push(line([a[0], a[1] - hh], [a[0], a[1] - hh - 1.2 * k], { class: 'pen-s' }));
    parts.push(line([a[0] - w / 4, a[1] - hh * 0.15], [a[0] - w / 4, a[1] - hh * 0.5], { class: 'pen-xs' }), line([a[0] + w / 4, a[1] - hh * 0.15], [a[0] + w / 4, a[1] - hh * 0.5], { class: 'pen-xs' }));
  }
  return g({ class: `elev ${L.id}` }, ...parts);
}

/**
 * Steps in front of an opening seen head-on: n risers from the grade (o.grade_h ?? base_h) to the threshold, the
 * cheek walls, and for a portico the columns, entablature and balcony balustrade (exterior/facade.ts geometry).
 */
export function stepsElev(L: BuildingLayout, side: SideName, o: FacadeOpening, P3: (s: number, t: number, h: number) => P2): string {
  const f = L.frame;
  const n = Math.max(1, o.steps ?? 0);
  const base = o.grade_h ?? L.stack.base_h;
  const rise = (o.bottom_h - base) / n;
  if (rise <= 0.02) return '';
  const risalit = L.sides[side].risalits.find((r) => o.a >= r.a0 && o.a <= r.a1);
  const d = (risalit?.risalit.projection ?? 0) + 0.12;
  const por = o.portico;
  const w = por ? o.width + PORTICO.stairWidthExtra + 2 * PORTICO.columnDiameter + 1.2 : o.width + 1.2;
  const pt = (a: number, h: number): P2 => {
    const q = sidePoint(f, side, a, d);
    return P3(q[0], q[1], h);
  };
  const parts: string[] = [];
  const a0 = o.a - w / 2;
  const a1 = o.a + w / 2;
  parts.push(path([pt(a0, base), pt(a1, base), pt(a1, o.bottom_h), pt(a0, o.bottom_h)], true, { fill: '#f2e6e0', class: 'pen-m' }));
  for (let i = 1; i < n; i++) parts.push(line(pt(a0, base + i * rise), pt(a1, base + i * rise), { class: 'pen-xs' }));
  for (const [x0, x1] of [[a0 - 0.35, a0], [a1, a1 + 0.35]]) parts.push(path([pt(x0, base), pt(x1, base), pt(x1, o.bottom_h + 0.15), pt(x0, o.bottom_h + 0.15)], true, { fill: '#f2e6e0', class: 'pen-s' }));
  if (por) {
    const top = o.top_h + 0.3;
    const cw = PORTICO.columnDiameter;
    const span = o.width + 2 * cw + PORTICO.stairWidthExtra * 0.5;
    const dd = d + por.depth;
    const ptP = (a: number, h: number): P2 => {
      const q = sidePoint(f, side, a, dd);
      return P3(q[0], q[1], h);
    };
    for (let i = 0; i < por.columns; i++) {
      const c = o.a - span / 2 + (span * i) / Math.max(1, por.columns - 1);
      parts.push(path([ptP(c - cw / 2, o.bottom_h), ptP(c + cw / 2, o.bottom_h), ptP(c + cw * 0.42, top), ptP(c - cw * 0.42, top)], true, { fill: '#fff', class: 'pen-s' }));
    }
    const e0 = o.a - span / 2 - cw;
    const e1 = o.a + span / 2 + cw;
    parts.push(path([ptP(e0, top), ptP(e1, top), ptP(e1, top + PORTICO.entablature), ptP(e0, top + PORTICO.entablature)], true, { fill: '#fff', class: 'pen-m' }));
    if (por.balcony) {
      const b0 = top + PORTICO.entablature;
      parts.push(path([ptP(e0, b0), ptP(e1, b0), ptP(e1, b0 + PORTICO.balustrade), ptP(e0, b0 + PORTICO.balustrade)], true, { fill: 'none', class: 'pen-s' }));
      for (let x = e0 + 0.25; x < e1 - 0.1; x += 0.3) parts.push(line(ptP(x, b0 + 0.12), ptP(x, b0 + PORTICO.balustrade - 0.12), { class: 'pen-xs grey' }));
    }
  }
  return g({ class: 'steps' }, ...parts);
}

function faceTowardViewer(pts: V3[], f: BuildingLayout['frame'], v: ElevView): boolean {
  // 3D normal in (E, N, h)
  const P = pts.map(([s, t, h]) => {
    const [E, N] = stToEN(f, [s, t]);
    return [E, N, h] as V3;
  });
  const [a, b, c] = P;
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n: V3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  // orient the normal outwards (upwards for roof faces)
  if (n[2] < -1e-9) n = [-n[0], -n[1], -n[2]];
  if (Math.abs(n[2]) < 1e-9) {
    // vertical face (gable): outward = away from the footprint centre
    const cx = P.reduce((s, p) => s + p[0], 0) / P.length - f.centreEN[0];
    const cy = P.reduce((s, p) => s + p[1], 0) / P.length - f.centreEN[1];
    if (n[0] * cx + n[1] * cy < 0) n = [-n[0], -n[1], -n[2]];
  }
  return n[0] * v.depth[0] + n[1] * v.depth[1] < -1e-6;
}

function faceDepth(pts: V3[], f: BuildingLayout['frame'], v: ElevView): number {
  let d = 0;
  for (const [s, t] of pts) {
    const [E, N] = stToEN(f, [s, t]);
    d += v.depthOf(E, N);
  }
  return d / pts.length;
}

/** Window / door in elevation: outline with head form, frame, glazing bars. */
function openingElev(
  f: BuildingLayout['frame'],
  side: SideName,
  a: number,
  w: number,
  h0: number,
  h1: number,
  head: string,
  kind: string,
  P3: (s: number, t: number, h: number) => P2,
  detail: 'full' | 'simple',
): string {
  const l = sidePoint(f, side, a - w / 2, 0);
  const r = sidePoint(f, side, a + w / 2, 0);
  const pl0 = P3(l[0], l[1], h0);
  const pr0 = P3(r[0], r[1], h0);
  const pl1 = P3(l[0], l[1], h1);
  const pr1 = P3(r[0], r[1], h1);
  const wp = Math.hypot(pr0[0] - pl0[0], pr0[1] - pl0[1]);
  if (wp < 0.3) return '';
  const hp = Math.abs(pl0[1] - pl1[1]);
  const parts: string[] = [];
  let outline: string;
  let springY = pl1[1];
  if (head === 'round') {
    const rr = wp / 2;
    springY = pl1[1] + rr;
    outline = `M${pl0[0]} ${pl0[1]}L${pl0[0]} ${springY}A${rr} ${rr} 0 0 1 ${pr0[0]} ${springY}L${pr0[0]} ${pr0[1]}Z`;
  } else if (head === 'segmental') {
    const rise = Math.min(wp * 0.14, hp * 0.2);
    springY = pl1[1] + rise;
    const R = (wp * wp) / 4 / (2 * rise) + rise / 2;
    outline = `M${pl0[0]} ${pl0[1]}L${pl0[0]} ${springY}A${R} ${R} 0 0 1 ${pr0[0]} ${springY}L${pr0[0]} ${pr0[1]}Z`;
  } else {
    outline = `M${pl0[0]} ${pl0[1]}L${pl1[0]} ${pl1[1]}L${pr1[0]} ${pr1[1]}L${pr0[0]} ${pr0[1]}Z`;
  }
  const glass = kind === 'window' || kind === 'porte_fenetre' || kind === 'cellar_window' || kind === 'stall_window' || kind === 'oculus';
  parts.push(`<path d="${outline.replace(/(\d+\.\d{3})\d+/g, '$1')}" class="pen-m" style="fill:${glass ? '#eef1f4' : '#f7f3ee'}"/>`);
  if (detail === 'full' && wp > 1.2) {
    const cx = (pl0[0] + pr0[0]) / 2;
    if (glass) {
      // casement meeting rail + transom + glazing bars (pane ≈ 0.5 m)
      parts.push(line([cx, pl0[1]], [cx, springY], { class: 'pen-xs' }));
      const kpm = wp / w;
      const panes = Math.max(1, Math.round((h1 - h0) / 0.55));
      for (let i = 1; i < panes; i++) {
        const y = pl0[1] - ((h1 - h0) * kpm * i) / panes;
        if (y > springY + 0.2) parts.push(line([pl0[0] + 0.25, y], [pr0[0] - 0.25, y], { class: 'pen-xs grey' }));
      }
    } else {
      parts.push(line([cx, pl0[1]], [cx, springY], { class: 'pen-s' }));
    }
  }
  return parts.join('');
}

function roofOpeningsElev(L: BuildingLayout, roof: BuildingRoof, v: ElevView, P3: (s: number, t: number, h: number) => P2, facing: (s: SideName) => boolean, parts: string[]): void {
  const f = L.frame;
  for (const ro of L.roofOpenings) {
    if (!facing(ro.side)) continue;
    // dormers are drawn on every axis as in layout.roofOpenings (the 3D exterior does the same)
    void roof;
    const l = sidePoint(f, ro.side, ro.a - ro.width / 2, ro.inset);
    const r = sidePoint(f, ro.side, ro.a + ro.width / 2, ro.inset);
    const a0 = P3(l[0], l[1], ro.bottom_h);
    const b0 = P3(r[0], r[1], ro.bottom_h);
    const a1 = P3(l[0], l[1], ro.bottom_h + ro.height);
    const b1 = P3(r[0], r[1], ro.bottom_h + ro.height);
    if (ro.kind === 'oculus') {
      const c: P2 = [(a0[0] + b1[0]) / 2, (a0[1] + b1[1]) / 2];
      const rr = Math.abs(b0[0] - a0[0]) / 2;
      parts.push(`<circle cx="${c[0].toFixed(3)}" cy="${c[1].toFixed(3)}" r="${rr.toFixed(3)}" class="pen-s" style="fill:#eef1f4"/>`);
      continue;
    }
    const wp = Math.abs(b0[0] - a0[0]);
    const cheek = 0.12 * v.k;
    const cap = Math.min(wp * 0.35, 0.5 * v.k);
    parts.push(path([[a0[0] - cheek, a0[1] + 0.2], [b0[0] + cheek, b0[1] + 0.2], [b1[0] + cheek, b1[1]], [(a1[0] + b1[0]) / 2, a1[1] - cap], [a1[0] - cheek, a1[1]]], true, { fill: '#fff', class: 'pen-s' }));
    parts.push(path([a0, b0, b1, a1], true, { fill: '#eef1f4', class: 'pen-xs' }));
    parts.push(line([(a0[0] + b0[0]) / 2, a0[1]], [(a1[0] + b1[0]) / 2, a1[1]], { class: 'pen-xs' }));
  }
}

// ---------------------------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------------------------

const LEVEL_KINDS = new Set(['court', 'terrace', 'parterre', 'rondell', 'island']);

/** 1789 ground: level of the most specific (smallest) levelled terrain feature, else today's DTM. */
export function ground1789(spec: SiteSpec, dtm: Dtm | null): (E: number, N: number) => { h: number; src: 'level' | 'dtm'; id?: string } {
  const polys = spec.terrain_features
    .filter((f) => LEVEL_KINDS.has(f.kind) && f.level !== undefined && f.geometry.type === 'Polygon')
    .map((f) => ({ f, ring: (f.geometry as { coordinates: EN[][] }).coordinates[0], area: Math.abs(areaEN((f.geometry as { coordinates: EN[][] }).coordinates[0])) }))
    .sort((a, b) => a.area - b.area);
  return (E, N) => {
    for (const p of polys) if (pointInPolygon([E, N], p.ring)) return { h: p.f.level!, src: 'level', id: p.f.id };
    return { h: dtm ? dtm.at(E, N) : NaN, src: 'dtm' };
  };
}

function areaEN(r: EN[]): number {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return a / 2;
}

export interface GroundLineOptions {
  /** EN point at x = 0 of the line and the direction (unit) of increasing x. */
  origin: EN;
  dir: EN;
  x0: number;
  x1: number;
  step?: number;
  /** Paper y of the bottom of the masked area. */
  bottomY: number;
}

/** Ground profiles: 1789 (masking fill + earth hatch) and today's DTM (dashed). */
export function drawGround(v: ElevView, g1789: (E: number, N: number) => { h: number }, dtm: Dtm | null, o: GroundLineOptions): { svg: string; today: P2[]; past: P2[] } {
  const step = o.step ?? 0.5;
  const past: P2[] = [];
  const today: P2[] = [];
  for (let x = o.x0; x <= o.x1 + 1e-9; x += step) {
    const E = o.origin[0] + o.dir[0] * x;
    const N = o.origin[1] + o.dir[1] * x;
    const h = g1789(E, N).h;
    if (Number.isFinite(h)) past.push(v.toPaper(E, N, h));
    const t = dtm ? dtm.at(E, N) : NaN;
    if (Number.isFinite(t)) today.push(v.toPaper(E, N, t));
  }
  const parts: string[] = [];
  if (past.length > 1) {
    const mask: P2[] = [...past, [past[past.length - 1][0], o.bottomY], [past[0][0], o.bottomY]];
    parts.push(path(mask, true, { fill: '#fff', stroke: 'none' }));
    const band: P2[] = [...past, ...past.map(([x, y]) => [x, y + 2.2] as P2).reverse()];
    parts.push(path(band, true, { fill: 'url(#hatch-earth)', stroke: 'none' }));
    parts.push(path(past, false, { class: 'pen-l' }));
  }
  if (today.length > 1) parts.push(path(today, false, { class: 'pen-s red hid' }));
  return { svg: g({ class: 'ground' }, ...parts), today, past };
}

// ---------------------------------------------------------------------------------------------
// Height column
// ---------------------------------------------------------------------------------------------

export interface HeightMark {
  h: number;
  label: string;
}

/** Height marks: tick + triangle at xMark, labels "+5,20 / 351,40" and a name; staggered to avoid overlaps. */
export function heightColumn(v: ElevView, marks: HeightMark[], datum: number, xFrom: number, xMark: number): string {
  const parts: string[] = [];
  const sorted = [...marks].sort((a, b) => a.h - b.h);
  let lastY = Infinity;
  for (const m of sorted) {
    const y = v.at(0, m.h)[1];
    let ty = y;
    if (lastY - ty < 3.2) ty = lastY - 3.2;
    lastY = ty;
    parts.push(line([xFrom, y], [xMark + 1.5, y], { class: 'pen-xs axis grey' }));
    parts.push(path([[xMark, y], [xMark - 1.1, y - 1.6], [xMark + 1.1, y - 1.6]], true, { fill: m.h === datum ? '#000' : '#fff', class: 'pen-xs' }));
    if (Math.abs(ty - y) > 0.1) parts.push(line([xMark + 1.5, y], [xMark + 3, ty - 0.6], { class: 'pen-xs' }));
    parts.push(text([xMark + 3.2, ty - 0.6], `${rel(m.h, datum)}`, { size: 1.9, class: 'b' }));
    parts.push(text([xMark + 13, ty - 0.6], `${de(m.h)}`, { size: 1.7 }));
    parts.push(text([xMark + 24, ty - 0.6], m.label, { size: 1.5, class: 'muted' }));
  }
  return g({ class: 'heights' }, ...parts);
}

export { type ST };
