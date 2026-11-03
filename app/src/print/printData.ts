/**
 * F21 "3D-Druck" planner — pure logic (no three.js / DOM / Leaflet): the global print grid, tile ids,
 * `index.json` parsing (contract "3D print tiles", sle-print3d-v1), totals, connector keys and the
 * CLI command that generates missing tiles. Unit-tested in tests/print3d.test.ts.
 *
 * Series discovery: `<printRoot>series.json` (the pipeline's catalog `sle-print3d-series-v1`,
 * `{ series: [{ key, role, … }] }`; a plain array of keys is accepted too), otherwise the keys in
 * `KNOWN_PRINT_SERIES` are tried one by one; every series whose `index.json` validates is offered.
 * Datum: `series.datumMode` "series" = one datum for all tiles; "set" = per tile `datum_m` — tiles
 * only join (and need connector keys) when their datum is the same.
 */

export const PRINT_FORMAT = 'sle-print3d-v1';
export const PRINT_SERIES_LIST = 'series.json';
export const PRINT_PREFS_KEY = 'sle.print.v1';

/** Series keys tried when `print/series.json` is absent (current series first, then older ones). */
export const KNOWN_PRINT_SERIES: readonly string[] = ['saarpfalz-9200', 'detail-2300', 'kirrberg-11050', 'saarpfalz-8500', 'detail-2125', 'saarpfalz-8400', 'detail-2100', 'saarpfalz-8000', 'detail-2000'];

/** Tile id `E{km}_N{km}` (decimals only when needed, ≤ 3) — contract regex. */
export const TILE_ID_RE = /^E(\d+(?:\.\d{1,3})?)_N(\d+(?:\.\d{1,3})?)$/;
const SERIES_KEY_RE = /^[\w.-]{1,64}$/;

export type Bbox = [number, number, number, number];

export interface GridSpec {
  tile_m: number;
  origin: [number, number];
}

/** One square of the global print grid (lower-left corner E0, N0). */
export interface GridCell {
  id: string;
  E0: number;
  N0: number;
  col: number;
  row: number;
  bbox: Bbox;
}

// ---- ids & grid -----------------------------------------------------------------------------------

/** Metres → km text with up to 3 decimals, trailing zeros dropped (382500 → "382.5"). */
export function formatKm(m: number): string {
  return String(Number((m / 1000).toFixed(3)));
}

export function tileId(E0: number, N0: number): string {
  return `E${formatKm(E0)}_N${formatKm(N0)}`;
}

/** Lower-left corner (metres) of a tile id, or null when it doesn't match the contract regex. */
export function parseTileId(id: string): { E0: number; N0: number } | null {
  const m = TILE_ID_RE.exec(id);
  if (!m) return null;
  return { E0: Math.round(Number(m[1]) * 1000), N0: Math.round(Number(m[2]) * 1000) };
}

export function cellAt(col: number, row: number, g: GridSpec): GridCell {
  const E0 = g.origin[0] + col * g.tile_m;
  const N0 = g.origin[1] + row * g.tile_m;
  return { id: tileId(E0, N0), E0, N0, col, row, bbox: [E0, N0, E0 + g.tile_m, N0 + g.tile_m] };
}

/** Grid cell containing the corner (E0, N0), or null when it isn't on the grid. */
export function cellOfCorner(E0: number, N0: number, g: GridSpec): GridCell | null {
  const col = (E0 - g.origin[0]) / g.tile_m;
  const row = (N0 - g.origin[1]) / g.tile_m;
  if (Math.abs(col - Math.round(col)) > 1e-6 || Math.abs(row - Math.round(row)) > 1e-6) return null;
  return cellAt(Math.round(col), Math.round(row), g);
}

/**
 * Cells whose square overlaps the inside of `bbox`, expanded by `ring` cells on every side (the
 * "extension" cells around an AOI). Ordered N descending, E ascending (table order).
 */
export function gridCells(bbox: Readonly<Bbox>, g: GridSpec, ring = 0): GridCell[] {
  const [e0, n0, e1, n1] = bbox;
  if (!(e1 > e0 && n1 > n0) || !(g.tile_m > 0)) return [];
  const eps = 1e-6;
  const c0 = Math.floor((e0 - g.origin[0]) / g.tile_m + eps) - ring;
  const c1 = Math.ceil((e1 - g.origin[0]) / g.tile_m - eps) - 1 + ring;
  const r0 = Math.floor((n0 - g.origin[1]) / g.tile_m + eps) - ring;
  const r1 = Math.ceil((n1 - g.origin[1]) / g.tile_m - eps) - 1 + ring;
  const out: GridCell[] = [];
  for (let r = r1; r >= r0; r--) for (let c = c0; c <= c1; c++) out.push(cellAt(c, r, g));
  return out;
}

export function bboxOverlap(a: Readonly<Bbox>, b: Readonly<Bbox>): Bbox | null {
  const o: Bbox = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return o[2] > o[0] && o[3] > o[1] ? o : null;
}

// ---- index.json -------------------------------------------------------------------------------------

export interface PrintTile {
  id: string;
  bboxUTM: Bbox;
  files: { '3mf': string; png?: string; stl?: string };
  z_mm: { min: number; max: number; mean?: number };
  h_m?: { min: number; max: number; mean: number };
  /** typical = stock slicer process; recommended = with `PrintIndex.slicer` settings (optional, newer files). */
  filament_g: { solid: number; typical: number; recommended?: number };
  /** Datum of this tile (m NHN); absent in older files → `series.datum_m`. */
  datum_m?: number;
  volume_cm3?: number;
  clampedVertices?: number;
  watertight?: boolean;
  created?: string;
}

export interface PrintSeries {
  key: string;
  name_de: string;
  scale: number;
  tile_m: number;
  tile_mm: number;
  exag: number;
  /** Series datum (m NHN); null for datumMode "set" (then per tile / per set). */
  datum_m: number | null;
  /** "series" (one datum) or "set" (per tile `datum_m`); absent in older files = "series". */
  datumMode: string;
  /** Catalog hint: "main" | "detail" | "single" (standalone showpiece: no AOI grid / extension ring). */
  role?: string;
  base_mm: number;
  cell_m?: number;
  origin: [number, number];
  connectors: { enabled: boolean; positions: number[]; key: string | null };
}

export interface PrintIndex {
  series: PrintSeries;
  printer?: string;
  printerProfile?: { mode?: string; name?: string; file: string | null; note_de?: string; placement_mm?: [number, number] };
  filament?: { material?: string; infill?: number };
  /** Recommended slicer process changes (display only — a plain 3MF cannot carry them). */
  slicer?: { note_de: string; savingPct?: [number, number] };
  layout?: string;
  sets: Record<string, string[]>;
  /** datumMode "set": frozen datum per named set (m NHN). */
  setDatum_m: Record<string, number>;
  keysNeeded?: number;
  attribution: string;
  disclaimer_de: string;
  updated?: string;
  tiles: PrintTile[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';

/**
 * A file reference inside a series folder: relative, no scheme, no `..`, no leading slash, plain
 * path characters (the contract allows e.g. `keys/bowtie_key.stl`).
 */
export function safeRelPath(p: unknown): p is string {
  return str(p) && p.length > 0 && p.length < 200 && /^[\w.\-]+(\/[\w.\-]+)*$/.test(p) && !p.split('/').some((s) => s === '..' || s === '.');
}

function parseTile(t: unknown, g: GridSpec): PrintTile | string {
  if (!isObj(t)) return 'tile is not an object';
  const id = t.id;
  if (!str(id) || !TILE_ID_RE.test(id)) return `bad tile id ${JSON.stringify(id)}`;
  const b = t.bboxUTM;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(num)) return `${id}: bad bboxUTM`;
  const corner = parseTileId(id)!;
  if (Math.abs(b[0] - corner.E0) > 0.5 || Math.abs(b[1] - corner.N0) > 0.5 || Math.abs(b[2] - b[0] - g.tile_m) > 0.5 || Math.abs(b[3] - b[1] - g.tile_m) > 0.5)
    return `${id}: bboxUTM does not match id / tile_m`;
  if (!cellOfCorner(b[0], b[1], g)) return `${id}: not on the series grid`;
  const f = t.files;
  if (!isObj(f) || !safeRelPath(f['3mf'])) return `${id}: missing files.3mf`;
  const z = t.z_mm;
  if (!isObj(z) || !num(z.min) || !num(z.max)) return `${id}: missing z_mm`;
  const fg = t.filament_g;
  if (!isObj(fg) || !num(fg.solid) || !num(fg.typical)) return `${id}: missing filament_g`;
  const h = t.h_m;
  return {
    id,
    bboxUTM: [b[0], b[1], b[2], b[3]],
    files: {
      '3mf': f['3mf'],
      ...(safeRelPath(f.png) ? { png: f.png } : {}),
      ...(safeRelPath(f.stl) ? { stl: f.stl } : {}),
    },
    z_mm: { min: z.min, max: z.max, ...(num(z.mean) ? { mean: z.mean } : {}) },
    ...(isObj(h) && num(h.min) && num(h.max) && num(h.mean) ? { h_m: { min: h.min, max: h.max, mean: h.mean } } : {}),
    filament_g: { solid: fg.solid, typical: fg.typical, ...(num(fg.recommended) ? { recommended: fg.recommended } : {}) },
    ...(num(t.datum_m) ? { datum_m: t.datum_m } : {}),
    ...(num(t.volume_cm3) ? { volume_cm3: t.volume_cm3 } : {}),
    ...(num(t.clampedVertices) ? { clampedVertices: t.clampedVertices } : {}),
    ...(typeof t.watertight === 'boolean' ? { watertight: t.watertight } : {}),
    ...(str(t.created) ? { created: t.created } : {}),
  };
}

/**
 * Validate an `index.json`. Throws when the format or the series block is unusable; invalid tiles
 * are skipped with a warning (consumers must ignore unknown keys).
 */
export function parsePrintIndex(raw: unknown): { value: PrintIndex; warnings: string[] } {
  if (!isObj(raw) || raw.format !== PRINT_FORMAT) throw new Error(`format is not ${PRINT_FORMAT}`);
  const s = raw.series;
  if (!isObj(s)) throw new Error('missing series');
  const key = s.key;
  if (!str(key) || !SERIES_KEY_RE.test(key)) throw new Error('bad series.key');
  for (const k of ['scale', 'tile_m', 'tile_mm', 'exag', 'base_mm'] as const) {
    if (!num(s[k]) || (s[k] as number) <= 0) throw new Error(`bad series.${k}`);
  }
  const datumMode = str(s.datumMode) && s.datumMode ? s.datumMode : 'series';
  if (!num(s.datum_m) && !(datumMode === 'set' && s.datum_m === null)) throw new Error('bad series.datum_m');
  const o = s.origin;
  const origin: [number, number] = Array.isArray(o) && o.length === 2 && o.every(num) ? [o[0], o[1]] : [0, 0];
  const c = isObj(s.connectors) ? s.connectors : {};
  const positions = Array.isArray(c.positions) ? c.positions.filter(num) : [];
  const series: PrintSeries = {
    key,
    name_de: str(s.name_de) && s.name_de ? s.name_de : key,
    scale: s.scale as number,
    tile_m: s.tile_m as number,
    tile_mm: s.tile_mm as number,
    exag: s.exag as number,
    datum_m: num(s.datum_m) ? s.datum_m : null,
    datumMode,
    ...(str(s.role) && s.role ? { role: s.role } : {}),
    base_mm: s.base_mm as number,
    ...(num(s.cell_m) ? { cell_m: s.cell_m } : {}),
    origin,
    connectors: { enabled: c.enabled === true, positions, key: c.enabled === true && safeRelPath(c.key) ? c.key : null },
  };
  const g: GridSpec = { tile_m: series.tile_m, origin };
  const warnings: string[] = [];
  const tiles: PrintTile[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(raw.tiles) ? raw.tiles : []) {
    const r = parseTile(t, g);
    if (typeof r === 'string') warnings.push(`${key}: ${r} – skipped`);
    else if (seen.has(r.id)) warnings.push(`${key}: duplicate tile ${r.id} – skipped`);
    else {
      seen.add(r.id);
      tiles.push(r);
    }
  }
  tiles.sort((a, b) => b.bboxUTM[1] - a.bboxUTM[1] || a.bboxUTM[0] - b.bboxUTM[0]);
  const sets: Record<string, string[]> = {};
  if (isObj(raw.sets)) {
    for (const [name, ids] of Object.entries(raw.sets)) {
      if (Array.isArray(ids)) sets[name] = ids.filter((i): i is string => str(i) && TILE_ID_RE.test(i));
    }
  }
  const setDatum_m: Record<string, number> = {};
  if (isObj(raw.setDatum_m)) for (const [name, d] of Object.entries(raw.setDatum_m)) if (num(d)) setDatum_m[name] = d;
  const pp = raw.printerProfile;
  const sl = raw.slicer;
  return {
    value: {
      series,
      ...(str(raw.printer) ? { printer: raw.printer } : {}),
      ...(isObj(pp)
        ? {
            printerProfile: {
              ...(str(pp.mode) ? { mode: pp.mode } : {}),
              ...(str(pp.name) ? { name: pp.name } : {}),
              file: safeRelPath(pp.file) ? pp.file : null,
              ...(str(pp.note_de) ? { note_de: pp.note_de } : {}),
              ...(Array.isArray(pp.placement_mm) && pp.placement_mm.length === 2 && pp.placement_mm.every(num)
                ? { placement_mm: [pp.placement_mm[0], pp.placement_mm[1]] as [number, number] }
                : {}),
            },
          }
        : {}),
      ...(isObj(raw.filament)
        ? { filament: { ...(str(raw.filament.material) ? { material: raw.filament.material } : {}), ...(num(raw.filament.infill) ? { infill: raw.filament.infill } : {}) } }
        : {}),
      ...(isObj(sl) && str(sl.note_de) && sl.note_de
        ? {
            slicer: {
              note_de: sl.note_de,
              ...(Array.isArray(sl.savingPct) && sl.savingPct.length === 2 && sl.savingPct.every(num)
                ? { savingPct: [sl.savingPct[0], sl.savingPct[1]] as [number, number] }
                : {}),
            },
          }
        : {}),
      ...(safeRelPath(raw.layout) ? { layout: raw.layout } : {}),
      sets,
      setDatum_m,
      ...(num(raw.keysNeeded) ? { keysNeeded: raw.keysNeeded } : {}),
      attribution: str(raw.attribution) ? raw.attribution : '',
      disclaimer_de: str(raw.disclaimer_de) && raw.disclaimer_de ? raw.disclaimer_de : 'Geländemodell zum Anschauen (Hypothesen, keine Befunde). Schauen, nicht graben.',
      ...(str(raw.updated) ? { updated: raw.updated } : {}),
      tiles,
    },
    warnings,
  };
}

/** `series.json`: an array of keys, or `{ series: [key | { key }] }`. Invalid keys are dropped. */
export function parseSeriesList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.series) ? raw.series : [];
  const keys = list.map((x) => (str(x) ? x : isObj(x) && str(x.key) ? x.key : '')).filter((k) => SERIES_KEY_RE.test(k));
  return [...new Set(keys)];
}

// ---- planning -----------------------------------------------------------------------------------------

/** A cell with an optional join group (tiles only join within the same datum). */
export interface JoinCell {
  col: number;
  row: number;
  group?: number | string;
}

const cellKey = (c: number, r: number) => `${c},${r}`;

/** Number of edges shared by two of the given cells of the same group (4-neighbourhood). */
export function sharedEdges(cells: ReadonlyArray<JoinCell>): number {
  const groups = new Map(cells.map((c) => [cellKey(c.col, c.row), c.group ?? '']));
  let n = 0;
  for (const c of cells) {
    const g = c.group ?? '';
    if (groups.get(cellKey(c.col + 1, c.row)) === g) n++;
    if (groups.get(cellKey(c.col, c.row + 1)) === g) n++;
  }
  return n;
}

/** Edge-connected groups of cells of the same group (separately assembled pieces). */
export function blockCount(cells: ReadonlyArray<JoinCell>): number {
  const groups = new Map(cells.map((c) => [cellKey(c.col, c.row), c.group ?? '']));
  const left = new Set(groups.keys());
  let blocks = 0;
  for (const start of [...left]) {
    if (!left.has(start)) continue;
    blocks++;
    const g = groups.get(start);
    const stack = [start];
    left.delete(start);
    while (stack.length) {
      const [c, r] = stack.pop()!.split(',').map(Number);
      for (const k of [cellKey(c + 1, r), cellKey(c - 1, r), cellKey(c, r + 1), cellKey(c, r - 1)]) {
        if (left.has(k) && groups.get(k) === g) {
          left.delete(k);
          stack.push(k);
        }
      }
    }
  }
  return blocks;
}

/** Datum of a tile (its own, else the series datum; null when neither is known). */
export function tileDatum(series: Pick<PrintSeries, 'datum_m'>, t: Pick<PrintTile, 'datum_m'>): number | null {
  return t.datum_m ?? series.datum_m;
}

export interface PrintTotals {
  tiles: number;
  /** Typical filament (shell + infill), grams — stock slicer process. */
  gramsTypical: number;
  /** Filament with the recommended slicer settings, grams; null unless every tile has an estimate. */
  gramsRecommended: number | null;
  gramsSolid: number;
  /** Bounding rectangle of all tiles once assembled (cm). */
  widthCm: number;
  heightCm: number;
  /** Separate edge-connected pieces (tiles with different datums count as separate pieces). */
  blocks: number;
  /** Distinct datums among the tiles (m NHN, ascending). */
  datums: number[];
  /** Bowtie keys for all shared edges (0 without connectors). */
  keys: number;
  maxZmm: number;
}

export function printTotals(
  series: Pick<PrintSeries, 'tile_m' | 'tile_mm' | 'origin' | 'connectors' | 'datum_m'>,
  tiles: readonly PrintTile[],
): PrintTotals {
  const g: GridSpec = { tile_m: series.tile_m, origin: series.origin };
  const cells: JoinCell[] = [];
  for (const t of tiles) {
    const c = cellOfCorner(t.bboxUTM[0], t.bboxUTM[1], g);
    if (c) cells.push({ col: c.col, row: c.row, group: tileDatum(series, t) ?? '?' });
  }
  let gramsTypical = 0;
  let gramsSolid = 0;
  let gramsRecommended: number | null = tiles.length ? 0 : null;
  let maxZmm = 0;
  for (const t of tiles) {
    gramsTypical += t.filament_g.typical;
    const rec = t.filament_g.recommended;
    gramsRecommended = gramsRecommended === null || rec === undefined ? null : gramsRecommended + rec;
    gramsSolid += t.filament_g.solid;
    maxZmm = Math.max(maxZmm, t.z_mm.max);
  }
  let widthCm = 0;
  let heightCm = 0;
  if (cells.length) {
    const cols = cells.map((c) => c.col);
    const rows = cells.map((c) => c.row);
    widthCm = ((Math.max(...cols) - Math.min(...cols) + 1) * series.tile_mm) / 10;
    heightCm = ((Math.max(...rows) - Math.min(...rows) + 1) * series.tile_mm) / 10;
  }
  const perEdge = series.connectors.enabled ? series.connectors.positions.length : 0;
  return {
    tiles: tiles.length,
    gramsTypical,
    gramsRecommended,
    gramsSolid,
    widthCm,
    heightCm,
    blocks: blockCount(cells),
    datums: [...new Set(tiles.map((t) => tileDatum(series, t)).filter((d): d is number => d !== null))].sort((a, b) => a - b),
    keys: sharedEdges(cells) * perEdge,
    maxZmm,
  };
}

/**
 * Bowtie keys for the complete named sets (every member, generated or not): shared edges among all set
 * member cells, joined only within the same datum (set datum, else series datum, else per set), × positions.
 * Unlike `index.keysNeeded` (generated tiles only) this is what the finished sets need. A cell in several sets
 * counts once (first set wins). 0 without connectors or sets.
 */
export function setKeys(index: Pick<PrintIndex, 'series' | 'sets' | 'setDatum_m'>): number {
  const s = index.series;
  if (!s.connectors.enabled) return 0;
  const g: GridSpec = { tile_m: s.tile_m, origin: s.origin };
  const seen = new Set<string>();
  const cells: JoinCell[] = [];
  for (const [name, ids] of Object.entries(index.sets)) {
    const group = index.setDatum_m[name] ?? s.datum_m ?? `set:${name}`;
    for (const id of ids) {
      const p = parseTileId(id);
      const c = p && cellOfCorner(p.E0, p.N0, g);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      cells.push({ col: c.col, row: c.row, group });
    }
  }
  return sharedEdges(cells) * s.connectors.positions.length;
}

/** Shell command (run in `pipeline/`) that generates the given tiles of a series. */
export function generateCommand(seriesKey: string, ids: readonly string[], datum: number | null = null): string {
  return `uv run python print3d.py --series ${seriesKey} --tiles ${ids.join(' ')}${datum !== null ? ` --datum ${datum}` : ''}`;
}

export interface CellCommand {
  cmd: string;
  /** German hint (datum choice), or ''. */
  note_de: string;
}

/**
 * Command for a missing cell. Series datum or a cell of a named set: just `--tiles` (print3d.py
 * takes the set's datum). Per-set datum and no set: `--datum` of the nearest generated tile / set
 * so the new tile joins it (tiles only join at the same datum).
 */
export function cellCommand(index: Pick<PrintIndex, 'series' | 'tiles' | 'sets' | 'setDatum_m'>, id: string): CellCommand {
  const s = index.series;
  const p = parseTileId(id);
  const inSet = Object.values(index.sets).some((ids) => ids.includes(id));
  if (s.datumMode !== 'set' || inSet || !p) return { cmd: generateCommand(s.key, [id]), note_de: '' };
  const cx = p.E0 + s.tile_m / 2;
  const cy = p.N0 + s.tile_m / 2;
  let best: { d: number; datum: number; from: string } | null = null;
  const consider = (E0: number, N0: number, datum: number | null | undefined, from: string) => {
    if (datum === null || datum === undefined) return;
    const d = Math.hypot(E0 + s.tile_m / 2 - cx, N0 + s.tile_m / 2 - cy);
    if (!best || d < best.d) best = { d, datum, from };
  };
  for (const t of index.tiles) consider(t.bboxUTM[0], t.bboxUTM[1], tileDatum(s, t), `Kachel ${t.id}`);
  for (const [name, ids] of Object.entries(index.sets)) {
    for (const sid of ids) {
      const q = parseTileId(sid);
      if (q) consider(q.E0, q.N0, index.setDatum_m[name], `Set „${name}“`);
    }
  }
  const b = best as { d: number; datum: number; from: string } | null;
  if (!b) {
    return { cmd: generateCommand(s.key, [id]), note_de: 'Diese Serie braucht eine Bezugshöhe: --datum M (m NHN) anhängen oder ein Set in print3d.toml anlegen.' };
  }
  return {
    cmd: generateCommand(s.key, [id], b.datum),
    note_de: `Bezugshöhe ${b.datum} m wie ${b.from} – nur Kacheln gleicher Bezugshöhe passen zusammen; tieferes Gelände wird auf diese Höhe angehoben.`,
  };
}

export interface DisplayCell extends GridCell {
  tile: PrintTile | null;
  /** Named sets (index `sets`) that list this cell. */
  sets: string[];
}

/**
 * Cells to draw on the minimap: the AOI's cells plus one ring of extension cells, every generated
 * tile and every set member (wherever they are). N descending, E ascending. A series with role
 * "single" (one standalone piece on its own origin, joins nothing) shows only its tiles and set
 * members — no AOI grid of "missing" neighbours.
 */
export function displayCells(index: Pick<PrintIndex, 'series' | 'tiles' | 'sets'>, aoiBbox: Readonly<Bbox>, ring = 1): DisplayCell[] {
  const g: GridSpec = { tile_m: index.series.tile_m, origin: index.series.origin };
  const byId = new Map<string, GridCell>();
  if (index.series.role !== 'single') for (const c of gridCells(aoiBbox, g, ring)) byId.set(c.id, c);
  const add = (E0: number, N0: number) => {
    const c = cellOfCorner(E0, N0, g);
    if (c && !byId.has(c.id)) byId.set(c.id, c);
  };
  for (const t of index.tiles) add(t.bboxUTM[0], t.bboxUTM[1]);
  const setsOf = new Map<string, string[]>();
  for (const [name, ids] of Object.entries(index.sets)) {
    for (const id of ids) {
      const p = parseTileId(id);
      if (!p) continue;
      add(p.E0, p.N0);
      const c = cellOfCorner(p.E0, p.N0, g);
      if (c) setsOf.set(c.id, [...(setsOf.get(c.id) ?? []), name]);
    }
  }
  const tiles = new Map(index.tiles.map((t) => [cellOfCorner(t.bboxUTM[0], t.bboxUTM[1], g)?.id ?? t.id, t]));
  return [...byId.values()]
    .sort((a, b) => b.row - a.row || a.col - b.col)
    .map((c) => ({ ...c, tile: tiles.get(c.id) ?? null, sets: setsOf.get(c.id) ?? [] }));
}

/**
 * Tile outline in the local frame (x = E − E0, z = −(N − N0)), densified to ≤ `maxSeg` m and cut to
 * the parts inside `clip` (the loaded AOI) — returns one polyline per inside run ([x, z, …]).
 */
export function outlineRuns(bbox: Readonly<Bbox>, origin: { E0: number; N0: number }, clip: Readonly<Bbox> | null, maxSeg = 2): number[][] {
  const [e0, n0, e1, n1] = bbox;
  const corners: Array<[number, number]> = [
    [e0, n0],
    [e1, n0],
    [e1, n1],
    [e0, n1],
    [e0, n0],
  ];
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    const [ea, na] = corners[i];
    const [eb, nb] = corners[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(eb - ea, nb - na) / maxSeg));
    for (let k = 0; k < n; k++) pts.push([ea + ((eb - ea) * k) / n, na + ((nb - na) * k) / n]);
  }
  pts.push([e0, n0]);
  const inside = ([E, N]: [number, number]) => !clip || (E >= clip[0] && E <= clip[2] && N >= clip[1] && N <= clip[3]);
  const runs: number[][] = [];
  let cur: number[] = [];
  for (const p of pts) {
    if (inside(p)) cur.push(p[0] - origin.E0, -(p[1] - origin.N0));
    else {
      if (cur.length >= 4) runs.push(cur);
      cur = [];
    }
  }
  const firstIn = inside(pts[0]);
  if (firstIn && runs.length && cur.length && cur.length < pts.length * 2) {
    // The ring left the clip and came back: its last run continues through the start corner.
    const first = runs[0][0] === pts[0][0] - origin.E0 && runs[0][1] === -(pts[0][1] - origin.N0) ? runs.shift()! : [];
    cur = cur.concat(first.slice(2));
  }
  if (cur.length >= 4) runs.push(cur);
  return runs;
}

// ---- minimap tile labels --------------------------------------------------------------------------------

/**
 * Label metrics of `.sle-print-label` (600 10px system-ui): conservative mean glyph advance of
 * digits/E/N/_/./ , padding + a margin to the cell edge, and the line height.
 */
export const LABEL_CHAR_PX = 6.4;
export const LABEL_PAD_PX = 14;
export const LABEL_LINE_PX = 12;

export type TileLabelMode = 'full' | 'compact' | 'none';

export interface TileLabel {
  mode: TileLabelMode;
  /** Text lines (empty for 'none'). */
  lines: string[];
}

/** Estimated on-screen width of a label line (px). */
export function labelWidthPx(text: string): number {
  return text.length * LABEL_CHAR_PX + LABEL_PAD_PX;
}

function labelLines(id: string, mode: TileLabelMode): string[] {
  if (mode === 'none') return [];
  const m = mode === 'compact' ? TILE_ID_RE.exec(id) : null;
  return m ? [m[1], m[2]] : [id];
}

function fits(lines: string[], tilePx: number): boolean {
  return Math.max(...lines.map(labelWidthPx)) <= tilePx && lines.length * LABEL_LINE_PX + LABEL_PAD_PX <= tilePx;
}

/**
 * Label style for all generated tiles of a series whose squares are `tilePx` screen pixels wide:
 * 'full' (`E382_N5466`) when every id fits on one line, else 'compact' (the two grid numbers
 * stacked, `382` / `5466`) when all of those fit, else 'none' (ids only in the hover tooltip).
 * One style per series, so labels don't switch style from tile to tile. A shown label is never
 * wider or taller than its own (centred) cell, so labels of neighbouring tiles cannot overlap.
 */
export function tileLabelMode(ids: readonly string[], tilePx: number): TileLabelMode {
  if (!(tilePx > 0) || !ids.length) return 'none';
  if (ids.every((id) => fits(labelLines(id, 'full'), tilePx))) return 'full';
  if (ids.every((id) => TILE_ID_RE.test(id) && fits(labelLines(id, 'compact'), tilePx))) return 'compact';
  return 'none';
}

/** Label of one tile (`ids` = all labelled tiles of the series, default just this one). */
export function tileLabel(id: string, tilePx: number, ids: readonly string[] = [id]): TileLabel {
  const mode = tileLabelMode(ids, tilePx);
  return { mode, lines: labelLines(id, mode) };
}

// ---- formatting & prefs ---------------------------------------------------------------------------------

export function formatScale(scale: number): string {
  return `1:${Math.round(scale).toLocaleString('de-DE')}`;
}

/** Grams → "435 g" / "5,2 kg". */
export function formatGrams(g: number): string {
  return g >= 1000 ? `${(g / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kg` : `${Math.round(g).toLocaleString('de-DE')} g`;
}

export function formatNum(v: number, digits = 1): string {
  return v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export interface PrintPrefs {
  series: string | null;
  /** Draw the grid on the minimap while the card is open. */
  grid: boolean;
  /** Draw the selected tile's outline in 3D. */
  outline: boolean;
}

export const DEFAULT_PRINT_PREFS: PrintPrefs = { series: null, grid: true, outline: true };

export function parsePrintPrefs(raw: unknown): PrintPrefs {
  const r = isObj(raw) ? raw : {};
  return {
    series: str(r.series) && SERIES_KEY_RE.test(r.series) ? r.series : null,
    grid: typeof r.grid === 'boolean' ? r.grid : DEFAULT_PRINT_PREFS.grid,
    outline: typeof r.outline === 'boolean' ? r.outline : DEFAULT_PRINT_PREFS.outline,
  };
}
