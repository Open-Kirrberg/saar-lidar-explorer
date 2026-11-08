/**
 * 🌲 Baumart und Alter (Schätzung) — pure side of the Baum-Steckbrief's Phase 1 rows (no three / DOM):
 *  - the manifest key `species` (`sle-species-v1`, DLR Tree Species Germany 2022): tolerant parse,
 *  - the per-tree probability `species-dlr-neighbourhood-v1` (TS twin of pipeline/species.py
 *    `tree_species` / `probability_pct`; integer arithmetic, identical results — tests/treesSpecies.test.ts
 *    pins the contract's test vectors and three points computed with the pipeline code),
 *  - the tree group `tree-group-v1` (species beats the DOP colour type; twin of species.py `tree_group`),
 *  - the height-based age `tree-age-height-v2` (twin of pipeline/forest_age.py `tree_age`, including
 *    Python's round-half-to-even in the 5-year rounding; a tree taller than the class-II table end gets
 *    no age, `beyond`).
 * Binding text: docs/data-contract.md „Tree species“ and „Tree age estimate“. Everything here is an
 * estimate (G7): the card labels it „Schätzung“ and shows the probability / range, never a fact.
 */

export const SPECIES_FORMAT = 'sle-species-v1';

export interface SpeciesClass {
  code: number;
  key: string;
  label_de: string;
  group: 'conifer' | 'broadleaf' | 'none';
  /** false for canopy loss: no species, no probability. */
  species: boolean;
  /** Class F1 in (0, 1]; present iff `species`. */
  f1: number | null;
}

export interface SpeciesProbability {
  contradictionDivisor: number;
  minPct: number;
  maxPct: number;
  likelyPct: number;
}

export interface ManifestSpecies {
  format: typeof SPECIES_FORMAT;
  path: string;
  cellSize: number;
  size: { width: number; height: number };
  nodata: number;
  year: number | null;
  /** Usable classes by pixel value (a class with `species: true` but no valid f1 is skipped). */
  classes: Map<number, SpeciesClass>;
  probability: SpeciesProbability;
  label_de: string;
  attribution: string;
  accuracyNote: string;
}

/** Contract defaults when the `probability` block is missing. */
export const SPECIES_PROB_DEFAULTS: SpeciesProbability = { contradictionDivisor: 2, minPct: 10, maxPct: 90, likelyPct: 50 };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const posNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Contract „App tolerance“: missing / non-object / other `format` / non-string `path` / bad `cellSize`,
 * `size` or a non-array `classes` → undefined (logged when present). A class without a numeric `code`,
 * or with `species: true` but no `f1` in (0, 1], is skipped; unknown fields are ignored.
 */
export function parseSpecies(v: unknown): ManifestSpecies | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) {
    console.warn('[manifest] species: not an object, ignored');
    return undefined;
  }
  if (v.format !== SPECIES_FORMAT) {
    console.warn(`[manifest] species: unsupported format ${String(v.format)}, ignored`);
    return undefined;
  }
  const size = isObj(v.size) ? v.size : null;
  if (typeof v.path !== 'string' || !posNum(v.cellSize) || !size || !posInt(size.width) || !posInt(size.height) || !Array.isArray(v.classes)) {
    console.warn('[manifest] species: path / cellSize / size / classes invalid, ignored');
    return undefined;
  }
  const classes = new Map<number, SpeciesClass>();
  for (const c of v.classes) {
    if (!isObj(c) || typeof c.code !== 'number' || !Number.isInteger(c.code)) continue;
    const species = c.species === true;
    const f1 = typeof c.f1 === 'number' && c.f1 > 0 && c.f1 <= 1 ? c.f1 : null;
    if (species && f1 === null) continue;
    const group = c.group === 'conifer' || c.group === 'broadleaf' ? c.group : 'none';
    classes.set(c.code, {
      code: c.code,
      key: typeof c.key === 'string' ? c.key : `class_${c.code}`,
      label_de: typeof c.label_de === 'string' ? c.label_de : `Klasse ${c.code}`,
      group,
      species,
      f1: species ? f1 : null,
    });
  }
  const p = isObj(v.probability) ? v.probability : {};
  const int = (x: unknown, d: number) => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : d);
  const probability: SpeciesProbability = {
    contradictionDivisor: int(p.contradictionDivisor, SPECIES_PROB_DEFAULTS.contradictionDivisor),
    minPct: int(p.minPct, SPECIES_PROB_DEFAULTS.minPct),
    maxPct: int(p.maxPct, SPECIES_PROB_DEFAULTS.maxPct),
    likelyPct: int(p.likelyPct, SPECIES_PROB_DEFAULTS.likelyPct),
  };
  const acc = isObj(v.accuracy) ? v.accuracy : {};
  return {
    format: SPECIES_FORMAT,
    path: v.path,
    cellSize: v.cellSize,
    size: { width: size.width, height: size.height },
    nodata: typeof v.nodata === 'number' ? v.nodata : 255,
    year: typeof v.year === 'number' && Number.isFinite(v.year) ? v.year : null,
    classes,
    probability,
    label_de: typeof v.label_de === 'string' ? v.label_de : 'Baumart (Schätzung, 10-m-Raster)',
    attribution: typeof v.attribution === 'string' ? v.attribution : '',
    accuracyNote: typeof acc.note_de === 'string' ? acc.note_de : '',
  };
}

/**
 * `species-dlr-neighbourhood-v1` step 5 in integer arithmetic (identical to Python `probability_pct`):
 * `num = k·f`, `den = n·(contra ? divisor : 1)`, `pct = 10·floor((num + 5·den) / (10·den))`, clamped.
 */
export function probabilityPct(k: number, n: number, f1Pct: number, contra: boolean, p: SpeciesProbability = SPECIES_PROB_DEFAULTS): number {
  if (!(n >= 1 && k >= 1)) throw new Error('k and n must be ≥ 1');
  const num = k * f1Pct;
  const den = n * (contra ? p.contradictionDivisor : 1);
  const pct = 10 * Math.floor((num + 5 * den) / (10 * den));
  return Math.max(p.minPct, Math.min(p.maxPct, pct));
}

/** One-sided contradiction (contract step 4): a conifer-coloured crown (type 1) in a broadleaf class. */
export function contradicts(cls: Pick<SpeciesClass, 'group'>, treeType: number): boolean {
  return (treeType & 0x7f) === 1 && cls.group === 'broadleaf';
}

export interface TreeSpecies {
  code: number;
  key: string;
  label_de: string;
  group: 'conifer' | 'broadleaf' | 'none';
  /** Cells of the 3 × 3 block equal to the centre class / inside the raster. */
  k: number;
  n: number;
  pct: number;
  contra: boolean;
  /** „wahrscheinlich“ (pct ≥ likelyPct, no contradiction), else „unsicher“. */
  likely: boolean;
}

/** Pixel (px, py) of a point on the species grid (row 0 = north), or null outside. */
export function speciesPixel(
  sp: Pick<ManifestSpecies, 'cellSize' | 'size'>,
  aoi: { E0: number; N0: number; heightM: number },
  E: number,
  N: number,
): { px: number; py: number } | null {
  const px = Math.floor((E - aoi.E0) / sp.cellSize);
  const py = Math.floor((aoi.N0 + aoi.heightM - N) / sp.cellSize);
  if (!(px >= 0 && px < sp.size.width && py >= 0 && py < sp.size.height)) return null;
  return { px, py };
}

/**
 * Species of a tree at (E, N) with base type `treeType` (0 unknown, 1 conifer, 2 broadleaf; fill bit
 * ignored) on the decoded grid `values` (width × height, row 0 north). null = no species (outside, no
 * data, canopy loss or an unknown value).
 */
export function speciesAt(
  sp: Pick<ManifestSpecies, 'cellSize' | 'size' | 'classes' | 'probability'>,
  values: ArrayLike<number>,
  aoi: { E0: number; N0: number; heightM: number },
  E: number,
  N: number,
  treeType: number,
): TreeSpecies | null {
  const at = speciesPixel(sp, aoi, E, N);
  if (!at) return null;
  const { width: w, height: h } = sp.size;
  const c = values[at.py * w + at.px];
  const cls = sp.classes.get(c);
  if (!cls || !cls.species || cls.f1 === null) return null;
  let k = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = at.px + dx;
      const y = at.py + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      n++;
      if (values[y * w + x] === c) k++;
    }
  }
  const contra = contradicts(cls, treeType);
  const pct = probabilityPct(k, n, Math.round(100 * cls.f1), contra, sp.probability);
  return { code: c, key: cls.key, label_de: cls.label_de, group: cls.group, k, n, pct, contra, likely: !contra && pct >= sp.probability.likelyPct };
}

/**
 * `tree-group-v1` (contract „Tree species“; twin of pipeline/species.py `tree_group`): 1 conifer, 2 broadleaf,
 * 0 no group. A „wahrscheinlich“ class gives its group; an „unsicher“ class gives the colour type only when it
 * agrees with the class group (else 0); no class gives the colour type (0 / 1 / 2, other codes → 0). The colour
 * type alone reads most conifers as broadleaf (review 2026-11-08: 79 % of the „wahrscheinlich“ conifers have type 2),
 * so the card title and the biomass density follow the species when it is likely.
 */
export function treeGroup(sp: Pick<TreeSpecies, 'group' | 'likely'> | null, treeType: number): 0 | 1 | 2 {
  const raw = treeType & 0x7f;
  const t: 0 | 1 | 2 = raw === 1 || raw === 2 ? raw : 0;
  const g = sp?.group === 'conifer' ? 1 : sp?.group === 'broadleaf' ? 2 : 0;
  if (!sp || g === 0) return t;
  if (sp.likely) return g;
  return t === g ? t : 0;
}

/** Contract wording: „wahrscheinlich Buche (70 %)“ / „Eiche? unsicher (30 %)“. */
export function speciesWording(label: string, pct: number, likely: boolean): string {
  return likely ? `wahrscheinlich ${label} (${pct} %)` : `${label}? unsicher (${pct} %)`;
}

// ---- tree-age-height-v2 (pipeline/forest_age.py) -------------------------------------------------------------

export const AGE_OFFSET_M = 2.0;
export const AGE_MIN_HEIGHT_M = 8.0;

interface YieldTable {
  ages: number[];
  I: number[];
  II: number[];
  III: number[];
}

/** Contract table „Tree age estimate“ (rounded mean heights, site classes I / II / III). */
export const YIELD_TABLES: Record<string, YieldTable> = {
  beech: { ages: [30, 40, 60, 80, 100, 120, 140, 160], I: [11, 15, 22, 27, 30.5, 33, 34.5, 35.5], II: [8.5, 12, 18.5, 23.5, 27, 29.5, 31, 32], III: [6, 9, 15, 19.5, 23, 25.5, 27, 28] },
  oak: {
    ages: [30, 40, 60, 80, 100, 120, 140, 160, 180, 200],
    I: [10.5, 13.5, 18.5, 22.5, 25.5, 28, 30, 31.5, 32.5, 33.5],
    II: [8, 11, 15.5, 19.5, 22.5, 25, 27, 28.5, 29.5, 30.5],
    III: [6, 8.5, 12.5, 16, 19, 21.5, 23.5, 25, 26, 27],
  },
  spruce: { ages: [20, 30, 40, 60, 80, 100, 120], I: [6.5, 12, 17, 24.5, 29.5, 33, 35], II: [5, 9.5, 14, 21, 26, 29.5, 31.5], III: [3.5, 7.5, 11, 17.5, 22, 25.5, 28] },
  pine: { ages: [20, 40, 60, 80, 100, 120, 140], I: [7, 15, 20.5, 24.5, 27.5, 29.5, 31], II: [5, 12, 17, 21, 23.5, 25.5, 27], III: [3.5, 9.5, 13.5, 17, 19.5, 21.5, 23] },
  douglas: { ages: [20, 40, 60, 80, 100], I: [10, 23, 32, 38, 42], II: [8, 19, 27, 33, 37], III: [6, 15, 22, 27, 31] },
};

/** Species group → yield tables (union when several). */
export const AGE_GROUP_TABLES: Record<string, readonly string[]> = {
  beech: ['beech'],
  oak: ['oak'],
  spruce: ['spruce'],
  fir: ['spruce'],
  douglas: ['douglas'],
  pine: ['pine'],
  larch: ['spruce'],
  conifer: ['spruce', 'pine'],
  birch: ['beech', 'oak'],
  alder: ['beech', 'oak'],
  other: ['beech', 'oak'],
  broadleaf: ['beech', 'oak'],
  unknown: ['beech', 'oak', 'spruce'],
};

export type AgeClass = 'young' | 'middle' | 'old' | 'very_old' | 'beyond';

export const AGE_CLASS_LABELS: Record<AgeClass, string> = {
  young: 'jung (unter 40 Jahre)',
  middle: 'mittelalt (40–80 Jahre)',
  old: 'alt (80–120 Jahre)',
  very_old: 'sehr alt (über 120 Jahre)',
  beyond: 'höher als die Ertragstafel (ohne Alter)',
};

/** Age group of a tree: the species layer's key when present, else the DOP colour type. */
export function ageGroup(speciesKey: string | null | undefined, treeType: number): string {
  if (speciesKey) {
    if (speciesKey === 'douglas_fir') return 'douglas';
    if (speciesKey === 'other_broadleaf') return 'other';
    if (AGE_GROUP_TABLES[speciesKey]) return speciesKey;
  }
  const t = treeType & 0x7f;
  return t === 1 ? 'conifer' : t === 2 ? 'broadleaf' : 'unknown';
}

/** Python's built-in `round` (half to even), used by forest_age.py `_round`. */
export function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const round5 = (v: number) => 5 * roundHalfEven(v / 5);

/** Age at which a curve reaches `height` (linear, from (0 y, 0 m)); [last age, open] beyond its end. */
function ageAt(height: number, ages: readonly number[], heights: readonly number[]): [number, boolean] {
  const a = [0, ...ages];
  const hh = [0, ...heights];
  if (height >= hh[hh.length - 1]) return [a[a.length - 1], height > hh[hh.length - 1]];
  if (height <= hh[0]) return [a[0], false];
  for (let i = 1; i < hh.length; i++) {
    if (height <= hh[i]) return [a[i - 1] + ((a[i] - a[i - 1]) * (height - hh[i - 1])) / (hh[i] - hh[i - 1]), false];
  }
  return [a[a.length - 1], false];
}

function median(v: number[]): number {
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function ageClass(age: number): AgeClass {
  if (age < 40) return 'young';
  if (age < 80) return 'middle';
  if (age < 120) return 'old';
  return 'very_old';
}

export interface TreeAge {
  /** Years (rounded to 5); null when `beyond`. */
  lo: number | null;
  mid: number | null;
  hi: number | null;
  /** The tree is taller than the last class-III table point: „…+ Jahre“ (always true when `beyond`). */
  open_hi: boolean;
  /**
   * Taller than the last class-II table point of one of its tables: the table cannot age it (v1 reported
   * the clamped last table age, e.g. „über 200 Jahre“ for every tall oak).
   */
  beyond: boolean;
  class: AgeClass;
  /** „etwa 55–85 Jahre“, „etwa 75–100+ Jahre“, „nicht schätzbar: höher als die Ertragstafel“. */
  label_de: string;
  tables: string[];
}

export const AGE_BEYOND_LABEL = 'nicht schätzbar: höher als die Ertragstafel';

/** `tree-age-height-v2` for one tree (null below 8 m or for a non-finite height). */
export function treeAge(heightM: number, group = 'unknown'): TreeAge | null {
  if (!Number.isFinite(heightM) || heightM < AGE_MIN_HEIGHT_M) return null;
  const tables = AGE_GROUP_TABLES[group] ?? AGE_GROUP_TABLES.unknown;
  const h = heightM - AGE_OFFSET_M;
  const los: number[] = [];
  const mids: number[] = [];
  const his: number[] = [];
  let openHi = false;
  let beyond = false;
  for (const t of tables) {
    const y = YIELD_TABLES[t];
    los.push(ageAt(h, y.ages, y.I)[0]);
    const [mid, midOpen] = ageAt(h, y.ages, y.II);
    mids.push(mid);
    const [hi, op] = ageAt(h, y.ages, y.III);
    his.push(hi);
    openHi ||= op;
    beyond ||= midOpen;
  }
  if (beyond) return { lo: null, mid: null, hi: null, open_hi: true, beyond: true, class: 'beyond', label_de: AGE_BEYOND_LABEL, tables: [...tables] };
  const lo = round5(Math.min(...los));
  const hi = round5(Math.max(...his));
  const mid = Math.min(Math.max(round5(median(mids)), lo), hi);
  const label = openHi ? `etwa ${lo}–${hi}+ Jahre` : `etwa ${lo}–${hi} Jahre`;
  return { lo, mid, hi, open_hi: openHi, beyond: false, class: ageClass(mid), label_de: label, tables: [...tables] };
}
