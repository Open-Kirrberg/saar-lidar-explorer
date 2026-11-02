/**
 * Lagepläne (site plans), north up, grid = ETRS89 / UTM 32N:
 *   LP-00 Übersichtsplan der Residenz 1:5000 (whole residence; DTM crop ends at N 5 465 000)
 *   LP-01 Lageplan Schlossbezirk 1:2000 (buildings by confidence, terrain features, avenues)
 *   LP-02 Lageplan Schlosskern 1:500 (roof plans, function colours, section lines)
 *   LP-03 Befund und Rekonstruktion 1:1000 (SLRM of the 1 m DTM under the reconstruction)
 * Footprints are the layout rings (model/src/layout) and roofs the plan roof solids, so the
 * site plans, the floor plans and the 3D model share one geometry.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BuildingLayout } from '../../../model/src/layout/building.ts';
import { stToEN } from '../../../model/src/layout/footprint.ts';
import type { Building, EN, SiteSpec, TerrainFeature } from '../../../model/src/spec.ts';
import { CONF_FILL, FUNCTION_DE, FUNCTION_FILL, type FunctionGroup, confidenceLegend, evidenceNote, functionGroup, placementClass, sourcesNote, sw } from '../evidence.ts';
import { buildingRoof } from '../geom/roof3d.ts';
import { builtAvenueTrees } from '../geom/trees.ts';
import { type PlanView, planView } from '../geom/transform.ts';
import { sectionDefs, sectionLineEN } from '../sections.ts';
import { type LegendItem, Sheet, type SheetSize, legendHeight, northArrow } from '../sheet.ts';
import { type P2, circle, de, el, g, line, path, rect, text, textWidth } from '../svg.ts';
import { DTM_ATTRIBUTION, loadContours, loadUnderlay } from '../terrain.ts';
import { placedBuildings } from './common.ts';

export interface LageplanReq {
  sheetNo: string;
  slug: string;
  title: string;
  subtitle: string;
  scale: number;
  size: SheetSize;
  centre: EN;
  colour: 'confidence' | 'function' | 'befund';
  underlay: { kind: 'hillshade' | 'slrm'; id: string; opacity: number };
  contours?: { id: string; every: number };
  roofs: boolean;
  grid: number;
  legendCorner: 'tl' | 'tr' | 'bl' | 'br';
  labels: 'major' | 'ids' | 'names';
}

export function lageplanRequests(): LageplanReq[] {
  return [
    {
      sheetNo: 'LP-00',
      slug: 'Uebersichtsplan_Residenz_1-5000',
      title: 'Übersichtsplan der Residenz',
      subtitle: 'Schloss, Hofbezirk, Gärten, Wirtschaftshöfe, Karlslust – Gebäude nach Konfidenz',
      scale: 5000,
      size: 'A2-hoch',
      centre: [382207, 5465838],
      colour: 'confidence',
      underlay: { kind: 'hillshade', id: 'site', opacity: 0.6 },
      contours: { id: 'site', every: 2 },
      roofs: false,
      grid: 500,
      legendCorner: 'tl',
      labels: 'major',
    },
    {
      sheetNo: 'LP-01',
      slug: 'Lageplan_Schlossbezirk_1-2000',
      title: 'Lageplan Schlossbezirk',
      subtitle: 'Gebäude nach Konfidenz, Terrassen, Höfe, Alleen, Höhenlinien 2 m aus DGM1',
      scale: 2000,
      size: 'A2-hoch',
      centre: [382280, 5466270],
      colour: 'confidence',
      underlay: { kind: 'hillshade', id: 'residence', opacity: 0.55 },
      contours: { id: 'residence', every: 2 },
      roofs: false,
      grid: 100,
      legendCorner: 'tl',
      labels: 'ids',
    },
    {
      sheetNo: 'LP-02',
      slug: 'Lageplan_Schlosskern_1-500',
      title: 'Lageplan Schlosskern',
      subtitle: 'Dachaufsicht, Gebäude nach Funktion, Höfe und Terrassen, Höhenlinien 1 m, Schnittlinien',
      scale: 500,
      size: 'A2-hoch',
      centre: [382236, 5466150],
      colour: 'function',
      underlay: { kind: 'hillshade', id: 'core', opacity: 0.45 },
      contours: { id: 'core', every: 1 },
      roofs: true,
      grid: 50,
      legendCorner: 'bl',
      labels: 'names',
    },
    {
      sheetNo: 'LP-03',
      slug: 'Befund_und_Rekonstruktion_1-1000',
      title: 'Befund und Rekonstruktion',
      subtitle: 'LiDAR-Befund (SLRM aus DGM1) unter den Grundrissen der Rekonstruktionshypothese',
      scale: 1000,
      size: 'A2-hoch',
      centre: [382245, 5466100],
      colour: 'befund',
      underlay: { kind: 'slrm', id: 'befund', opacity: 0.75 },
      roofs: false,
      grid: 100,
      legendCorner: 'tl',
      labels: 'ids',
    },
  ];
}

interface Ctx {
  spec: SiteSpec;
  r: LageplanReq;
  view: PlanView;
  P: (e: EN) => P2;
  k: number;
  map: { x0: number; y0: number; x1: number; y1: number };
  boxes: { x0: number; y0: number; x1: number; y1: number }[];
}

export function lageplanSheet(spec: SiteSpec, layoutOf: (b: Building) => BuildingLayout, r: LageplanReq): Sheet {
  const sheet = new Sheet(r.size, `${r.sheetNo} ${r.title}`);
  const a = sheet.area;
  const map = { x0: a.x0, y0: a.y0, x1: a.x1, y1: sheet.bandTop };
  const view = planView(r.scale, r.centre, [(map.x0 + map.x1) / 2, (map.y0 + map.y1) / 2], 0);
  const c: Ctx = { spec, r, view, P: (e) => view.toPaper(e[0], e[1]), k: view.k, map, boxes: [] };
  const clipId = `clip-${r.sheetNo}`;
  sheet.defs(`<clipPath id="${clipId}"><rect x="${map.x0}" y="${map.y0}" width="${map.x1 - map.x0}" height="${map.y1 - map.y0}"/></clipPath>`);
  const layers: string[] = [];
  const labels: string[] = [];
  const Ls = placedBuildings(spec).map((b) => layoutOf(b));

  // underlay + area outside the DTM crop
  layers.push(rect(map.x0, map.y0, map.x1 - map.x0, map.y1 - map.y0, { fill: 'url(#hatch-u)', stroke: 'none' }));
  const u = loadUnderlay(r.underlay.kind, r.underlay.id);
  if (u) {
    const p0 = c.P([u.bbox[0], u.bbox[3]]);
    const p1 = c.P([u.bbox[2], u.bbox[1]]);
    layers.push(rect(p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1], { fill: '#fff', stroke: 'none' }));
    layers.push(el('image', { href: u.href, x: p0[0], y: p0[1], width: p1[0] - p0[0], height: p1[1] - p0[1], preserveAspectRatio: 'none', opacity: r.underlay.opacity }));
    if (r.colour === 'befund') layers.push(rect(p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1], { class: 'pen-s' }));
    // outside-DTM note (Karlslust lies south of the DTM crop)
    const crop = [381000, 5465000, 384000, 5468000];
    const yS = c.P([0, crop[1]])[1];
    if (yS < map.y1 - 10) {
      const xm = c.P([382950, crop[1]])[0];
      labels.push(text([Math.min(xm, map.x1 - 70), yS + 6], 'Karlslust: außerhalb des DGM-Ausschnitts (N < 5 465 000) –', { size: 1.9, class: 'halo-l b' }));
      labels.push(text([Math.min(xm, map.x1 - 70), yS + 8.6], 'Gebäude nur nach Katalog (LiDAR-Befund KL, Lageplan 2006), ohne Schummerung', { size: 1.6, class: 'halo-l' }));
      layers.push(line([map.x0, yS], [map.x1, yS], { class: 'pen-s hid' }));
    }
  }
  if (r.contours) layers.push(contours(c));

  // terrain features
  for (const f of spec.terrain_features) layers.push(feature(c, f, labels));

  // buildings
  for (const L of Ls) layers.push(building(c, L));
  if (r.roofs) for (const L of Ls) layers.push(roofPlan(c, L));
  if (r.colour === 'befund') layers.push(lidarFeatures(c, labels));

  // section lines on the core plan
  if (r.sheetNo === 'LP-02') {
    const B01 = Ls.find((L) => L.id === 'KB-B01');
    if (B01) {
      for (const d of sectionDefs(spec)) {
        const [e0, e1] = sectionLineEN(B01, d, d.along === 't' ? -14 : -24, d.along === 't' ? 14 : 24);
        const p0 = c.P(e0);
        const p1 = c.P(e1);
        layers.push(line(p0, p1, { class: 'pen-m axis red' }));
        for (const p of [p0, p1]) labels.push(text([p[0], p[1] + 1.2], d.id, { size: 3.2, anchor: 'middle', class: 'b halo' }));
      }
    }
  }

  // building labels (largest first, collision-checked)
  for (const L of [...Ls].sort((x, y) => areaOf(y.ring) - areaOf(x.ring))) labels.push(buildingLabel(c, L));
  labels.push(featureLabels(c));

  sheet.add(g({ 'clip-path': `url(#${clipId})` }, ...layers, ...labels, gridMarks(c)));
  // map frame, north arrow, legend overlay
  sheet.add(rect(map.x0, map.y0, map.x1 - map.x0, map.y1 - map.y0, { class: 'pen-l' }));
  sheet.add(northArrow([map.x1 - 18, map.y0 + 22], 0, r.centre[0], r.centre[1], 10));
  mapLegend(sheet, c);
  sheet.frame();

  const legend: LegendItem[] =
    r.colour === 'befund'
      ? [
          { swatch: sw.fill('none', 'pen-l', { style: 'stroke:#c0261b' }), label: 'Rekonstruktion: Grundriss Katalog v2' },
          { swatch: sw.fill('none', 'pen-m', { style: 'stroke:#1f5fa8' }), label: 'LiDAR-Befund (research/03, Kennung KB-/KL-)' },
          { swatch: sw.fill('none', 'pen-s hid', { style: 'stroke:#c0261b' }), label: 'Terrassen, Höfe, Teiche (Katalog)' },
          { swatch: sw.fill('#888', 'pen-xs'), label: 'SLRM: hell = erhaben, dunkel = vertieft' },
        ]
      : confidenceLegend();
  sheet.band({
    title: {
      sheetNo: r.sheetNo,
      title: r.title,
      subtitle: r.subtitle,
      scale: `1:${r.scale.toLocaleString('de-DE')}`,
      info: [
        `${Ls.length} verortete Bauten des Katalogs v2 (Konfidenz und Lagequelle je Gebäude im Katalog)`,
        r.colour === 'befund' ? 'Unterlage: Local Relief Model (SLRM) aus DGM1, 2 px/m; Befundkennungen aus research/03' : 'Unterlage: Schummerung DGM1 (Licht aus NW), Höhenlinien aus geglättetem DGM1',
        'Norden oben (Gitternord); Gitter ETRS89 / UTM 32N (EPSG:25832)',
      ],
    },
    info: [`Maßstab 1:${r.scale.toLocaleString('de-DE')}`, 'Höhen m ü. NHN (DHHN2016)', `Gitter ${r.grid} m (EPSG:25832)`, `γ (Meridiankonvergenz) = ${de(-1.23, 2)}°`],
    scale: r.scale,
    legend,
    legendCols: 2,
    notes: [
      evidenceNote()[0],
      r.colour === 'befund'
        ? 'Befund = sichtbare Geländeformen im DGM1 (Terrassen, Fundamentlinien, Gruben, Dämme). Rekonstruktion = Hypothese. Keine Grabungs- oder Sondenhinweise: Bodendenkmal, Schauen, nicht graben.'
        : 'Gebäude außerhalb der LiDAR-Befunde nach dem Lageplan 2006 georeferenziert (Lagefehler ±5–10 m möglich).',
      `Gelände: ${DTM_ATTRIBUTION}.`,
      sourcesNote()[1],
      sourcesNote()[0],
    ],
  });
  return sheet;
}

function areaOf(ring: readonly EN[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(s / 2);
}

function inMap(c: Ctx, p: P2, pad = 0): boolean {
  return p[0] >= c.map.x0 - pad && p[0] <= c.map.x1 + pad && p[1] >= c.map.y0 - pad && p[1] <= c.map.y1 + pad;
}

// ---------------------------------------------------------------------------------------------

function contours(c: Ctx): string {
  const cs = loadContours(c.r.contours!.id);
  if (!cs) return '';
  const every = c.r.contours!.every;
  const parts: string[] = [];
  const lab: string[] = [];
  let nLab = 0;
  for (const ln of cs.lines) {
    if (Math.abs(ln.h / every - Math.round(ln.h / every)) > 1e-6 && !ln.index) continue;
    const pts = ln.pts.map((e) => c.P(e));
    if (!pts.some((p) => inMap(c, p, 5))) continue;
    parts.push(path(pts, false, { class: ln.index ? 'pen-s' : 'pen-xs', style: `stroke:${ln.index ? '#7a5a3a' : '#a88a6a'};stroke-opacity:${ln.index ? 0.9 : 0.7}` }));
    if (ln.index && pts.length > 8 && nLab < 120) {
      // label at the middle of the line, along it
      const i = Math.floor(pts.length / 2);
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 2)];
      const lenMm = pathLen(pts);
      if (lenMm < 30 || !inMap(c, p, -6)) continue;
      let ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      lab.push(text([p[0], p[1] + 0.5], de(ln.h, 0), { size: 1.6, anchor: 'middle', rotate: ang, class: 'halo', style: 'fill:#6a4a2a' }));
      nLab++;
    }
  }
  return g({ class: 'contours' }, ...parts, ...lab);
}

function pathLen(p: P2[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return s;
}

const POLY_STYLE: Partial<Record<TerrainFeature['kind'], { fill: string; cls: string; op: number }>> = {
  court: { fill: '#eadfc6', cls: 'pen-s', op: 0.8 },
  terrace: { fill: '#f1ebdc', cls: 'pen-s', op: 0.55 },
  parterre: { fill: '#cfe3bf', cls: 'pen-xs', op: 0.75 },
  rondell: { fill: '#cfe3bf', cls: 'pen-xs', op: 0.75 },
  island: { fill: '#cfe3bf', cls: 'pen-xs', op: 0.9 },
  pond: { fill: '#bcd8ee', cls: 'pen-s blue', op: 0.9 },
  moat: { fill: '#bcd8ee', cls: 'pen-s blue', op: 0.9 },
  well: { fill: '#bcd8ee', cls: 'pen-s blue', op: 1 },
  enclosure: { fill: 'none', cls: 'pen-s hid', op: 1 },
  wall: { fill: '#555', cls: 'pen-s', op: 1 },
};

function feature(c: Ctx, f: TerrainFeature, _labels: string[]): string {
  const befund = c.r.colour === 'befund';
  const geo = f.geometry;
  const parts: string[] = [];
  if (geo.type === 'Polygon') {
    const st = POLY_STYLE[f.kind] ?? { fill: '#eee', cls: 'pen-xs', op: 0.6 };
    const pts = geo.coordinates[0].map((e) => c.P(e));
    if (befund) {
      if (['court', 'terrace', 'pond', 'parterre', 'moat', 'rondell'].includes(f.kind)) parts.push(path(pts, true, { class: 'pen-s hid', style: 'stroke:#c0261b' }));
    } else parts.push(path(pts, true, { fill: st.fill, class: st.cls, style: `fill-opacity:${st.op}` }));
  } else if (geo.type === 'LineString') {
    const pts = geo.coordinates.map((e) => c.P(e));
    if (f.kind === 'avenue') {
      // own line style for reconstructed avenue axes (green dash-dot), distinct from LiDAR-Befund blue (review-1 #20)
      if (befund) {
        // translucent green band = avenue between the outer tree rows; the LiDAR trace (blue) stays readable on top
        const wBand = Math.max(1.2, (f.trees?.row_distance ?? 10) * c.k);
        parts.push(path(pts, false, { style: `fill:none;stroke:#3f8a3a;stroke-opacity:.22;stroke-width:${wBand.toFixed(2)};stroke-linecap:butt` }));
        parts.push(path(pts, false, { class: 'pen-xs axis', style: 'stroke:#2f7a2f' }));
      } else parts.push(path(pts, false, { class: 'pen-xs axis', style: 'stroke:#4c7a3a' }));
      if (f.trees) {
        const rC = Math.max(0.35, (f.trees.height ?? 6) * 0.3 * c.k);
        for (const t of builtAvenueTrees(c.spec, f)) {
          const p = c.P([t.E, t.N]);
          if (!inMap(c, p, 2)) continue;
          parts.push(circle(p, rC, befund ? { class: 'pen-xs', style: 'stroke:#2f7a2f' } : { fill: '#8fbf6f', class: 'pen-xs', style: 'stroke:#3f6a2a;fill-opacity:.85' }));
        }
      }
    } else if (f.kind === 'scarp' || f.kind === 'wall') {
      parts.push(path(pts, false, { class: f.kind === 'wall' ? 'pen-l' : 'pen-m', style: befund ? 'stroke:#c0261b' : 'stroke:#6b4a2a' }));
      if (!befund) parts.push(hachures(pts, 1.4 * Math.max(0.6, c.k), 1.2));
    } else if (f.kind === 'dam') {
      parts.push(path(pts, false, { class: 'pen-xl', style: 'stroke:#6b4a2a' }));
    } else if (f.kind === 'cascade') {
      parts.push(path(pts, false, { class: 'pen-l blue' }));
    } else if (f.kind === 'path') {
      parts.push(path(pts, false, { class: 'pen-s hid', style: 'stroke:#6b4a2a' }));
    } else parts.push(path(pts, false, { class: 'pen-s' }));
  } else if (geo.type === 'MultiPoint') {
    for (const e of geo.coordinates as EN[]) parts.push(circle(c.P(e), Math.max(0.6, 1.5 * c.k), { fill: '#bcd8ee', class: 'pen-s blue' }));
  }
  return g({ class: `feat ${f.kind}` }, ...parts);
}

/** Slope hachures on the right-hand side of a polyline (scarp foot side unknown: schematic). */
function hachures(pts: P2[], step: number, len: number): string {
  const out: string[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const t: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const nrm: P2 = [-t[1], t[0]];
    for (let s = step / 2; s < L; s += step) {
      const p: P2 = [a[0] + t[0] * s, a[1] + t[1] * s];
      out.push(line(p, [p[0] + nrm[0] * len, p[1] + nrm[1] * len], { class: 'pen-xs', style: 'stroke:#6b4a2a' }));
    }
  }
  return g({}, ...out);
}

function building(c: Ctx, L: BuildingLayout): string {
  const b = L.building;
  const pts = L.ring.map((e) => c.P(e));
  if (!pts.some((p) => inMap(c, p, 10))) return '';
  const pc = placementClass(b.placement);
  if (c.r.colour === 'befund') return path(pts, true, { class: 'pen-l', style: 'stroke:#c0261b' });
  const fill = c.r.colour === 'function' ? FUNCTION_FILL[functionGroup(b)] : CONF_FILL[b.confidence];
  const op = c.r.roofs ? 0.55 : 0.95;
  return path(pts, true, { fill, class: `pen-m ${pc}`, style: `fill-opacity:${op}` });
}

/** Roof plan: edges of all roof faces (ridges, hips, breaks), raised parts on top, lanterns. */
function roofPlan(c: Ctx, L: BuildingLayout): string {
  if (L.roof.type === 'none' || L.roof.type === 'mound') return '';
  const pts0 = L.ring.map((e) => c.P(e));
  if (!pts0.some((p) => inMap(c, p, 10))) return '';
  const roof = buildingRoof(L);
  const P = (s: number, t: number) => c.P(stToEN(L.frame, [s, t]));
  const parts: string[] = [];
  const fill = FUNCTION_FILL[functionGroup(L.building)];
  for (const f of roof.main.faces) parts.push(path(f.pts.map(([s, t]) => P(s, t)), true, { class: f.kind === 'deck' ? 'pen-xs' : 'pen-s' }));
  for (const r of roof.raised) for (const f of r.solid.faces) parts.push(path(f.pts.map(([s, t]) => P(s, t)), true, { fill, class: 'pen-s', style: 'fill-opacity:1' }));
  for (const t of roof.turrets) parts.push(path([P(t.s0, -t.tw), P(t.s1, -t.tw), P(t.s1, t.tw), P(t.s0, t.tw)], true, { fill: '#fff', class: 'pen-m' }));
  return g({ class: 'roof' }, ...parts);
}

function shortId(id: string): string {
  return id.replace(/^KB-/, '');
}

function buildingLabel(c: Ctx, L: BuildingLayout): string {
  const ring = L.ring;
  const area = areaOf(ring);
  if (c.r.labels === 'major' && area < 350 && !L.id.startsWith('KL-')) return '';
  const cen = c.P(L.frame.centreEN);
  if (!inMap(c, cen, -4)) return '';
  const size = c.r.labels === 'names' ? 2.0 : c.r.scale >= 5000 ? 1.35 : 1.6;
  let s = shortId(L.id);
  if (c.r.labels === 'names') {
    const nm = L.building.name_de.replace(/\s*\(.*?\)\s*/g, ' ').split(/[–,;]/)[0].trim();
    s = `${nm}\n${L.id}`;
  }
  const lines = s.split('\n');
  const w = Math.max(...lines.map((x) => textWidth(x, size)));
  const h = lines.length * size * 1.25;
  // try the centre, then above / below
  for (const dy of [0, -h - 1.5, h + 1.5]) {
    const bx = { x0: cen[0] - w / 2 - 0.4, y0: cen[1] + dy - size, x1: cen[0] + w / 2 + 0.4, y1: cen[1] + dy - size + h + 0.3 };
    if (c.boxes.some((q) => q.x0 < bx.x1 && q.x1 > bx.x0 && q.y0 < bx.y1 && q.y1 > bx.y0)) continue;
    c.boxes.push(bx);
    return text([cen[0], cen[1] + dy + size * 0.35 - ((lines.length - 1) * size * 1.25) / 2], s, { size, anchor: 'middle', class: lines.length > 1 ? 'halo-l' : 'halo b' });
  }
  return '';
}

function featureLabels(c: Ctx): string {
  const parts: string[] = [];
  for (const f of c.spec.terrain_features) {
    const geo = f.geometry;
    const nm = (f.name ?? f.id).replace(/\s*\(.*?\)/g, '').split(/[;/]/)[0].trim();
    const size = c.r.scale >= 5000 ? 1.4 : c.r.scale >= 2000 ? 1.6 : 2.0;
    if (geo.type === 'Polygon') {
      const ring = geo.coordinates[0];
      const area = areaOf(ring);
      if (area * c.k * c.k < 120) continue;
      let cx = 0;
      let cy = 0;
      for (const e of ring.slice(0, -1)) {
        cx += e[0];
        cy += e[1];
      }
      const p = c.P([cx / (ring.length - 1), cy / (ring.length - 1)]);
      if (!inMap(c, p, -5)) continue;
      const s = `${nm}${f.level !== undefined ? ` ${de(f.level)}` : ''} [${f.id}]`;
      const w = textWidth(s, size);
      const bx = { x0: p[0] - w / 2, y0: p[1] + 3 - size, x1: p[0] + w / 2, y1: p[1] + 3.5 };
      if (c.boxes.some((q) => q.x0 < bx.x1 && q.x1 > bx.x0 && q.y0 < bx.y1 && q.y1 > bx.y0)) continue;
      c.boxes.push(bx);
      parts.push(text([p[0], p[1] + 3], s, { size, anchor: 'middle', class: 'halo i', style: 'fill:#4a3a2a' }));
    } else if (geo.type === 'LineString' && (f.kind === 'avenue' || f.kind === 'cascade' || f.kind === 'dam')) {
      const pts = geo.coordinates.map((e) => c.P(e));
      const lenMm = pathLen(pts);
      if (lenMm < 40) continue;
      // label at the visible middle of the line
      const vis = pts.filter((p) => inMap(c, p, -8));
      if (vis.length < 2) {
        // long straight line: sample it
        const a = pts[0];
        const b = pts[pts.length - 1];
        let best: P2 | null = null;
        for (let i = 1; i < 20; i++) {
          const q: P2 = [a[0] + ((b[0] - a[0]) * i) / 20, a[1] + ((b[1] - a[1]) * i) / 20];
          if (inMap(c, q, -10)) best = best ?? q;
        }
        if (!best) continue;
        vis.push(best, [best[0] + (b[0] - a[0]) * 0.01, best[1] + (b[1] - a[1]) * 0.01]);
      }
      const p = vis[Math.floor(vis.length / 2) - (vis.length > 2 ? 1 : 0)];
      const q = vis[Math.floor(vis.length / 2)];
      const dx = q[0] - p[0] || 1e-6;
      let ang = (Math.atan2(q[1] - p[1], dx) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      const s = `${nm} [${f.id}]`;
      const off = c.r.colour === 'befund' ? -1.2 : -((f.trees?.row_distance ?? 10) / 2) * c.k - 1.0;
      const rad = (ang * Math.PI) / 180;
      const pp: P2 = [p[0] - Math.sin(rad) * off, p[1] + Math.cos(rad) * off];
      parts.push(text(pp, s, { size, anchor: 'middle', rotate: ang, class: 'halo i', style: 'fill:#2f5a22' }));
    }
  }
  return g({ class: 'feature-labels' }, ...parts);
}

function lidarFeatures(c: Ctx, labels: string[]): string {
  const p = resolve(import.meta.dirname, '..', '..', '..', 'research', 'lidar_features.geojson');
  const fc = JSON.parse(readFileSync(p, 'utf8')) as { features: { properties: { id: string; kind: string; confidence: string }; geometry: { type: string; coordinates: unknown } }[] };
  const parts: string[] = [];
  for (const f of fc.features) {
    const gm = f.geometry;
    let pts: P2[] = [];
    let closed = false;
    if (gm.type === 'Polygon') {
      pts = (gm.coordinates as EN[][])[0].map((e) => c.P(e));
      closed = true;
    } else if (gm.type === 'LineString') pts = (gm.coordinates as EN[]).map((e) => c.P(e));
    if (!pts.length || !pts.some((q) => inMap(c, q, 5))) continue;
    // linear LiDAR traces of avenues / paths: thinner double-dash blue, not the outline pen of foundations
    const linear = !closed && (f.properties.kind === 'avenue' || f.properties.kind === 'path');
    const cls = linear ? 'pen-s' : f.properties.confidence === 'low' ? 'pen-m hid' : 'pen-m';
    parts.push(path(pts, closed, { class: cls, style: linear ? 'stroke:#1f5fa8;stroke-dasharray:2.4 .7 .7 .7' : 'stroke:#1f5fa8' }));
    // label at the first vertex inside the map (top-most point)
    const inside = pts.filter((q) => inMap(c, q, -4));
    if (!inside.length) continue;
    const top = inside.reduce((m, q) => (q[1] < m[1] ? q : m), inside[0]);
    labels.push(text([top[0], top[1] - 1.2], f.properties.id, { size: 1.8, anchor: 'middle', class: 'halo-l b', style: 'fill:#1f5fa8' }));
  }
  return g({ class: 'lidar' }, ...parts);
}

function gridMarks(c: Ctx): string {
  const { map, view, r } = c;
  const st = r.grid;
  const e0 = view.toEN(map.x0, map.y1);
  const e1 = view.toEN(map.x1, map.y0);
  const parts: string[] = [];
  const fmt = (x: number) => x.toLocaleString('de-DE').replace(/\./g, ' ');
  for (let E = Math.ceil(e0[0] / st) * st; E <= e1[0]; E += st) {
    const x = c.P([E, 0])[0];
    parts.push(line([x, map.y0], [x, map.y0 + 3], { class: 'pen-s' }));
    parts.push(line([x, map.y1], [x, map.y1 - 3], { class: 'pen-s' }));
    parts.push(text([x, map.y0 + 5.6], fmt(E), { size: 1.7, anchor: 'middle', class: 'halo-l' }));
    parts.push(text([x, map.y1 - 4], fmt(E), { size: 1.7, anchor: 'middle', class: 'halo-l' }));
  }
  for (let N = Math.ceil(e0[1] / st) * st; N <= e1[1]; N += st) {
    const y = c.P([0, N])[1];
    parts.push(line([map.x0, y], [map.x0 + 3, y], { class: 'pen-s' }));
    parts.push(line([map.x1, y], [map.x1 - 3, y], { class: 'pen-s' }));
    parts.push(text([map.x0 + 5.2, y], fmt(N), { size: 1.7, anchor: 'middle', rotate: -90, class: 'halo-l' }));
    parts.push(text([map.x1 - 3.8, y], fmt(N), { size: 1.7, anchor: 'middle', rotate: -90, class: 'halo-l' }));
  }
  // crosses at the intersections
  for (let E = Math.ceil(e0[0] / st) * st; E <= e1[0]; E += st) {
    for (let N = Math.ceil(e0[1] / st) * st; N <= e1[1]; N += st) {
      const p = c.P([E, N]);
      if (p[0] < map.x0 + 8 || p[0] > map.x1 - 8 || p[1] < map.y0 + 8 || p[1] > map.y1 - 8) continue;
      parts.push(line([p[0] - 1.5, p[1]], [p[0] + 1.5, p[1]], { class: 'pen-xs' }));
      parts.push(line([p[0], p[1] - 1.5], [p[0], p[1] + 1.5], { class: 'pen-xs' }));
    }
  }
  return g({ class: 'grid' }, ...parts);
}

function mapLegend(sheet: Sheet, c: Ctx): void {
  const items: LegendItem[] = [];
  if (c.r.colour === 'function') {
    for (const k of Object.keys(FUNCTION_FILL) as FunctionGroup[]) items.push({ swatch: sw.fill(FUNCTION_FILL[k], 'pen-s'), label: FUNCTION_DE[k] });
    items.push({ swatch: (x, y) => g({}, rect(x, y, 10, 4, { fill: '#c9604a', class: 'pen-s', style: 'fill-opacity:.55' }), line([x, y], [x + 5, y + 2], { class: 'pen-s' }), line([x + 5, y + 2], [x + 10, y], { class: 'pen-s' })), label: 'Dachaufsicht: First, Grat, Dachknick' });
    items.push({ swatch: sw.line('pen-m axis red'), label: 'Schnittlinie (SC-01 / SC-02)' });
  }
  if (c.r.colour !== 'befund') {
    items.push({ swatch: sw.fill('#eadfc6', 'pen-s'), label: 'Hof (Niveau Katalog)' });
    items.push({ swatch: sw.fill('#f1ebdc', 'pen-s'), label: 'Terrasse / Platz' });
    items.push({ swatch: sw.fill('#cfe3bf', 'pen-xs'), label: 'Parterre, Rondell, Insel' });
    items.push({ swatch: sw.fill('#bcd8ee', 'pen-s blue'), label: 'Teich, Graben, Brunnen' });
    items.push({ swatch: (x, y) => g({}, line([x, y + 1.5], [x + 10, y + 1.5], { class: 'pen-m', style: 'stroke:#6b4a2a' }), ...[1, 3, 5, 7, 9].map((d) => line([x + d, y + 1.5], [x + d, y + 3], { class: 'pen-xs', style: 'stroke:#6b4a2a' }))), label: 'Böschung / Stützmauer (Seite schematisch)' });
    items.push({ swatch: (x, y) => g({}, line([x, y + 2], [x + 10, y + 2], { class: 'pen-xs axis', style: 'stroke:#4c7a3a' }), circle([x + 2.5, y + 2], 0.9, { fill: '#8fbf6f', class: 'pen-xs' }), circle([x + 7.5, y + 2], 0.9, { fill: '#8fbf6f', class: 'pen-xs' })), label: 'Allee mit Baumstellung (Raster N)' });
    if (c.r.contours) {
      items.push({ swatch: sw.line('pen-xs', { style: 'stroke:#a88a6a' }), label: `Höhenlinie ${c.r.contours.every} m (DGM1 heute, geglättet)` });
      items.push({ swatch: sw.line('pen-s', { style: 'stroke:#7a5a3a' }), label: 'Zähllinie 5/10 m mit Höhe' });
    }
    items.push({ swatch: (x, y) => rect(x, y, 10, 4, { fill: 'url(#hatch-u)', class: 'pen-xs' }), label: 'ohne DGM-Unterlage' });
  } else {
    items.push({ swatch: (x, y) => g({}, rect(x, y + 0.6, 10, 2.8, { style: 'fill:#3f8a3a;fill-opacity:.22;stroke:none' }), line([x, y + 2], [x + 10, y + 2], { class: 'pen-xs axis', style: 'stroke:#2f7a2f' }), circle([x + 2.5, y + 2], 1.0, { class: 'pen-xs', style: 'stroke:#2f7a2f' }), circle([x + 7.5, y + 2], 1.0, { class: 'pen-xs', style: 'stroke:#2f7a2f' })), label: 'Allee: Achse und Bäume (Rekonstruktion, Raster N)' });
    items.push({ swatch: sw.line('pen-s', { style: 'stroke:#1f5fa8;stroke-dasharray:2.4 .7 .7 .7' }), label: 'LiDAR-Befund Allee / Weg (Spur)' });
    items.push({ swatch: sw.line('pen-m hid', { style: 'stroke:#1f5fa8' }), label: 'LiDAR-Befund Konfidenz gering' });
  }
  const cols = 1;
  const w = 88;
  const h = legendHeight(items.length, cols);
  const pad = 4;
  const x = c.r.legendCorner.endsWith('l') ? c.map.x0 + pad + 8 : c.map.x1 - pad - w - 34;
  const yB = c.r.legendCorner.startsWith('t') ? c.map.y0 + pad + 8 + h : c.map.y1 - pad - 8;
  sheet.legend(x, yB, w, 'Kartenzeichen', items, cols);
}
