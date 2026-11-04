/**
 * ADR 0026 „© Quellen“: source rows for the info dialog and short lines for the load splash, built
 * from `manifest.attribution` (pipeline constants, verbatim) plus app constants; and the pure
 * collapse timer (8 s, „×“ earlier, map interaction collapses only after the first 5 s).
 */

export interface Link {
  label: string;
  url: string;
}

export interface SourceRow {
  /** Stable key (dedupe, tests). */
  id: string;
  provider: string;
  /** Splash line (column *Kurz*). Empty = not in the splash (software, castle-only rows). */
  short: string;
  /** Full Quellenvermerk, verbatim from the manifest where it comes from there. */
  full: string;
  licence: Link | null;
  dataset: Link | null;
  /** „Daten bearbeitet“ (dl-de/by-2-0 §3). */
  modified: boolean;
  /** What the app uses it for (German). */
  use: string;
}

export const DL_DE_BY_2: Link = { label: 'Datenlizenz Deutschland – Namensnennung – Version 2.0', url: 'https://www.govdata.de/dl-de/by-2-0' };
const ODBL: Link = { label: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' };

const LVGL_PROVIDER = 'Landesamt für Vermessung, Geoinformation und Landentwicklung Saarland (LVGL)';
const RLP_PROVIDER = 'Landesamt für Vermessung und Geobasisinformation Rheinland-Pfalz (LVermGeoRP)';
const LVGL_SHOP: Link = { label: 'shop.lvgl.saarland.de – Freie Geobasisdaten', url: 'https://www.shop.lvgl.saarland.de/cloud/freiegeobasisdaten' };
const LVGL_ALKIS: Link = {
  label: 'geoportal.saarland.de – ALKIS WFS 414 / INSPIRE CP',
  url: 'https://geoportal.saarland.de/mapbender/php/mod_showMetadata.php?languageCode=de&resource=wfs&id=414',
};
const LVGL_HIST: Link = {
  label: 'geoportal.saarland.de – Historische Karten (WMS 2597)',
  url: 'https://geoportal.saarland.de/mapbender/php/mod_showMetadata.php?languageCode=de&resource=wms&id=2597',
};
const RLP_DATA: Link = { label: 'geobasis-rlp.de/data', url: 'https://geobasis-rlp.de/data/' };

/** Layer tag in a pipeline string („… (LoD2)“) → what it is used for. */
const LAYER_USE: Record<string, string> = {
  '': 'Geländemodell (DGM/DOM aus ALS 2025): Relief, Höhen, Wald',
  ALKIS: 'Flurstücke (ALKIS)',
  LoD2: 'Gebäude in 3D (LoD2)',
  DOP20: 'Luftbild (DOP20)',
  'Historische Karten': 'Historische Karten (Zeitreise)',
};

/** Splits the manifest string („a; b; c“) into its entries (trimmed, empty dropped). */
export function splitAttribution(s: string | undefined | null): string[] {
  return (s ?? '')
    .split(/;\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const layerTag = (entry: string): string => /\(([^()]+)\)\s*$/.exec(entry)?.[1] ?? '';

/** One manifest entry → a dialog row (unknown providers stay verbatim, so new sources still show). */
export function rowFromEntry(entry: string): SourceRow {
  const modified = /Daten bearbeitet/i.test(entry);
  const dl = /dl-de\/by-2-0/i.test(entry);
  const tag = layerTag(entry);
  if (/GeoBasis-DE\s*\/\s*LVGL-SL/i.test(entry)) {
    const short = /©\s*GeoBasis-DE\s*\/\s*LVGL-SL(\s*\(\d{4}\))?/i.exec(entry)?.[0].replace(/\s+/g, ' ') ?? '© GeoBasis-DE/LVGL-SL';
    const dataset = tag === 'ALKIS' ? LVGL_ALKIS : tag === 'Historische Karten' ? LVGL_HIST : LVGL_SHOP;
    return { id: `lvgl:${tag || 'dgm'}`, provider: LVGL_PROVIDER, short, full: entry, licence: DL_DE_BY_2, dataset, modified, use: LAYER_USE[tag] ?? tag };
  }
  if (/GeoBasis-DE\s*\/\s*LVermGeoRP/i.test(entry)) {
    return {
      id: `rlp:${tag || 'dgm'}`,
      provider: RLP_PROVIDER,
      short: '© GeoBasis-DE/LVermGeoRP',
      full: entry,
      licence: DL_DE_BY_2,
      dataset: RLP_DATA,
      modified,
      use: `${LAYER_USE[tag] ?? tag} – Rheinland-Pfalz`,
    };
  }
  if (/OpenStreetMap/i.test(entry)) {
    return {
      id: 'osm:data',
      provider: 'OpenStreetMap-Mitwirkende',
      short: '© OpenStreetMap',
      full: entry,
      licence: ODBL,
      dataset: { label: 'openstreetmap.org', url: 'https://www.openstreetmap.org' },
      modified: false,
      use: 'Wege in 3D, Orte',
    };
  }
  return {
    id: `other:${entry}`,
    provider: entry.replace(/^©\s*/, '').split(',')[0].trim(),
    short: entry.split(',')[0].trim(),
    full: entry,
    licence: dl ? DL_DE_BY_2 : null,
    dataset: null,
    modified,
    use: tag,
  };
}

/** Rows the app adds itself (not in the manifest): minimap tiles, POI sources, live lookups, software. */
export const APP_ROWS: readonly SourceRow[] = [
  {
    id: 'osm:tiles',
    provider: 'OpenStreetMap-Mitwirkende',
    short: '© OpenStreetMap',
    full: '© OpenStreetMap-Mitwirkende, ODbL. Kacheln: OpenStreetMap, CC BY-SA 2.0',
    licence: ODBL,
    dataset: { label: 'openstreetmap.org', url: 'https://www.openstreetmap.org' },
    modified: false,
    use: 'Karte (Minikarte)',
  },
  {
    id: 'pois',
    provider: 'OpenStreetMap-Mitwirkende, Wikipedia',
    short: '',
    full: 'Orte: OpenStreetMap (ODbL), Wikipedia (CC BY-SA 4.0); Lagen teils ungenau',
    licence: { label: 'CC BY-SA 4.0 (Wikipedia-Texte)', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    dataset: { label: 'de.wikipedia.org', url: 'https://de.wikipedia.org' },
    modified: true,
    use: 'Bekannte Orte (Namen, Kurztexte)',
  },
  {
    id: 'software',
    provider: 'Leaflet, three.js',
    short: '',
    full: 'Leaflet (BSD-2-Clause), three.js (MIT)',
    licence: null,
    dataset: { label: 'github.com/mrdoob/three.js', url: 'https://github.com/mrdoob/three.js' },
    modified: false,
    use: 'Software',
  },
];

/** Dialog rows: manifest entries first (verbatim), then app rows; duplicates by id dropped. */
export function sourceRows(manifestAttribution: string | undefined | null, extra: readonly SourceRow[] = APP_ROWS): SourceRow[] {
  const seen = new Set<string>();
  const out: SourceRow[] = [];
  for (const r of [...splitAttribution(manifestAttribution).map(rowFromEntry), ...extra]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** Splash: unique short lines in order (ADR 0026 rule 1). */
export function splashLines(rows: readonly SourceRow[]): string[] {
  return [...new Set(rows.map((r) => r.short).filter(Boolean))];
}

// ---- collapse timer -------------------------------------------------------------------------

export const SPLASH_MS = 8000;
/** Map/flight interaction does not collapse the splash during this guard (ADR 0026 rule 2). */
export const SPLASH_GUARD_MS = 5000;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface CollapseTimer {
  readonly collapsed: boolean;
  /** „×“: collapse now. */
  dismiss(): void;
  /** Map / flight interaction: collapses only after the guard. Returns whether it collapsed. */
  interact(): boolean;
  /** Cancel the timer (no collapse callback). */
  dispose(): void;
}

export function createCollapseTimer(
  onCollapse: () => void,
  clock: Clock,
  opts: { showMs?: number; guardMs?: number } = {},
): CollapseTimer {
  const showMs = opts.showMs ?? SPLASH_MS;
  const guardMs = opts.guardMs ?? SPLASH_GUARD_MS;
  const t0 = clock.now();
  let collapsed = false;
  const collapse = () => {
    if (collapsed) return;
    collapsed = true;
    clock.clearTimeout(id);
    onCollapse();
  };
  const id = clock.setTimeout(collapse, showMs);
  return {
    get collapsed() {
      return collapsed;
    },
    dismiss: collapse,
    interact() {
      if (collapsed) return true;
      if (clock.now() - t0 < guardMs) return false;
      collapse();
      return true;
    },
    dispose() {
      clock.clearTimeout(id);
    },
  };
}
