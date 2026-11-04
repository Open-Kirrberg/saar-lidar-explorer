/**
 * F15 relict candidates — pure logic (no three.js / DOM): parsing `candidates.geojson` per
 * docs/data-contract.md "Candidates", labels, filtering, N/P navigation order, outline geometry
 * for draping and the marker created when a candidate is confirmed.
 *
 * Candidates are HYPOTHESES from a rule-based detector, never findings ("Schauen, nicht graben").
 * Unit-tested in tests/candidates.test.ts.
 */
import {
  CANDIDATE_CLASSES,
  CANDIDATE_CLASS_LABELS_DE,
  CANDIDATE_KNOWN_PATH_LABEL_DE,
  isCandidateClass,
} from '../data/manifest';
import type { CandidateClass, CandidateDecision, CandidateMetrics, CandidateReviewStatus } from '../data/manifest';

/** One candidate, normalised; E/N/z in EPSG:25832 metres (z = baked true height or NaN). */
export interface Candidate {
  id: string;
  cls: CandidateClass;
  score: number;
  E: number;
  N: number;
  z: number;
  metrics: CandidateMetrics;
  reasons: string[];
  forest: boolean;
  /** Any OSM feature within 5 m (informative). */
  nearPath: boolean;
  /** Linear ≥ 50 % along an OSM road/track/path (contract `along_path`) → known path. */
  alongPath: boolean;
  nearKnown: string | null;
  /** Outline parts (Polygon exterior ring or LineString), positions [E, N] or [E, N, z]. */
  outline?: { type: 'Polygon' | 'LineString'; coords: number[][] };
  /** Optional (saar-lidar-detect, informative): detector + rule-set version. */
  methodVersion?: string;
  /** Optional (informative): ISO year of the terrain data, e.g. '2025'. */
  dataDate?: string;
}

export interface ParseResult {
  candidates: Candidate[];
  skipped: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPos = (p: unknown): p is number[] => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]);

function parseOutline(o: unknown): Candidate['outline'] {
  const g = o as { type?: unknown; coordinates?: unknown } | null;
  if (!g || typeof g !== 'object' || !Array.isArray(g.coordinates)) return undefined;
  let ring: unknown[] | undefined;
  if (g.type === 'Polygon') ring = Array.isArray(g.coordinates[0]) ? (g.coordinates[0] as unknown[]) : undefined;
  else if (g.type === 'LineString') ring = g.coordinates;
  if (!ring) return undefined;
  const coords = ring.filter(isPos).map((p) => (p.length >= 3 && finite(p[2]) ? [p[0], p[1], p[2]] : [p[0], p[1]]));
  if (coords.length < 2) return undefined;
  return { type: g.type as 'Polygon' | 'LineString', coords };
}

/**
 * Tolerant parse of a candidates FeatureCollection. Skips features with an unknown class, a
 * non-Point geometry or a non-finite score; fills defaults (reasons [], booleans false,
 * near_known null). Missing/duplicate ids get a stable id from class + rounded position.
 * Classes outside the allow-list (`CANDIDATE_CLASSES`) are skipped in every build;
 * `method_version` and `data_date` are optional extras.
 * Result is sorted by score descending (ties: id).
 */
export function parseCandidateCollection(fc: unknown): ParseResult {
  const feats = (fc as { features?: unknown })?.features;
  if (!Array.isArray(feats)) return { candidates: [], skipped: 0 };
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const f of feats as Array<{ geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> }>) {
    const p = f?.properties ?? {};
    const g = f?.geometry;
    const cls = p.class;
    const score = p.score;
    if (!isCandidateClass(cls) || !finite(score) || g?.type !== 'Point' || !isPos(g.coordinates)) {
      skipped++;
      continue;
    }
    const c = g.coordinates;
    const E = c[0];
    const N = c[1];
    let id = typeof p.id === 'string' && p.id ? p.id : `${cls}-${Math.round(E)}-${Math.round(N)}`;
    if (seen.has(id)) {
      let k = 2;
      while (seen.has(`${id}-${k}`)) k++;
      id = `${id}-${k}`;
    }
    seen.add(id);
    const metrics: CandidateMetrics = {};
    if (p.metrics && typeof p.metrics === 'object' && !Array.isArray(p.metrics)) {
      for (const [k, v] of Object.entries(p.metrics as Record<string, unknown>)) if (finite(v)) metrics[k] = v;
    }
    const outline = parseOutline(p.outline);
    out.push({
      id,
      cls,
      score: Math.min(1, Math.max(0, score)),
      E,
      N,
      z: c.length >= 3 && finite(c[2]) ? c[2] : NaN,
      metrics,
      reasons: Array.isArray(p.reasons) ? p.reasons.filter((r): r is string => typeof r === 'string' && r.length > 0) : [],
      forest: p.forest === true,
      nearPath: p.near_path === true,
      alongPath: cls === 'linear' && p.along_path === true,
      nearKnown: typeof p.near_known === 'string' && p.near_known ? p.near_known : null,
      ...(outline ? { outline } : {}),
      ...(typeof p.method_version === 'string' && p.method_version ? { methodVersion: p.method_version } : {}),
      ...(typeof p.data_date === 'string' && p.data_date ? { dataDate: p.data_date } : {}),
    });
  }
  out.sort(byScore);
  return { candidates: out, skipped };
}

/** Score descending, then id ascending (deterministic). */
export function byScore(a: Candidate, b: Candidate): number {
  return b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Known path ("Weg (bekannt)"): a linear candidate running ≥ 50 % along an OSM road/track/path (`along_path`). */
export const isKnownPath = (c: Pick<Candidate, 'cls' | 'alongPath'>): boolean => c.cls === 'linear' && c.alongPath;

/** German display label: manifest class label, `Weg (bekannt)` for linear candidates on a known path. */
export function candidateLabel(c: Pick<Candidate, 'cls' | 'alongPath'>, classes: Record<CandidateClass, string> = CANDIDATE_CLASS_LABELS_DE): string {
  if (isKnownPath(c)) return CANDIDATE_KNOWN_PATH_LABEL_DE;
  return classes[c.cls] ?? CANDIDATE_CLASS_LABELS_DE[c.cls];
}

// ---- filtering / navigation -------------------------------------------------------------------

export interface CandidateFilter {
  classes: Record<CandidateClass, boolean>;
  /** Separate switch for known paths (`linear` + `along_path`, "Weg (bekannt)"). */
  knownPaths: boolean;
  /** Min score. */
  minScore: number;
  showRejected: boolean;
  /** Only candidates without a decision. */
  onlyOpen: boolean;
}

export const defaultFilter = (minScore = 0.3): CandidateFilter => ({
  classes: Object.fromEntries(CANDIDATE_CLASSES.map((c) => [c, true])) as Record<CandidateClass, boolean>,
  knownPaths: true,
  minScore,
  showRejected: false,
  onlyOpen: false,
});

/** Normalise an untrusted (stored) filter object onto the defaults. */
export function sanitizeFilter(x: unknown, base: CandidateFilter = defaultFilter()): CandidateFilter {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const cl = (o.classes && typeof o.classes === 'object' ? o.classes : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    classes: Object.fromEntries(CANDIDATE_CLASSES.map((c) => [c, bool(cl[c], base.classes[c])])) as Record<CandidateClass, boolean>,
    knownPaths: bool(o.knownPaths, base.knownPaths),
    minScore: finite(o.minScore) ? Math.min(1, Math.max(0, o.minScore)) : base.minScore,
    showRejected: bool(o.showRejected, base.showRejected),
    onlyOpen: bool(o.onlyOpen, base.onlyOpen),
  };
}

export type DecisionLookup = (id: string) => CandidateReviewStatus | undefined;

export function passesFilter(c: Candidate, f: CandidateFilter, status?: CandidateReviewStatus): boolean {
  if (!f.classes[c.cls]) return false;
  if (isKnownPath(c) && !f.knownPaths) return false;
  if (c.score < f.minScore - 1e-9) return false;
  if (status === 'rejected' && !f.showRejected) return false;
  if (f.onlyOpen && status !== undefined) return false;
  return true;
}

/** Visible candidates in navigation order (score descending; input order is kept for ties). */
export function filterCandidates(list: readonly Candidate[], f: CandidateFilter, statusOf: DecisionLookup = () => undefined): Candidate[] {
  return list.filter((c) => passesFilter(c, f, statusOf(c.id))).sort(byScore);
}

/** Per-class counts of a list (all classes present, 0 if none) + `known` = linear on known paths. */
export function countByClass(list: readonly Candidate[]): Record<CandidateClass | 'known', number> {
  const out = Object.fromEntries([...CANDIDATE_CLASSES, 'known'].map((c) => [c, 0])) as Record<CandidateClass | 'known', number>;
  for (const c of list) {
    out[c.cls]++;
    if (isKnownPath(c)) out.known++;
  }
  return out;
}

/**
 * Next (+1) / previous (−1) candidate id in `order`, wrapping around. With no current id (or one
 * no longer in the order, e.g. filtered out) it continues from the candidate that would follow it
 * by score, so N after hiding the current one does not jump back to the top.
 */
export function stepCandidate(order: readonly Candidate[], currentId: string | null, dir: 1 | -1, current?: Candidate): string | null {
  const n = order.length;
  if (n === 0) return null;
  const i = currentId ? order.findIndex((c) => c.id === currentId) : -1;
  if (i >= 0) return order[(i + dir + n) % n].id;
  if (current) {
    // Insert position of the vanished current candidate in score order.
    let k = order.findIndex((c) => byScore(current, c) < 0);
    if (k < 0) k = n;
    return dir > 0 ? order[k % n].id : order[(k - 1 + n) % n].id;
  }
  return dir > 0 ? order[0].id : order[n - 1].id;
}

// ---- geometry -----------------------------------------------------------------------------------

/** Max segment length (m) of draped outlines (contract: ≤ 2 m). */
export const OUTLINE_MAX_SEG = 2;
/** Fallback circle diameter when a candidate has neither outline nor `diameter_m`. */
export const FALLBACK_DIAMETER_M = 5;

/**
 * Outline as a polyline of [E, N, z] positions (z NaN when not baked), densified to ≤ maxSeg:
 * the file's outline if present, else a closed circle of `diameter_m` (fallback 5 m).
 */
export function outlinePositions(c: Candidate, maxSeg = OUTLINE_MAX_SEG): number[][] {
  let pts: number[][];
  if (c.outline) {
    pts = c.outline.coords.map((p) => [p[0], p[1], p.length >= 3 ? p[2] : NaN]);
    if (c.outline.type === 'Polygon') {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) pts.push([...a]);
    }
  } else {
    const d = finite(c.metrics.diameter_m) && c.metrics.diameter_m > 0 ? c.metrics.diameter_m : FALLBACK_DIAMETER_M;
    const r = d / 2;
    const n = Math.max(12, Math.ceil((2 * Math.PI * r) / (maxSeg * 0.95)));
    pts = [];
    for (let k = 0; k <= n; k++) {
      const a = (2 * Math.PI * (k % n)) / n;
      pts.push([c.E + r * Math.cos(a), c.N + r * Math.sin(a), NaN]);
    }
    return pts;
  }
  // Densify (the contract asks the pipeline for ≤ 2 m already; this guards older/other files).
  const out: number[][] = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0, h0] = pts[k - 1];
    const [x1, y1, h1] = pts[k];
    const m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxSeg - 1e-9));
    for (let s = 1; s <= m; s++) {
      const t = s / m;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, h0 + (h1 - h0) * t]);
    }
  }
  return out;
}

/** Rough radius (m) of a candidate, for fly-to distances and minimap circle sizes. */
export function candidateRadius(c: Candidate): number {
  const m = c.metrics;
  if (finite(m.diameter_m) && m.diameter_m > 0) return m.diameter_m / 2;
  if (finite(m.length_m) && m.length_m > 0) return m.length_m / 2;
  if (finite(m.area_m2) && m.area_m2 > 0) return Math.sqrt(m.area_m2 / Math.PI);
  // Polygon outline: its farthest vertex, else an area in hectares.
  if (c.outline?.type === 'Polygon') {
    let r2 = 0;
    for (const p of c.outline.coords) r2 = Math.max(r2, (p[0] - c.E) ** 2 + (p[1] - c.N) ** 2);
    if (r2 > 0) return Math.sqrt(r2);
  }
  return FALLBACK_DIAMETER_M / 2;
}

/** Horizontal fly-to distance (m) for a candidate: close for small ones, farther for large ones. */
export function flyDistance(c: Candidate): number {
  return Math.min(160, Math.max(45, candidateRadius(c) * 4));
}

// ---- formatting + marker -----------------------------------------------------------------------

const fmtDe = (v: number, d: number) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

const METRIC_LABELS: Array<[keyof CandidateMetrics & string, string, string, number]> = [
  ['depth_m', 'Tiefe', 'm', 2],
  ['height_m', 'Höhe', 'm', 2],
  ['diameter_m', 'Durchmesser', 'm', 1],
  ['length_m', 'Länge', 'm', 1],
  ['width_m', 'Breite', 'm', 1],
  ['area_m2', 'Fläche', 'm²', 0],
  ['circularity', 'Rundheit', '', 2],
  ['rectangularity', 'Rechteckigkeit', '', 2],
  ['orientation_deg', 'Ausrichtung', '°', 0],
  ['slope_in_deg', 'Neigung innen', '°', 1],
  ['rim_m', 'Randwall', 'm', 2],
];

/** German metric rows [label, value] for the detail view (known metrics only, in a fixed order). */
export function formatMetrics(m: CandidateMetrics): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, label, unit, d] of METRIC_LABELS) {
    const v = m[k];
    if (!finite(v)) continue;
    out.push([label, `${fmtDe(v, d)}${unit === '°' ? unit : unit ? ` ${unit}` : ''}`]);
  }
  return out;
}

export const formatScore = (s: number): string => fmtDe(s, 2);

/** Marker category (markerStore MARKER_CATEGORIES) for a confirmed candidate. */
export function markerCategoryFor(c: Pick<Candidate, 'cls' | 'alongPath'>): 'Grube/Trichter' | 'Hügel' | 'Graben' | 'Weg' | 'Gebäude' | 'Sonstiges' {
  switch (c.cls) {
    case 'pit':
      return 'Grube/Trichter';
    case 'mound':
      return 'Hügel';
    case 'linear':
      return c.alongPath ? 'Weg' : 'Graben';
    case 'rect':
      return 'Gebäude';
    default:
      return 'Sonstiges';
  }
}

export interface DetectorInfo {
  method: string;
  version: number;
}

/** Title + note of the private marker created by "bestätigen" (category from class, reasons in the note). */
/** First words of the note of a marker created by confirming candidate `id` (used to find it again). */
const candidateMarkerTag = (id: string): string => `Bestätigter Kandidat ${id} –`;

export function markerTextFor(c: Candidate, label: string, info?: DetectorInfo): { title: string; note: string } {
  const lines = [
    `${candidateMarkerTag(c.id)} ${label}, Score ${formatScore(c.score)}.`,
    ...(c.reasons.length ? [`Gründe: ${c.reasons.join('; ')}.`] : []),
    ...(formatMetrics(c.metrics).length ? [`Maße: ${formatMetrics(c.metrics).map(([k, v]) => `${k} ${v}`).join(', ')}.`] : []),
    ...(c.nearKnown ? [`Nahe bekanntem Ort: ${c.nearKnown}.`] : []),
    `Hypothese aus automatischer Reliefanalyse${c.methodVersion ? ` (${c.methodVersion})` : info?.method ? ` (${info.method} v${info.version})` : ''} – Schauen, nicht graben.`,
  ];
  return { title: `${label} (Kandidat)`, note: lines.join('\n') };
}

/**
 * Marker already created for candidate `id`, if it still exists: the decision's `markerId`, else a
 * marker whose note starts with this candidate's tag (a reset decision drops `markerId` but the
 * private marker stays) — so confirm → reset → confirm does not create a duplicate.
 */
export function existingCandidateMarkerId(
  id: string,
  markerId: string | undefined,
  markers: readonly { id: string; note: string }[],
): string | undefined {
  if (markerId && markers.some((m) => m.id === markerId)) return markerId;
  const tag = candidateMarkerTag(id);
  return markers.find((m) => typeof m.note === 'string' && m.note.startsWith(tag))?.id;
}

/** Default min-score filter: the detector's write threshold (`params.min_score`), not the mask's. */
export function defaultMinScore(params: Record<string, unknown> | undefined): number {
  const v = params?.min_score;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.3;
}

/** Status → short German label. */
export const STATUS_LABELS_DE: Readonly<Record<CandidateReviewStatus, string>> = {
  confirmed: 'bestätigt',
  rejected: 'verworfen',
  unsure: 'unsicher',
};

/** Decision record for a candidate (contract "Review decisions"). */
export function decisionFor(c: Candidate, status: CandidateReviewStatus, now: Date, markerId?: string): CandidateDecision {
  return {
    status,
    at: now.toISOString(),
    class: c.cls,
    E: Math.round(c.E * 100) / 100,
    N: Math.round(c.N * 100) / 100,
    score: c.score,
    ...(markerId ? { markerId } : {}),
  };
}
