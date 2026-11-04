/** Evidence styling shared by all sheets: confidence colours, tag display, function groups. */
import type { Building, Confidence, EvidenceTag, Placement } from '../../model/src/spec.ts';
import { parseEvidenceTags } from '../../model/src/spec.ts';
import { type LegendItem } from './sheet.ts';
import { line, rect } from './svg.ts';

export const CONF_FILL: Record<Confidence, string> = { high: '#9e2f1c', med: '#e07b50', low: '#f6cdb3' };
export const CONF_DE: Record<Confidence, string> = { high: 'hoch', med: 'mittel', low: 'gering' };

export const PLACEMENT_DE: Record<Placement, string> = {
  lidar: 'LiDAR-Befund',
  'lidar+hms': 'LiDAR-Befund + HMS-Massen',
  'map+lidar': 'Lageplan 2006 + LiDAR',
  map: 'nur Lageplan 2006 (LP06)',
  existing: 'bestehend',
  relative: 'relativ erschlossen',
  hypothetical: 'hypothetisch',
  unplaced: 'nicht verortet',
};

/** Outline style by placement: lidar-based solid, map-only dashed, relative/hypothetical dotted. */
export function placementClass(p: Placement): string {
  if (p === 'map') return 'hid';
  if (p === 'relative' || p === 'hypothetical') return 'hyp';
  return '';
}

export const TAG_DE: Record<EvidenceTag, string> = {
  D: 'D belegt (Quelle)',
  'D->': 'D→ aus Belegtem abgeleitet',
  I: 'I erschlossen',
  N: 'N Epochennorm (Vergleichsbauten)',
  U: 'U unbekannt',
  HMS: 'HMS Sekundärquelle (HMS/Matzerath 2022, nur Deutung)',
};

/** Compact tag string for labels: "D·I". */
export function tagShort(note: string | undefined): string {
  const t = parseEvidenceTags(note);
  return t.map((x) => (x === 'D->' ? 'D→' : x)).join('·');
}

export type FunctionGroup = 'residenz' | 'wirtschaft' | 'marstall' | 'garten' | 'landwirtschaft' | 'pavillon' | 'mauer';
export const FUNCTION_FILL: Record<FunctionGroup, string> = {
  residenz: '#c9604a',
  wirtschaft: '#d9a35f',
  marstall: '#8d7a5b',
  garten: '#7fa36b',
  landwirtschaft: '#b9a98a',
  pavillon: '#a77fb0',
  mauer: '#777777',
};
export const FUNCTION_DE: Record<FunctionGroup, string> = {
  residenz: 'Schloss / Wohnbauten des Hofes',
  wirtschaft: 'Küche, Hofdienst, Wachen',
  marstall: 'Marstall, Militär, Remisen',
  garten: 'Orangerie, Gärtnereien, Treibhäuser',
  landwirtschaft: 'Landwirtschaft, Dorf, Schäferei',
  pavillon: 'Pavillons, Gartenbauten',
  mauer: 'Mauern, Gitter, Zwinger',
};

export function functionGroup(b: Building): FunctionGroup {
  const id = b.id;
  const n = b.name_de.toLowerCase();
  if (b.cls === 'WALL') return 'mauer';
  if (['KB-B01', 'KB-B02', 'KB-B03', 'KB-B04', 'KB-B06', 'KB-B49'].includes(id)) return 'residenz';
  if (/küche|wach|cavalier|brauerei|lazarett|waffenschmied|taubenhaus/.test(n)) return 'wirtschaft';
  if (/marstall|reit|kaserne|jäger|remise|torfschuppen|chevau|zwingerhaus/.test(n)) return 'marstall';
  if (/orangerie|gärtnerei|treibhaus|rotunde|fasanerie|eiskeller/.test(n) || b.cls === 'ORANG') return 'garten';
  if (b.cls === 'PAV' || b.cls === 'GARD') return /zwinger|menagerie|amphitheater/.test(n) ? 'mauer' : 'pavillon';
  return 'landwirtschaft';
}

export const sw = {
  fill:
    (fill: string, cls = 'pen-s', extra: Record<string, string> = {}) =>
    (x: number, y: number) =>
      rect(x, y, 10, 4, { fill, class: cls, ...extra }),
  line:
    (cls: string, extra: Record<string, string> = {}) =>
    (x: number, y: number) =>
      line([x, y + 2], [x + 10, y + 2], { class: cls, ...extra }),
};

export function confidenceLegend(): LegendItem[] {
  return [
    { swatch: sw.fill(CONF_FILL.high), label: 'Konfidenz hoch: Lage und Form belegt' },
    { swatch: sw.fill(CONF_FILL.med), label: 'Konfidenz mittel: Lage belegt, Form aus Vergleich/HMS' },
    { swatch: sw.fill(CONF_FILL.low), label: 'Konfidenz gering: Hypothese' },
    { swatch: sw.fill('none', 'pen-m'), label: 'Umriss durchgezogen: verortet nach LiDAR-Befund' },
    { swatch: sw.fill('none', 'pen-m hid'), label: 'Umriss gestrichelt: nur nach Lageplan 2006 (LP06)' },
    { swatch: sw.fill('none', 'pen-m hyp'), label: 'Umriss punktiert: relativ erschlossen / hypothetisch' },
  ];
}

export function evidenceNote(): string[] {
  return [
    'Belegkürzel: D belegt (Periodenquelle) · D→ aus Belegtem abgeleitet · I erschlossen · N Epochennorm (Vergleichsbauten, research/02) · U unbekannt · HMS Sekundärquelle (Rekonstruktion Matzerath/Historisches Museum Saar 2022; nur als Deutung, ©).',
    'Rangfolge bei Widersprüchen: Periodenquellen > Lageplan 2006 > LiDAR-Lage > HMS-Höhen/-Massen > Vergleichsbauten/Normen (Katalog v2, conflict_rule).',
    'Das Modell ist eine Hypothese, kein Aufmaß. Jedes Bauteil trägt Konfidenz und Quellen im Katalog (model/catalogue.json).',
  ];
}

export function sourcesNote(extra: string[] = []): string[] {
  return [
    'Quellen: research/01–08 (Teilprojekt Schloss Karlsberg); Le Clerc 1790 „Vue du Château de Carlsberg“ (gemeinfrei); von Lüder 1791 „Pleine vue du Carlsberg“ (gemeinfrei); Porzellanteller „Le Château de Carlsberg“ (gemeinfrei); Karte der Ruinen 1805 (gemeinfrei).',
    'Grundrisse z. T. nach „Karlsberg_Lageplan.gif“ (Lageplan 2006, „Mannlich“, schloss-carlsberg.de), CC BY-SA 2.0 DE, georeferenziert und bearbeitet – abgeleitete Pläne unter gleicher Lizenz (CC BY-SA 2.0 DE).',
    'Gelände: DGM1 © GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0, Daten bearbeitet (Schummerung, Höhenlinien, Profile).',
    'HMS-Maße (research/08) nur als Zahlen übernommen; keine Bilder/Texturen der HMS-Rekonstruktion (© Matzerath/Historisches Museum Saar).',
    ...extra,
  ];
}
