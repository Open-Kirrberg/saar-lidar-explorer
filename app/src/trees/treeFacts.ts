/**
 * 🌳 Baum-Steckbrief — pure side (no three / DOM; plan „Orte im Vergleich“ §4, §8 Phase 0):
 *  - the single-tree allometry of `crown-allometry-v2` (TS twin of pipeline/stats.py `agb_kg` /
 *    `biomass_range_t`; keep both in sync — tests/treesCard.test.ts pins the Python numbers),
 *  - the historic forest mask `sle-forest-hist-v1` (manifest key `forest_hist`): tolerant parse,
 *    point lookup and the German wording (contract „Historic forest mask“, app rule: estimate only),
 *  - point-in-Gemarkung over the `stats/places.geojson` outlines.
 * Estimates are ranges labelled „Schätzung“ (G7); nothing here knows parcels or owners (G3).
 */
import { TREE_STRIDE, treeId } from './treeData';

// ---- crown-allometry-v2 (pipeline/stats.py; conifer = tree-group-v1 group 1) ---------------------------

export const RHO_CONIFER = 0.42;
export const RHO_OTHER = 0.6;
export const BIOMASS_LO = 0.5;
export const BIOMASS_HI = 2.0;
export const CO2_PER_AGB = 1.8;

export type Range3 = [lo: number, mid: number, hi: number];

export interface TreeAllometry {
  /** Trunk diameter estimate D (cm) from height × crown diameter. */
  dbhCm: number;
  /** Above-ground dry biomass (kg): [mid·0.5, mid, mid·2]. */
  agbKg: Range3;
  /** CO₂ equivalent (kg) = 1.8 × biomass. */
  co2Kg: Range3;
}

/**
 * `D = 0.557 · (H · 2r)^0.809` cm; `AGB = 0.0673 · (ρ · D² · H)^0.976` kg with ρ = 0.42 for conifers
 * (base type 1, fill trees included, as in stats.py `T["type"] == 1`), 0.60 else; lo/hi factors 0.5/2.
 */
export function treeAllometry(h: number, r: number, conifer: boolean): TreeAllometry {
  const H = Math.max(0, h);
  const d = 0.557 * (H * 2 * Math.max(0, r)) ** 0.809;
  const rho = conifer ? RHO_CONIFER : RHO_OTHER;
  const mid = 0.0673 * (rho * d * d * H) ** 0.976;
  const agb: Range3 = [mid * BIOMASS_LO, mid, mid * BIOMASS_HI];
  return { dbhCm: d, agbKg: agb, co2Kg: agb.map((v) => v * CO2_PER_AGB) as Range3 };
}

/** Round to `n` significant digits (display only). */
export function roundSig(v: number, n = 2): number {
  if (!Number.isFinite(v) || v === 0) return v;
  const p = 10 ** (n - 1 - Math.floor(Math.log10(Math.abs(v))));
  return Math.round(v * p) / p;
}

const deNum = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 3 });

/** „0,72–2,9 t“ or „21–85 kg“ (below 1 t at the upper bound): lo–hi, 2 significant digits, mid hidden. */
export function fmtMassRange(kg: Range3): string {
  if (kg[2] < 1000) return `${deNum(roundSig(kg[0]))}–${deNum(roundSig(kg[2]))} kg`;
  return `${deNum(roundSig(kg[0] / 1000))}–${deNum(roundSig(kg[2] / 1000))} t`;
}

/** Trunk diameter for the card: whole cm, 2 significant digits above 100 cm. */
export function fmtDbh(cm: number): string {
  return `≈ ${deNum(cm >= 100 ? roundSig(cm, 2) : Math.round(cm))} cm`;
}

// ---- historic forest mask (sle-forest-hist-v1) --------------------------------------------------------

export const FOREST_HIST_FORMAT = 'sle-forest-hist-v1';

export interface ForestEpoch {
  year: number;
  /** null → epoch treated as unknown (contract: no numeric bit/noMapBit). */
  bit: number | null;
  noMapBit: number | null;
  label_de: string;
  map_de: string;
  classified: boolean;
  note_de: string;
}

export interface ManifestForestHist {
  format: typeof FOREST_HIST_FORMAT;
  path: string;
  cellSize: number;
  size: { width: number; height: number };
  nodata: number;
  epochs: ForestEpoch[];
  label_de: string;
  attribution: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const bitNum = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 8 ? v : null);

/**
 * Contract „App tolerance“: missing / non-object / other `format` / non-string `path` / bad
 * `cellSize` or `size` → undefined (logged when present). Unknown epochs and fields are ignored.
 */
export function parseForestHist(v: unknown): ManifestForestHist | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) {
    console.warn('[manifest] forest_hist: not an object, ignored');
    return undefined;
  }
  if (v.format !== FOREST_HIST_FORMAT) {
    console.warn(`[manifest] forest_hist: unsupported format ${String(v.format)}, ignored`);
    return undefined;
  }
  const size = isObj(v.size) ? v.size : null;
  if (typeof v.path !== 'string' || !(typeof v.cellSize === 'number' && v.cellSize > 0) || !size || !posInt(size.width) || !posInt(size.height)) {
    console.warn('[manifest] forest_hist: path / cellSize / size invalid, ignored');
    return undefined;
  }
  const epochs: ForestEpoch[] = [];
  for (const e of Array.isArray(v.epochs) ? v.epochs : []) {
    if (!isObj(e) || typeof e.year !== 'number' || !Number.isFinite(e.year)) continue;
    epochs.push({
      year: e.year,
      bit: bitNum(e.bit),
      noMapBit: bitNum(e.noMapBit),
      label_de: typeof e.label_de === 'string' ? e.label_de : `Wald ${e.year}`,
      map_de: typeof e.map_de === 'string' ? e.map_de : '',
      classified: e.classified === true,
      note_de: typeof e.note_de === 'string' ? e.note_de : '',
    });
  }
  epochs.sort((a, b) => a.year - b.year);
  return {
    format: FOREST_HIST_FORMAT,
    path: v.path,
    cellSize: v.cellSize,
    size: { width: size.width, height: size.height },
    nodata: typeof v.nodata === 'number' ? v.nodata : 255,
    epochs,
    label_de: typeof v.label_de === 'string' ? v.label_de : 'Historischer Wald (Schätzung)',
    attribution: typeof v.attribution === 'string' ? v.attribution : '',
  };
}

/**
 * Pixel index of a point (contract grid: row 0 = north, `px = floor((E − E0)/cs)`,
 * `py = floor((N0 + H − N)/cs)`, H = AOI height in metres), or −1 outside.
 */
export function forestPixel(
  fh: Pick<ManifestForestHist, 'cellSize' | 'size'>,
  aoi: { E0: number; N0: number; heightM: number },
  E: number,
  N: number,
): number {
  const px = Math.floor((E - aoi.E0) / fh.cellSize);
  const py = Math.floor((aoi.N0 + aoi.heightM - N) / fh.cellSize);
  if (!(px >= 0 && px < fh.size.width && py >= 0 && py < fh.size.height)) return -1;
  return py * fh.size.width + px;
}

export type EpochState = 'forest' | 'no-forest' | 'no-map' | 'unknown';

/** State of one epoch for a mask value (never „no forest“ for an unclassified epoch). */
export function epochState(v: number, e: ForestEpoch, nodata = 255): EpochState {
  if (v === nodata || !e.classified || e.bit === null || e.noMapBit === null) return 'unknown';
  if (v & (1 << e.noMapBit)) return 'no-map';
  return v & (1 << e.bit) ? 'forest' : 'no-forest';
}

/** „1935–40“ from „Wald 1935–40“ (fallback: the year). */
export function epochSpan(e: ForestEpoch): string {
  const m = /(\d{4}(?:\s*[–-]\s*\d{2,4})?)/.exec(e.label_de);
  return m ? m[1].replace(/\s+/g, '') : String(e.year);
}

export interface ForestSummary {
  /** Headline for the card, e.g. „laut Karte 1935–40 wahrscheinlich Wald“ (+ „Schätzung“ chip). */
  headline: string;
  /** True when the headline states forest (shown with the „Schätzung“ chip). */
  forest: boolean;
  /** One line per epoch, oldest first. */
  lines: string[];
  /** Map names of the classified epochs that were read (for „Quelle“). */
  maps: string[];
}

/**
 * Wording of the contract's app rule: an estimate from map symbols, never a fact. One map snapshot
 * says nothing about „since when“, so „seit“ appears only when at least two classified epochs with
 * a map here agree on forest. Headline cases (oldest → newest classified epochs readable here):
 *  - newest readable epoch without forest → „<span>: auf der Karte kein Wald erkannt“
 *  - only the newest one shows forest → „laut Karte <span> wahrscheinlich Wald“
 *    (+ „(<older>: kein Wald erkannt)“ when an older classified epoch shows none)
 *  - ≥ 2 readable epochs in a row show forest → „laut Karten seit mindestens <oldest> wahrscheinlich Wald“
 *    (or „laut Karten seit <span> … (<older>: kein Wald erkannt)“)
 * Unclassified epochs (1840 today) and epochs without a map here never count.
 * null for no data (outside the mask, 255); „nicht auswertbar“ when no epoch can be read here.
 */
export function forestSummary(v: number | null, fh: Pick<ManifestForestHist, 'epochs' | 'nodata'>): ForestSummary | null {
  if (v === null || v === fh.nodata) return null;
  const st = fh.epochs.map((e) => ({ e, s: epochState(v, e, fh.nodata) }));
  const lines = st.map(({ e, s }) => {
    const span = epochSpan(e);
    if (s === 'forest') return `${span}: laut Karte wahrscheinlich Wald`;
    if (s === 'no-forest') return `${span}: auf der Karte kein Wald erkannt`;
    if (s === 'no-map') return `${span}: keine Karte an dieser Stelle`;
    return `${span}: nicht auswertbar`; // why (e.g. no forest signature on the map): `note_de`, shown as a hint
  });
  const known = st.filter((x) => x.s === 'forest' || x.s === 'no-forest');
  if (!known.length) return { headline: 'Historische Karten hier nicht auswertbar', forest: false, lines, maps: [] };
  const maps = known.map((x) => x.e.map_de).filter(Boolean);
  const newest = known[known.length - 1];
  if (newest.s === 'no-forest') {
    return { headline: `${epochSpan(newest.e)}: auf der Karte kein Wald erkannt`, forest: false, lines, maps };
  }
  // Longest run of forest ending at the newest readable epoch.
  let k = known.length - 1;
  while (k > 0 && known[k - 1].s === 'forest') k--;
  const since = epochSpan(known[k].e);
  const before = k > 0 ? ` (${epochSpan(known[k - 1].e)}: kein Wald erkannt)` : '';
  if (k === known.length - 1) return { headline: `laut Karte ${since} wahrscheinlich Wald${before}`, forest: true, lines, maps };
  const headline = k === 0 ? `laut Karten seit mindestens ${since} wahrscheinlich Wald` : `laut Karten seit ${since} wahrscheinlich Wald${before}`;
  return { headline, forest: true, lines, maps };
}

/** True when the decoded mask holds only contract values (0–15 and nodata). */
export function validForestValues(values: ArrayLike<number>, nodata = 255): boolean {
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v > 15 && v !== nodata) return false;
  }
  return true;
}

// ---- point in Gemarkung ---------------------------------------------------------------------------------

/** Even-odd test over all rings (outer rings and holes alike), EPSG:25832. */
export function pointInRings(rings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, E: number, N: number): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > N !== yj > N && E < ((xj - xi) * (N - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Id of the first place whose outline contains (E, N), or null. */
export function placeIdAt(
  outlines: ReadonlyMap<string, ReadonlyArray<ReadonlyArray<readonly [number, number]>>>,
  E: number,
  N: number,
): string | null {
  for (const [id, rings] of outlines) if (pointInRings(rings, E, N)) return id;
  return null;
}

/** What the card shows about one tree (all from the instance row + derived ids). */
export interface PickedTree {
  id: number;
  E: number;
  N: number;
  /** True ground (m, DHHN2016). */
  ground: number;
  h: number;
  r: number;
  kind: number;
  fill: boolean;
}

/** Row (stride 8: x, g, z, h, r, rank, seed, kind+4·fill) → tree facts in EPSG:25832. */
export function treeFromRow(rows: ArrayLike<number>, index: number, origin: { E0: number; N0: number }): PickedTree {
  const o = index * TREE_STRIDE;
  const E = rows[o] + origin.E0;
  const N = origin.N0 - rows[o + 2];
  const k = Math.round(rows[o + 7]);
  return { id: treeId(E, N), E, N, ground: rows[o + 1], h: rows[o + 3], r: rows[o + 4], kind: k & 3, fill: k >= 4 };
}

// ---- tree type wording ------------------------------------------------------------------------------------

/** Card title per base type (contract `types`): 0 Baum, 1 Nadelbaum, 2 Laubbaum. */
export function treeTypeLabel(kind: number): string {
  return kind === 1 ? 'Nadelbaum' : kind === 2 ? 'Laubbaum' : 'Baum';
}
