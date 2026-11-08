/**
 * 🏆 Orte im Vergleich — pure data side (no three / DOM): the manifest `stats` key, the tolerant
 * `stats/places.json` (`sle-stats-v1`) and `stats/places.geojson` parsers, the leaderboard ranking
 * rule and the German number formatting. Binding format: docs/data-contract.md „Place statistics“;
 * decision: ADR 0049 (places only, estimates as ranges).
 */

export const STATS_FORMAT = 'sle-stats-v1';

/**
 * Window event that opens a place's card in the „Orte im Vergleich“ panel (Baum-Steckbrief link):
 * `window.dispatchEvent(new CustomEvent(PLACE_OPEN_EVENT, { detail: { id } }))`.
 */
export const PLACE_OPEN_EVENT = 'sle:place-open';

/** Manifest key `stats` (contract „Manifest key“). */
export interface ManifestStats {
  format: typeof STATS_FORMAT;
  url: string;
  geometry?: string;
  generated?: string;
  places?: number;
  label_de: string;
}

export type Range = [lo: number, mid: number, hi: number];

export interface Discipline {
  id: string;
  name_de: string;
  emoji?: string;
  description_de: string;
  scope: 'place' | 'municipality';
  measure: string;
  unit: string;
  higher_is_better: boolean;
  method: string;
  ready: boolean;
}

export interface Ortslage {
  area_ha: number | null;
  buildings: number | null;
  canopy_pct: number | null;
  green_pct: number | null;
  sealed_pct: number | null;
}

export interface Tallest {
  h: number;
  E: number;
  N: number;
  id: number | null;
  in_trees: boolean;
}

export interface Place {
  id: string;
  name_de: string;
  kind: string;
  state: string;
  municipality: string | null;
  category: 'stadt' | 'dorf' | null;
  complete: boolean;
  flags: string[];
  suppressed: string[];
  lidar_epoch: number | null;
  lidar_epochs: Array<[number, number]>;
  label: [number, number] | null;
  bbox: [number, number, number, number] | null;
  aoi_share_pct: number | null;
  area_ha: number | null;
  parcels: number | null;
  trees: number | null;
  crown_ha: number | null;
  crown_pct: number | null;
  agb_t: Range | null;
  co2_t: Range | null;
  ortslage: Ortslage | null;
  inhabitants: number | null;
  trees_per_inhabitant: number | null;
  tallest: Tallest | null;
  /** The raw object (the ranking resolves `measure` paths on it; unknown fields stay ignored). */
  raw: Record<string, unknown>;
}

export interface MunicipalityPv {
  as_of: string | null;
  systems: number | null;
  kwp: number | null;
  kwp_per_inhabitant: number | null;
  small_systems: number | null;
}

export interface Municipality {
  id: string;
  name_de: string;
  state: string;
  places: string[];
  inhabitants: number | null;
  pv: MunicipalityPv | null;
  raw: Record<string, unknown>;
}

export interface PlacesData {
  generated: string;
  label_de: string;
  disclaimer_de: string;
  attribution: string;
  /** Ready and not-ready disciplines with a known scope, in file order. */
  disciplines: Discipline[];
  places: Place[];
  municipalities: Municipality[];
  /** RLP/SL tree-count ratio from `method.crown.params.rlp_border_effect` (≈ 1.2), or null. */
  rlpTreeRatio: number | null;
  /** Method labels by id (for the card's „Methode“ hints). */
  methodLabels: Record<string, string>;
}

// ---- small guards -------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function numTuple<N extends number>(v: unknown, n: N): number[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  return v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null;
}

function range(v: unknown): Range | null {
  const t = numTuple(v, 3);
  return t && t[0] <= t[1] && t[1] <= t[2] ? (t as Range) : null;
}

// ---- manifest key ---------------------------------------------------------------------------------

/** Contract „App tolerance“: non-object, other `format` or a non-string `url` → absent. */
export function parseManifestStats(v: unknown): ManifestStats | undefined {
  if (!isObj(v)) return undefined;
  if (v.format !== STATS_FORMAT) {
    console.warn('[places] manifest.stats: unknown format, ignored', v.format);
    return undefined;
  }
  const url = str(v.url);
  if (!url) {
    console.warn('[places] manifest.stats: url missing, ignored');
    return undefined;
  }
  const out: ManifestStats = { format: STATS_FORMAT, url, label_de: str(v.label_de) || 'Orte im Vergleich' };
  const geometry = str(v.geometry);
  if (geometry) out.geometry = geometry;
  if (str(v.generated)) out.generated = v.generated as string;
  if (num(v.places) !== null) out.places = v.places as number;
  return out;
}

// ---- places.json ----------------------------------------------------------------------------------

function parseDiscipline(v: unknown): Discipline | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const name = str(v.name_de);
  if (!id || !name) return null;
  if (v.scope !== 'place' && v.scope !== 'municipality') return null; // unknown scope → ignored
  return {
    id,
    name_de: name,
    emoji: str(v.emoji) ?? undefined,
    description_de: str(v.description_de) ?? '',
    scope: v.scope,
    measure: str(v.measure) ?? '',
    unit: str(v.unit) ?? '',
    higher_is_better: v.higher_is_better !== false,
    method: str(v.method) ?? '',
    ready: v.ready === true,
  };
}

function parseOrtslage(v: unknown): Ortslage | null {
  if (!isObj(v)) return null;
  return {
    area_ha: num(v.area_ha),
    buildings: num(v.buildings),
    canopy_pct: num(v.canopy_pct),
    green_pct: num(v.green_pct),
    sealed_pct: num(v.sealed_pct),
  };
}

function parseTallest(v: unknown): Tallest | null {
  if (!isObj(v)) return null;
  const h = num(v.h);
  const E = num(v.E);
  const N = num(v.N);
  if (h === null || E === null || N === null) return null;
  return { h, E, N, id: num(v.id), in_trees: v.in_trees === true };
}

function parseEpochs(v: unknown): Array<[number, number]> {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is [number, number] => numTuple(e, 2) !== null) as Array<[number, number]>;
}

export function parsePlace(v: unknown): Place | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const name = str(v.name_de);
  if (!id || !name) return null; // contract: a place without string id / name_de is skipped
  const flags = strArr(v.flags);
  const cat = v.category === 'stadt' || v.category === 'dorf' ? v.category : null;
  return {
    id,
    name_de: name,
    kind: str(v.kind) ?? 'gemarkung',
    state: str(v.state) ?? '',
    municipality: str(v.municipality),
    category: cat,
    complete: v.complete !== false && !flags.includes('cut-by-aoi'),
    flags,
    suppressed: strArr(v.suppressed),
    lidar_epoch: num(v.lidar_epoch),
    lidar_epochs: parseEpochs(v.lidar_epochs),
    label: numTuple(v.label, 2) as [number, number] | null,
    bbox: numTuple(v.bbox, 4) as [number, number, number, number] | null,
    aoi_share_pct: num(v.aoi_share_pct),
    area_ha: num(v.area_ha),
    parcels: num(v.parcels),
    trees: num(v.trees),
    crown_ha: num(v.crown_ha),
    crown_pct: num(v.crown_pct),
    agb_t: range(v.agb_t),
    co2_t: range(v.co2_t),
    ortslage: parseOrtslage(v.ortslage),
    inhabitants: num(v.inhabitants),
    trees_per_inhabitant: num(v.trees_per_inhabitant),
    tallest: parseTallest(v.tallest),
    raw: v,
  };
}

export function parseMunicipality(v: unknown): Municipality | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const name = str(v.name_de);
  if (!id || !name) return null;
  const pv = isObj(v.pv)
    ? {
        as_of: str(v.pv.as_of),
        systems: num(v.pv.systems),
        kwp: num(v.pv.kwp),
        kwp_per_inhabitant: num(v.pv.kwp_per_inhabitant),
        small_systems: num(v.pv.small_systems),
      }
    : null;
  return { id, name_de: name, state: str(v.state) ?? '', places: strArr(v.places), inhabitants: num(v.inhabitants), pv, raw: v };
}

/** Parse `stats/places.json`; null when it is not an `sle-stats-v1` object (→ panel hidden). */
export function parsePlacesFile(v: unknown): PlacesData | null {
  if (!isObj(v) || v.format !== STATS_FORMAT) return null;
  const places = (Array.isArray(v.places) ? v.places : []).map(parsePlace).filter((p): p is Place => p !== null);
  const municipalities = (Array.isArray(v.municipalities) ? v.municipalities : [])
    .map(parseMunicipality)
    .filter((m): m is Municipality => m !== null);
  const disciplines = (Array.isArray(v.disciplines) ? v.disciplines : [])
    .map(parseDiscipline)
    .filter((d): d is Discipline => d !== null);
  const methodLabels: Record<string, string> = {};
  let rlpTreeRatio: number | null = null;
  if (isObj(v.method)) {
    for (const m of Object.values(v.method)) {
      if (isObj(m) && str(m.id) && str(m.label_de)) methodLabels[m.id as string] = m.label_de as string;
    }
    const crown = v.method.crown;
    const be = isObj(crown) && isObj(crown.params) ? crown.params.rlp_border_effect : null;
    if (isObj(be)) rlpTreeRatio = num(be.trees_per_ha_canopy_rlp_over_sl);
  }
  return {
    generated: str(v.generated) ?? '',
    label_de: str(v.label_de) ?? 'Orte im Vergleich',
    disclaimer_de: str(v.disclaimer_de) ?? '',
    attribution: str(v.attribution) ?? '',
    disciplines,
    places,
    municipalities,
    rlpTreeRatio,
    methodLabels,
  };
}

// ---- places.geojson -------------------------------------------------------------------------------

/** Outline rings per place id, EPSG:25832 `[E, N]` (outer rings and holes alike; drawn as lines). */
export type Outlines = Map<string, Array<Array<[number, number]>>>;

function ring(v: unknown): Array<[number, number]> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<[number, number]> = [];
  for (const p of v) {
    if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push([p[0] as number, p[1] as number]);
  }
  return out.length >= 3 ? out : null;
}

export function parseOutlines(fc: unknown): Outlines {
  const out: Outlines = new Map();
  if (!isObj(fc) || !Array.isArray(fc.features)) return out;
  for (const f of fc.features) {
    if (!isObj(f) || !isObj(f.properties) || !isObj(f.geometry)) continue;
    const id = str(f.properties.id);
    if (!id) continue;
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' && Array.isArray(g.coordinates) ? g.coordinates : [];
    const rings: Array<Array<[number, number]>> = out.get(id) ?? [];
    for (const poly of polys) {
      if (!Array.isArray(poly)) continue;
      for (const r of poly) {
        const rr = ring(r);
        if (rr) rings.push(rr);
      }
    }
    if (rings.length) out.set(id, rings);
  }
  return out;
}

// ---- ranking ----------------------------------------------------------------------------------------

/** Resolve a dotted path (`ortslage.green_pct`, `pv.kwp_per_inhabitant`) to a finite number or null. */
export function resolveMeasure(obj: unknown, path: string): number | null {
  if (!path) return null;
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (!isObj(cur)) return null;
    cur = cur[k];
  }
  return num(cur);
}

export interface BoardEntry<T> {
  item: T;
  value: number | null;
}

export interface RankedEntry<T> extends BoardEntry<T> {
  value: number;
  rank: number;
}

export interface Board<T> {
  discipline: Discipline;
  ranked: Array<RankedEntry<T>>;
  /** complete:false — listed below the board, unranked („unvollständig“). */
  incomplete: Array<BoardEntry<T>>;
  /** No finite value (suppressed / not available) — „keine Daten“, unranked. */
  noData: Array<BoardEntry<T>>;
}

const collator = new Intl.Collator('de');

/**
 * Contract ranking rule: entries of the discipline's scope whose `measure` is a finite number are
 * ranked (best first by `higher_is_better`); ties share a rank (1, 1, 3); places with
 * `complete: false` are listed unranked; null values show „keine Daten“. Names break ties for display.
 */
export function rankBoard<T extends { name_de: string; raw: Record<string, unknown>; complete?: boolean }>(
  discipline: Discipline,
  entries: readonly T[],
): Board<T> {
  const ranked: Array<RankedEntry<T>> = [];
  const incomplete: Array<BoardEntry<T>> = [];
  const noData: Array<BoardEntry<T>> = [];
  for (const item of entries) {
    const value = resolveMeasure(item.raw, discipline.measure);
    if (value === null) noData.push({ item, value });
    else if (item.complete === false) incomplete.push({ item, value });
    else ranked.push({ item, value, rank: 0 });
  }
  const dir = discipline.higher_is_better ? -1 : 1;
  ranked.sort((a, b) => (a.value - b.value) * dir || collator.compare(a.item.name_de, b.item.name_de));
  ranked.forEach((e, i) => {
    e.rank = i > 0 && ranked[i - 1].value === e.value ? ranked[i - 1].rank : i + 1;
  });
  const byName = (a: BoardEntry<T>, b: BoardEntry<T>) => collator.compare(a.item.name_de, b.item.name_de);
  incomplete.sort(byName);
  noData.sort(byName);
  return { discipline, ranked, incomplete, noData };
}

/** The entries a discipline ranks (by scope), or null for a discipline without a board. */
export function boardFor(data: PlacesData, d: Discipline): Board<Place> | Board<Municipality> | null {
  if (!d.ready || !d.measure) return null;
  return d.scope === 'municipality' ? rankBoard(d, data.municipalities) : rankBoard(d, data.places);
}

// ---- badges / formatting ------------------------------------------------------------------------------

const nf = (digits: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const NF0 = nf(0);
const NF1 = nf(1);
const NF2 = nf(2);

/** German number: whole numbers with thousands dots, else up to 1 (or 2 below 10) decimals. */
export function fmtNum(v: number | null | undefined, digits?: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  if (digits !== undefined) return nf(digits).format(v);
  if (Number.isInteger(v)) return NF0.format(v);
  return Math.abs(v) < 10 ? NF2.format(v) : NF1.format(v);
}

/** Value + unit for a board row („58,7 m“, „45,1 %“, „1,1 kWp/Einw.“). */
export function fmtValue(v: number | null, unit: string): string {
  if (v === null) return 'keine Daten';
  const n = fmtNum(v);
  return unit === '%' ? `${n} %` : unit ? `${n} ${unit}` : n;
}

/** An estimate range as „lo–hi“ with thousands dots (mid is not shown; G7). */
export function fmtRange(r: Range | null, unit = ''): string {
  if (!r) return '–';
  return `${fmtNum(r[0])}–${fmtNum(r[2])}${unit ? ` ${unit}` : ''}`;
}

/** `≈ ` prefix for values the pipeline extrapolated (flag `estimate`). */
export const approx = (p: Pick<Place, 'flags'>): string => (p.flags.includes('estimate') ? '≈ ' : '');

export interface Badge {
  key: string;
  text: string;
  title: string;
}

/** The older flight in `lidar_epochs` (the RLP 2022 tiles) and its share, or the place's own epoch. */
export function otherFlight(p: Pick<Place, 'lidar_epochs' | 'lidar_epoch'>): { year: number | null; pct: number | null } {
  if (p.lidar_epochs.length >= 2) {
    const oldest = [...p.lidar_epochs].sort((a, b) => a[0] - b[0])[0];
    return { year: oldest[0], pct: oldest[1] };
  }
  if (p.lidar_epochs.length === 1) return { year: p.lidar_epochs[0][0], pct: null };
  return { year: p.lidar_epoch, pct: null };
}

/** Explanation of the `other-flight` badge, with the measured RLP tree-count offset when known. */
export function otherFlightNote(p: Pick<Place, 'lidar_epochs' | 'lidar_epoch'>, rlpTreeRatio: number | null): string {
  const { year } = otherFlight(p);
  const parts = [`RLP-Befliegung${year ? ` ${year}` : ''}`];
  if (rlpTreeRatio !== null && rlpTreeRatio > 1) parts.push(`Bäume dort ≈ ${Math.round((rlpTreeRatio - 1) * 100)} % höher gezählt`);
  return parts.join(', ');
}

/** Badges of a place (list rows and the card): other flight, Stadt/Dorf, incomplete, estimate. */
export function placeBadges(p: Place, rlpTreeRatio: number | null): Badge[] {
  const out: Badge[] = [];
  if (p.category) {
    out.push({
      key: 'category',
      text: p.category === 'stadt' ? 'Stadt' : 'Dorf',
      title: p.category === 'stadt' ? 'Größenklasse: ab 5.000 Einwohnern (Zensus-Gitter)' : 'Größenklasse: unter 5.000 Einwohnern (Zensus-Gitter)',
    });
  }
  if (p.flags.includes('other-flight')) {
    const { year, pct } = otherFlight(p);
    const text = pct !== null && year ? `andere Befliegung: ${fmtNum(Math.round(pct))} % ${year}` : `andere Befliegung${year ? ` ${year}` : ''}`;
    out.push({ key: 'other-flight', text, title: otherFlightNote(p, rlpTreeRatio) });
  }
  if (!p.complete) out.push({ key: 'incomplete', text: 'unvollständig', title: 'Gemarkung nicht ganz erfasst: Summen sind Teilwerte' });
  if (p.flags.includes('estimate')) out.push({ key: 'estimate', text: 'hochgerechnet', title: 'Einzelne Werte hochgerechnet (≈)' });
  return out;
}

/** „Gemarkung Einöd“ (contract: places are labelled as Gemarkung, not Stadtteil). */
export function placeTitle(p: Pick<Place, 'name_de' | 'kind'>): string {
  return p.kind === 'gemarkung-group' ? `Gemarkungen ${p.name_de}` : `Gemarkung ${p.name_de}`;
}

/** Fly-to framing for a bbox (EPSG:25832): target point and an oblique view distance / height. */
export function frameBox(
  bbox: [number, number, number, number] | null,
  label: [number, number] | null,
): { E: number; N: number; dist: number; agl: number } | null {
  const c = label ?? (bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null);
  if (!c) return null;
  const span = bbox ? Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) : 2000;
  const dist = Math.min(4500, Math.max(600, span * 0.75));
  return { E: c[0], N: c[1], dist, agl: dist * 0.75 };
}

/** Union bbox of several places (a municipality's places in this file). */
export function unionBox(boxes: Array<[number, number, number, number] | null>): [number, number, number, number] | null {
  const bs = boxes.filter((b): b is [number, number, number, number] => !!b);
  if (!bs.length) return null;
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
}

/**
 * Camera pose for an oblique view of a point `lift` m above the ground at (E, N) (0: the ground; a crown
 * top: the tree height): `dist` m behind it along `headingDeg` and `agl` m above it. Phones: the „Orte“
 * bottom sheet covers the lower `cover` fraction of the view, so the camera keeps that pose (it ends
 * near the place, not kilometres back) and looks down more steeply, putting the point in the middle of
 * the visible part above the sheet (vertical FOV `vfovDeg`, depression ≤ 80°). The pose is absolute
 * (camera E/N, height above the target's ground), so no look-at point can fall outside the terrain.
 */
export function framedPose(
  E: number,
  N: number,
  headingDeg: number,
  dist: number,
  agl: number,
  cover: number,
  vfovDeg: number,
  lift = 0,
): { E: number; N: number; height: number; pitchDeg: number } {
  const d = Math.max(dist, 1e-6);
  const a = Math.max(agl, 1e-6);
  const c = Math.min(Math.max(cover, 0), 0.8);
  const up = c > 0 ? Math.atan(c * Math.tan((vfovDeg * Math.PI) / 360)) : 0; // angle above the screen centre
  const dep = Math.min(Math.atan2(a, d) + up, (80 * Math.PI) / 180);
  const h = (headingDeg * Math.PI) / 180;
  return { E: E - Math.sin(h) * d, N: N - Math.cos(h) * d, height: a + Math.max(lift, 0), pitchDeg: (-dep * 180) / Math.PI };
}

// ---- the 3D area (AOI) -------------------------------------------------------------------------------------

/** AOI rectangle in EPSG:25832 metres (`size` is in cells: × `cellSize`). */
export interface AoiRect {
  E0: number;
  N0: number;
  E1: number;
  N1: number;
}

export function aoiRect(m: { origin: { E0: number; N0: number }; size: { width: number; height: number }; cellSize: number }): AoiRect {
  const cs = m.cellSize > 0 ? m.cellSize : 1;
  return { E0: m.origin.E0, N0: m.origin.N0, E1: m.origin.E0 + m.size.width * cs, N1: m.origin.N0 + m.size.height * cs };
}

export const inAoiRect = (r: AoiRect, E: number, N: number): boolean => E >= r.E0 && E <= r.E1 && N >= r.N0 && N <= r.N1;

type Ring = ReadonlyArray<readonly [number, number]>;

/** Sutherland–Hodgman: the part of a ring inside an axis-aligned rectangle (open ring, may be empty). */
export function clipRingToRect(ring: Ring, r: AoiRect): Array<[number, number]> {
  let pts: Array<[number, number]> = ring.map(([E, N]) => [E, N]);
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  const edges: Array<[(p: readonly [number, number]) => boolean, (a: readonly [number, number], b: readonly [number, number]) => [number, number]]> = [
    [(p) => p[0] >= r.E0, (a, b) => [r.E0, a[1] + ((b[1] - a[1]) * (r.E0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= r.E1, (a, b) => [r.E1, a[1] + ((b[1] - a[1]) * (r.E1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= r.N0, (a, b) => [a[0] + ((b[0] - a[0]) * (r.N0 - a[1])) / (b[1] - a[1]), r.N0]],
    [(p) => p[1] <= r.N1, (a, b) => [a[0] + ((b[0] - a[0]) * (r.N1 - a[1])) / (b[1] - a[1]), r.N1]],
  ];
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const out: Array<[number, number]> = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cut(a, b));
    }
    pts = out;
  }
  return pts;
}

/** |area| (m²) and centroid of a ring (shoelace); centroid null for a degenerate ring. */
function ringArea(ring: Ring): { area: number; cE: number; cN: number } | null {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return null;
  return { area: Math.abs(a) / 2, cE: cx / (3 * a), cN: cy / (3 * a) };
}

/**
 * Where a place meets the 3D area: centroid and bbox of the outline's part inside the AOI and the
 * share of its area there (0–1). Rings count as areas (Gemarkung outlines have no holes worth
 * subtracting). null when no part lies inside.
 */
export function insideFocus(rings: ReadonlyArray<Ring>, r: AoiRect): { E: number; N: number; bbox: [number, number, number, number]; share: number } | null {
  let total = 0;
  let inArea = 0;
  let sE = 0;
  let sN = 0;
  const bb: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    const full = ringArea(ring);
    if (full) total += full.area;
    const part = clipRingToRect(ring, r);
    const a = part.length >= 3 ? ringArea(part) : null;
    if (!a) continue;
    inArea += a.area;
    sE += a.cE * a.area;
    sN += a.cN * a.area;
    for (const [E, N] of part) {
      bb[0] = Math.min(bb[0], E);
      bb[1] = Math.min(bb[1], N);
      bb[2] = Math.max(bb[2], E);
      bb[3] = Math.max(bb[3], N);
    }
  }
  if (!(inArea > 0)) return null;
  return { E: sE / inArea, N: sN / inArea, bbox: bb, share: total > 0 ? Math.min(1, inArea / total) : 1 };
}

/**
 * Text of a Riesenbaum pin in 3D: on narrow screens only the height („🌲 60,9 m“, the name is in
 * the tooltip and the card), so the label (≈ 70 px) stays clear of the minimap dial and the edges.
 */
export function giantPinText(p: Pick<Place, 'name_de'>, h: number, narrow: boolean): string {
  return narrow ? `🌲 ${fmtNum(h, 1)} m` : `🌲 Riesenbaum ${p.name_de}: ${fmtNum(h, 1)} m`;
}

// ---- 3D outline clipping ---------------------------------------------------------------------------------

/**
 * Clip a polyline (local frame, flat [x0, z0, x1, z1, …]) to an axis-aligned rectangle
 * (Liang–Barsky per segment). Returns the inside pieces as separate polylines. Used to drape a
 * Gemarkung outline only where the AOI has terrain (contract: 2D elsewhere, i.e. only on the map).
 */
export function clipPolyline(xz: ArrayLike<number>, xMin: number, xMax: number, zMin: number, zMax: number): number[][] {
  const out: number[][] = [];
  let cur: number[] | null = null;
  const n = xz.length / 2;
  for (let k = 0; k + 1 < n; k++) {
    const x0 = xz[2 * k];
    const z0 = xz[2 * k + 1];
    const dx = xz[2 * k + 2] - x0;
    const dz = xz[2 * k + 3] - z0;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [p, q] of [
      [-dx, x0 - xMin],
      [dx, xMax - x0],
      [-dz, z0 - zMin],
      [dz, zMax - z0],
    ] as const) {
      if (p === 0) {
        if (q < 0) ok = false;
        continue;
      }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
    if (!ok || t0 > t1) {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    const ax = x0 + t0 * dx;
    const az = z0 + t0 * dz;
    const bx = x0 + t1 * dx;
    const bz = z0 + t1 * dz;
    if (cur && t0 === 0) cur.push(bx, bz);
    else {
      if (cur) out.push(cur);
      cur = [ax, az, bx, bz];
    }
    if (t1 < 1) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.length >= 4 && (l[0] !== l[l.length - 2] || l[1] !== l[l.length - 1] || l.length > 4));
}
