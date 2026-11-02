/**
 * Ansichten 1:200: orthographic elevations of building groups seen square to one facade of a
 * main building, with storey lines, heights (relative ±0,00 and m ü. NHN), roof profiles,
 * window axes and the 1789 vs. today ground line.
 */
import { wallFreeSpans } from '../../../model/src/layout/walls.ts';
import type { BuildingLayout } from '../../../model/src/layout/building.ts';
import { sidePoint, stToEN } from '../../../model/src/layout/footprint.ts';
import { raisedRoofs } from '../../../model/src/layout/raised.ts';
import type { Building, SideName, SiteSpec } from '../../../model/src/spec.ts';
import { CONF_DE, evidenceNote, sourcesNote, sw, tagShort } from '../evidence.ts';
import { dimChain, drawDimChain } from '../geom/dims.ts';
import { elevView } from '../geom/transform.ts';
import { type LegendItem, MARGIN, SHEET_MM, Sheet, type SheetSize, TITLE_H } from '../sheet.ts';
import { type P2, de, g, line, path, text } from '../svg.ts';
import { DTM_ATTRIBUTION, loadDtm } from '../terrain.ts';
import { datumOf, shortStorey } from './common.ts';
import { type HeightMark, alongRange, drawElevation, drawGround, ground1789, heightColumn, topOf } from './elevation.ts';

const SCALE = 200;

export interface AnsichtReq {
  sheetNo: string;
  slug: string;
  title: string;
  subtitle: string;
  buildings: string[];
  main: string;
  side: SideName;
  /** Ground profile: metres in front of the main facade. */
  groundOffset: number;
}

export function ansichtRequests(): AnsichtReq[] {
  return [
    { sheetNo: 'AN-01', slug: 'Ansicht_Hofseite_W', title: 'Ansicht Hofseite (Ehrenhof, von Westen)', subtitle: 'Corps de logis mit Kopfbauten von Süd- und Nordflügel', buildings: ['KB-B01', 'KB-B02', 'KB-B03'], main: 'KB-B01', side: 'court', groundOffset: 20 },
    { sheetNo: 'AN-02', slug: 'Ansicht_Gartenseite_O', title: 'Ansicht Gartenseite (von Osten)', subtitle: 'Corps de logis zwischen den Ostenden von Süd- und Nordflügel', buildings: ['KB-B01', 'KB-B02', 'KB-B03'], main: 'KB-B01', side: 'garden', groundOffset: 3 },
    { sheetNo: 'AN-03', slug: 'Ansicht_Suedfront', title: 'Ansicht Südfront (von Süden)', subtitle: 'Südflügel – Flügel der Herzogin, dahinter Corps de logis', buildings: ['KB-B02', 'KB-B01'], main: 'KB-B02', side: 'garden', groundOffset: 4 },
    { sheetNo: 'AN-04', slug: 'Ansicht_Orangerie_W', title: 'Ansicht Orangerie (Talseite, von Westen)', subtitle: 'Orangerie-Hauptflügel mit hohem Kellergeschoss, Stützmauer, Seitenflügel und Rotunde', buildings: ['KB-B10', 'KB-B11', 'KB-B12', 'KB-B13', 'KB-B14'], main: 'KB-B10', side: 'garden', groundOffset: 3 },
  ];
}

export function ansichtSheet(spec: SiteSpec, layoutOf: (b: Building) => BuildingLayout, r: AnsichtReq): Sheet {
  const bs = r.buildings.map((id) => spec.buildings.find((b) => b.id === id)!).filter(Boolean);
  const Ls = bs.map(layoutOf);
  const M = layoutOf(spec.buildings.find((b) => b.id === r.main)!);
  const sd = M.frame.sides[r.side];
  const lookAz = (sd.normalAzimuth + 180) % 360;
  const dtm = loadDtm();
  const g89 = ground1789(spec, dtm);
  const datum = datumOf(spec, layoutOf, M.building);

  // extents
  const probe = elevView(SCALE, M.frame.centreEN, lookAz, 0, [0, 0]);
  const xs = Ls.flatMap((L) => alongRange(L, probe));
  const x0 = Math.min(...xs) - 4;
  const x1 = Math.max(...xs) + 4;
  const mid = sidePoint(M.frame, r.side, sd.length / 2, -r.groundOffset);
  const gOrigin = stToEN(M.frame, mid);
  const gx0 = x0 - probe.along(gOrigin[0], gOrigin[1]);
  const gx1 = x1 - probe.along(gOrigin[0], gOrigin[1]);
  const groundHs: number[] = [];
  for (let x = gx0; x <= gx1; x += 1) {
    const E = gOrigin[0] + probe.right[0] * x;
    const N = gOrigin[1] + probe.right[1] * x;
    const a = g89(E, N).h;
    const b = dtm ? dtm.at(E, N) : NaN;
    if (Number.isFinite(a)) groundHs.push(a);
    if (Number.isFinite(b)) groundHs.push(b);
  }
  const hMin = Math.min(...groundHs, ...Ls.map((L) => L.stack.base_h)) - 2.5;
  const hMax = Math.max(...Ls.map(topOf)) + 2;
  const k = 1000 / SCALE;
  const colW = 62;
  const need: [number, number] = [(x1 - x0) * k + colW + 10, (hMax - hMin) * k + 34];
  const size = pickSize(need);
  const sheet = new Sheet(size, `${r.sheetNo} ${r.title}`);
  const [W] = SHEET_MM[size];
  const top = MARGIN.top + 14;
  const avail = sheet.bandTop - top;
  const drawW = (x1 - x0) * k + colW;
  const left = MARGIN.left + (W - MARGIN.left - MARGIN.right - drawW) / 2;
  const baseY = top + Math.min(avail - 22, (hMax - hMin) * k + (avail - 22 - (hMax - hMin) * k) / 2);
  const v = elevView(SCALE, M.frame.centreEN, lookAz, hMin, [left - x0 * k, baseY]);
  const bottomY = v.at(0, hMin)[1];

  const parts: string[] = [];
  parts.push(drawElevation(Ls, v));
  const ground = drawGround(v, g89, dtm, { origin: gOrigin, dir: v.right, x0: gx0, x1: gx1, bottomY: bottomY + 40 });
  parts.push(ground.svg);

  // storey lines of the main building across to the height column
  const xRight = left + (x1 - x0) * k;
  const marks: HeightMark[] = [];
  const plinth = M.stack.levels.find((l) => l.kind === 'plinth');
  marks.push({ h: M.stack.base_h, label: plinth ? 'Hof / Sockelfuß' : 'Gelände' });
  for (const lv of M.stack.levels) if (lv.kind !== 'plinth') marks.push({ h: lv.floor_h, label: `FFB ${shortStorey(lv.name)}` });
  marks.push({ h: M.stack.eaves_h, label: 'Traufe (Hauptgesims)' });
  if (M.roof.break_h) marks.push({ h: M.roof.break_h, label: 'Dachknick' });
  marks.push({ h: M.roof.ridge_h, label: M.roof.deck_width > 0 ? 'Dachplattform' : 'First' });
  for (const rr of raisedRoofs(M)) {
    marks.push({ h: rr.section.ridge_h, label: 'First Mittelpavillon' });
    if (rr.turret) marks.push({ h: rr.turret.top_h, label: 'Laterne (Spitze U)' });
  }
  const merged: HeightMark[] = [];
  for (const m of [...marks].sort((a, b) => a.h - b.h)) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.h - m.h) < 0.03) last.label += ` / ${m.label}`;
    else merged.push({ ...m });
  }
  parts.push(heightColumn(v, merged, datum.h, xRight - 2, xRight + 4));

  // axes of the main side below the ground
  const lay = M.sides[r.side];
  const axY = bottomY + 4.5;
  lay.bays.forEach((b, i) => {
    const q = stToEN(M.frame, sidePoint(M.frame, r.side, b.a, 0));
    const x = v.toPaper(q[0], q[1], 0)[0];
    parts.push(line([x, axY - 3.2], [x, axY - 2], { class: 'pen-xs' }));
    parts.push(text([x, axY], String(i + 1), { size: 1.7, anchor: 'middle' }));
  });
  // overall width of the main facade
  const pA = stToEN(M.frame, sd.p0);
  const pB = stToEN(M.frame, sd.p1);
  const xa = v.toPaper(pA[0], pA[1], 0)[0];
  const xb = v.toPaper(pB[0], pB[1], 0)[0];
  const pos = [0, ...lay.bays.map((b) => b.a), sd.length].map((a) => a * (xb > xa ? 1 : -1));
  parts.push(drawDimChain(dimChain(pos.map((p) => p), k), { origin: [xa, axY + 4], dir: [1, 0], out: [0, 1], k, ext: 1.5 }));
  parts.push(drawDimChain(dimChain([0, sd.length * (xb > xa ? 1 : -1)], k), { origin: [xa, axY + 10], dir: [1, 0], out: [0, 1], k, ext: 1.5 }));
  // building names
  for (const L of Ls) {
    const [a0, a1] = alongRange(L, v);
    const x = v.at((a0 + a1) / 2, 0)[0];
    // roofless structures (walls) are labelled on their face, the others above their top
    const y = L.roof.type === 'none' ? v.at(0, (L.stack.base_h + L.stack.eaves_h) / 2)[1] + 0.8 : v.at(0, topOf(L))[1] - 2.5;
    // a wall line that coincides with a building face is drawn as that building's front (review-1 #1)
    const line0 = L.building.cls === 'WALL' ? L.building.line : undefined;
    const asFront = line0 && line0.length >= 2 && wallFreeSpans(line0, Ls.filter((o) => o !== L && o.building.cls !== 'WALL').map((o) => o.ring)).length === 0;
    parts.push(text([x, y], asFront ? `${shortName(L.building)} (${L.id}) = Kellerfront` : `${shortName(L.building)} (${L.id})`, { size: 2.0, anchor: 'middle', class: 'halo' }));
  }
  parts.push(text([left, bottomY - 1.2], `Achsen ${r.side === 'court' ? 'Hofseite' : r.side === 'garden' ? 'Gartenseite' : 'Stirnseite'} ${M.id}: 1–${lay.bays.length} (von außen links → rechts)`, { size: 1.5, class: 'muted halo' }));

  sheet.add(g({ id: 'elevation' }, ...parts));
  sheet.frame();
  sheet.add(text([MARGIN.left + 6, MARGIN.top + 8], `${r.title} · Blickrichtung ${de(lookAz, 1)}° (Gitter)`, { size: 3.0, class: 'b' }));
  const roofTag = tagShort(M.roofSpec.tags) || 'U';
  sheet.band({
    title: {
      sheetNo: r.sheetNo,
      title: r.title,
      subtitle: r.subtitle,
      scale: '1:200',
      info: [
        Ls.map((L) => `${L.id} ${CONF_DE[L.building.confidence]}`).join(' · ') + ' (Konfidenz)',
        `Dach ${M.id}: ${roofDe(M)} [${roofTag}]`,
        `Fenster/Türen: Achsen und Portale aus Katalog v2, Größen nach Epochennorm (N)`,
      ],
    },
    info: [`±0,00 = ${de(datum.h)} m ü. NHN`, `(${datum.label})`, 'Höhen in m ü. NHN (DHHN2016)', 'Gelände 1789: Hof-/Terrassenniveaus', 'des Katalogs, sonst DGM heute'],
    scale: SCALE,
    legend: elevLegend(),
    notes: [evidenceNote()[0], 'Ansicht ohne Perspektive; Rücksprünge, Gesimse und Fensterteilungen schematisch (N). Schornsteine nicht dargestellt (Lage U).', `Gelände heute: ${DTM_ATTRIBUTION}.`, sourcesNote()[3]],
  });
  return sheet;
}

export function roofDe(L: BuildingLayout): string {
  const r = L.roof;
  const names: Record<string, string> = { mansard: 'Mansarddach', hip: 'Walmdach', gable: 'Satteldach', pavilion: 'Zeltdach', dome: 'Kuppel', cone: 'Kegeldach', flat: 'Flachdach', none: 'ohne Dach', mound: 'Erdhügel' };
  const cover: Record<string, string> = { slate: 'Schiefer', tile: 'Ziegel', lead: 'Blei', copper: 'Kupfer' };
  const p = r.type === 'mansard' ? `${de(r.pitch_lower, 0)}°/${de(r.pitch_upper, 0)}°` : r.type === 'hip' || r.type === 'gable' || r.type === 'pavilion' ? `${de(r.pitch_lower, 0)}°` : '';
  return `${names[r.type] ?? r.type} ${p}${L.roofSpec.cover && cover[L.roofSpec.cover] ? ', ' + cover[L.roofSpec.cover] : ''}, First ${de(r.ridge_h)}`;
}

export function shortName(b: Building): string {
  return b.name_de.replace(/\s*\(.*?\)\s*/g, ' ').split('–')[0].trim();
}

function pickSize(need: [number, number]): SheetSize {
  for (const s of ['A3', 'A2'] as SheetSize[]) {
    const [W, H] = SHEET_MM[s];
    if (need[0] <= W - MARGIN.left - MARGIN.right && need[1] <= H - MARGIN.top - MARGIN.bottom - TITLE_H - 16) return s;
  }
  return 'A2';
}

export function elevLegend(): LegendItem[] {
  return [
    { swatch: sw.fill('#fff', 'pen-l'), label: 'Wandfläche (Putz hell, D)' },
    { swatch: sw.fill('#f2e6e0', 'pen-s'), label: 'Sockel (roter Buntsandstein, D→)' },
    { swatch: sw.fill('#dde0e4', 'pen-m'), label: 'Dachfläche Schiefer (D→ PV 1791)' },
    { swatch: sw.fill('#f1dccf', 'pen-m'), label: 'Dachfläche Ziegel (Nutzbauten)' },
    { swatch: sw.fill('#eef1f4', 'pen-m'), label: 'Fenster / Gaube / Okulus (Größe N)' },
    { swatch: (x: number, y: number) => g({}, path([[x, y + 2], [x + 10, y + 2], [x + 10, y + 4], [x, y + 4]], true, { fill: 'url(#hatch-earth)', stroke: 'none' }), line([x, y + 2], [x + 10, y + 2], { class: 'pen-l' })), label: 'Gelände 1789 (Hypothese)' },
    { swatch: sw.line('pen-s red hid'), label: 'Gelände heute (DGM1 2025)' },
    { swatch: (x: number, y: number) => path([[x + 5, y + 3.5], [x + 3.9, y + 1.9], [x + 6.1, y + 1.9]], true, { fill: '#fff', class: 'pen-xs' }), label: 'Höhenkote relativ / m ü. NHN' },
  ];
}

export type { P2 };
