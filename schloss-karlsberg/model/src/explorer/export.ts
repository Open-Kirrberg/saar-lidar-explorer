/**
 * Pure helpers for the explorer data product `sle-recon-v1` (docs/explorer-integration.md):
 * the light reconstruction layer the Saar LiDAR Explorer shows (buildings.glb + footprints.geojson + index.json).
 * No three.js runtime imports; scripts/export-explorer.ts does the geometry and the file writing.
 */
import { E0, N0 } from '../frame.ts';
import { pointInPolygon } from '../layout/geom.ts';
import type { Confidence, EN } from '../spec.ts';

export const RECON_FORMAT = 'sle-recon-v1';
export const RECON_ID = 'karlsberg1789';
/** Default castle viewer URL (dev server, package.json `dev`). */
export const VIEWER_URL = 'http://localhost:5260/';
/** How far the base skirts reach below the lowest 2025 DTM sample under a footprint (m). */
export const SKIRT_MARGIN = 0.5;
export const DISCLAIMER_DE = 'Hypothetische Rekonstruktion, kein Befund. Schauen, nicht graben.';

/** Per-vertex `_CONF` code: 0 = low, 1 = med, 2 = high. */
export function confCode(c: Confidence): 0 | 1 | 2 {
  return c === 'high' ? 2 : c === 'med' ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Terrain grids (viewer/public/terrain/meta.json layout: PixelIsArea, row 0 = north edge)
// ---------------------------------------------------------------------------------------------

export interface GridMeta {
  west: number;
  north: number;
  cell: number;
  cols: number;
  rows: number;
}

/** Bilinear sampler (local x, z) -> h over a float grid; NaN outside or on NaN/no-data cells. */
export function gridSampler(g: GridMeta, h: ArrayLike<number>): (x: number, z: number) => number {
  return (x, z) => {
    const c = (x + E0 - g.west) / g.cell - 0.5;
    const r = (g.north - (N0 - z)) / g.cell - 0.5;
    if (!(c >= 0 && r >= 0 && c <= g.cols - 1 && r <= g.rows - 1)) return NaN;
    const c0 = Math.min(g.cols - 2, Math.floor(c));
    const r0 = Math.min(g.rows - 2, Math.floor(r));
    const fc = c - c0;
    const fr = r - r0;
    const i = r0 * g.cols + c0;
    const a = h[i] + (h[i + 1] - h[i]) * fc;
    const b = h[i + g.cols] + (h[i + g.cols + 1] - h[i + g.cols]) * fc;
    return a + (b - a) * fr;
  };
}

/** Pointwise minimum of two samplers, ignoring NaN (NaN only if both are NaN). */
export function minSampler(a: (x: number, z: number) => number, b: (x: number, z: number) => number): (x: number, z: number) => number {
  return (x, z) => {
    const p = a(x, z);
    const q = b(x, z);
    if (Number.isNaN(p)) return q;
    if (Number.isNaN(q)) return p;
    return Math.min(p, q);
  };
}

/**
 * Lowest terrain height under an EN ring: the vertices, the edges every `step` m (on the ring and `band` m outside,
 * where a gap between wall and ground would show) and the interior on a `step` m grid. NaN if no sample is finite.
 */
export function minUnderRing(ring: readonly EN[], sample: (x: number, z: number) => number, step = 1, band = 1): number {
  let m = Infinity;
  const at = (E: number, N: number) => {
    const h = sample(E - E0, -(N - N0));
    if (Number.isFinite(h) && h < m) m = h;
  };
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  if (!pts.length) return NaN;
  // orientation: positive area = CCW -> outward normal is to the right of each edge
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const sgn = area >= 0 ? 1 : -1;
  for (let i = 0; i < pts.length; i++) {
    const [E1, N1] = pts[i];
    const [E2, N2] = pts[(i + 1) % pts.length];
    const len = Math.hypot(E2 - E1, N2 - N1);
    const nE = len > 0 ? (sgn * (N2 - N1)) / len : 0;
    const nN = len > 0 ? (-sgn * (E2 - E1)) / len : 0;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const E = E1 + ((E2 - E1) * k) / n;
      const N = N1 + ((N2 - N1) * k) / n;
      at(E, N);
      if (band > 0) at(E + nE * band, N + nN * band);
    }
  }
  let Emin = Infinity;
  let Emax = -Infinity;
  let Nmin = Infinity;
  let Nmax = -Infinity;
  for (const [E, N] of pts) {
    Emin = Math.min(Emin, E);
    Emax = Math.max(Emax, E);
    Nmin = Math.min(Nmin, N);
    Nmax = Math.max(Nmax, N);
  }
  for (let E = Math.ceil(Emin / step) * step; E <= Emax; E += step) {
    for (let N = Math.ceil(Nmin / step) * step; N <= Nmax; N += step) if (pointInPolygon([E, N], pts)) at(E, N);
  }
  return Number.isFinite(m) ? m : NaN;
}

/** Bottom of a base skirt: `margin` below the lowest 2025 terrain sample (NaN stays NaN). */
export function skirtBottom(minTerrain: number, margin = SKIRT_MARGIN): number {
  return Number.isFinite(minTerrain) ? minTerrain - margin : NaN;
}

/**
 * Vertical side walls of a prism over a local [x, z] ring from y0 to y1 (no caps): non-indexed triangles, flat
 * normals pointing away from the ring interior (either ring orientation). Returns empty arrays if y1 <= y0.
 */
export function skirtWalls(ringXZ: readonly [number, number][], y0: number, y1: number): { position: number[]; normal: number[] } {
  const position: number[] = [];
  const normal: number[] = [];
  if (!(y1 > y0) || ringXZ.length < 3) return { position, normal };
  const pts = ringXZ[0][0] === ringXZ[ringXZ.length - 1][0] && ringXZ[0][1] === ringXZ[ringXZ.length - 1][1] ? ringXZ.slice(0, -1) : ringXZ.slice();
  // area in the x/(-z) plane (= E/N orientation): positive = CCW seen from above
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p[0] * -q[1] - q[0] * -p[1];
  }
  const ccw = area >= 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    // CCW in E/N: outward = right of the edge = (dN, −dE) in E/N; with dE = dx, dN = −dz and z = −N
    // that is (x, z) = (−dz, dx)
    const s = ccw ? 1 : -1;
    const nx = (s * -dz) / len;
    const nz = (s * dx) / len;
    const A = [a[0], y0, a[1]];
    const B = [b[0], y0, b[1]];
    const C = [b[0], y1, b[1]];
    const D = [a[0], y1, a[1]];
    // wind the triangles counter-clockwise seen from outside: geometric normal of (A, B, C) = (B−A) × (C−A)
    const h = y1 - y0;
    const gx = -dz * h; // (dx, 0, dz) × (dx, h, dz) = (0·dz − dz·h, dz·dx − dx·dz, dx·h − 0·dx)
    const gz = dx * h;
    const quad = gx * nx + gz * nz >= 0 ? [A, B, C, A, C, D] : [A, C, B, A, D, C];
    for (const v of quad) {
      position.push(v[0], v[1], v[2]);
      normal.push(nx, 0, nz);
    }
  }
  return { position, normal };
}

// ---------------------------------------------------------------------------------------------
// index.json
// ---------------------------------------------------------------------------------------------

export interface ReconBuildingEntry {
  id: string;
  name_de: string;
  cls: string;
  confidence: Confidence;
  eaves_h: number;
  ridge_h: number;
  bbox_local: [[number, number, number], [number, number, number]];
  sources_de: string[];
}

export interface ReconIndex {
  format: typeof RECON_FORMAT;
  id: string;
  label_de: string;
  name_de: string;
  crs: 'EPSG:25832';
  heightDatum: 'DHHN2016';
  origin: { E0: number; N0: number };
  anchor: { E: number; N: number; enterRadius_m: number };
  bboxEN: [[number, number], [number, number]];
  files: { model: string; footprints: string };
  viewer: { url: string };
  attribution: string;
  disclaimer_de: string;
  generated: string;
  catalogueVersion: number;
  buildings: ReconBuildingEntry[];
}

export const round = (v: number, d: number): number => {
  const k = 10 ** d;
  return Math.round(v * k) / k + 0; // + 0 turns -0 into 0
};

/** Short German source labels (≤ max, ≤ 70 chars, no ';'), deduplicated, in catalogue order. */
export function shortSources(sources: readonly string[] | undefined, max = 3): string[] {
  const out: string[] = [];
  for (const raw of sources ?? []) {
    const s = raw.trim();
    let label: string;
    const research = /research\/(\d\d)/.exec(s);
    if (/^HMS|HMS 2022|Matzerath/.test(s) && !/research\/07/.test(s)) label = 'HMS/Matzerath 2022 (nur Maße, ©)';
    else if (/LP06|Lageplan/.test(s)) label = 'Lageplan 2006, schloss-carlsberg.de (CC BY-SA 2.0 DE)';
    else if (/Le Clerc/.test(s)) label = 'Le Clerc 1790, Ansicht (gemeinfrei)';
    else if (/^https?:\/\//.test(s)) {
      try {
        label = `Web: ${new URL(s).hostname.replace(/^www\./, '')}`;
      } catch {
        label = s;
      }
    } else if (research) label = `Recherche research/${research[1]}`;
    else label = s;
    label = label.replace(/;/g, ',').replace(/\s+/g, ' ').trim();
    if (label.length > 70) label = `${label.slice(0, 69).trimEnd()}…`;
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

/** One attribution string: entries joined by '; ' (';' inside an entry becomes ','). */
export function attributionString(entries: readonly string[]): string {
  return entries
    .map((e) => e.replace(/;/g, ',').trim())
    .filter(Boolean)
    .join('; ');
}

export const ATTRIBUTION_ENTRIES = [
  'Rekonstruktion Schloss Karlsberg 1789 (Hypothese): Teilprojekt schloss-karlsberg, Katalog v2 (research/01-08)',
  'Grundrisse teils nach Lageplan 2006, schloss-carlsberg.de (CC BY-SA 2.0 DE)',
  'Sockeltiefen: DGM1 GeoBasis-DE/LVGL-SL (2026), dl-de/by-2-0',
];

/** EN bounding box [[Emin, Nmin], [Emax, Nmax]] of local-frame boxes, rounded to 0.1 m. */
export function bboxENFromLocal(boxes: readonly [[number, number, number], [number, number, number]][]): [[number, number], [number, number]] {
  let Emin = Infinity;
  let Emax = -Infinity;
  let Nmin = Infinity;
  let Nmax = -Infinity;
  for (const [lo, hi] of boxes) {
    Emin = Math.min(Emin, lo[0] + E0);
    Emax = Math.max(Emax, hi[0] + E0);
    // z = -(N - N0): z max -> N min
    Nmin = Math.min(Nmin, N0 - hi[2]);
    Nmax = Math.max(Nmax, N0 - lo[2]);
  }
  return [
    [round(Math.floor(Emin * 10) / 10, 1), round(Math.floor(Nmin * 10) / 10, 1)],
    [round(Math.ceil(Emax * 10) / 10, 1), round(Math.ceil(Nmax * 10) / 10, 1)],
  ];
}

export interface IndexInput {
  anchorEN: EN;
  enterRadius_m?: number;
  buildings: ReconBuildingEntry[];
  /** Local boxes of everything in the glb (buildings + site nodes). */
  boxes: [[number, number, number], [number, number, number]][];
  generated: string;
  catalogueVersion: number;
  viewerUrl?: string;
}

export function buildReconIndex(i: IndexInput): ReconIndex {
  return {
    format: RECON_FORMAT,
    id: RECON_ID,
    label_de: 'Rekonstruktion 1789 (Hypothese)',
    name_de: 'Schloss Karlsberg – Rekonstruktion Sommer 1789',
    crs: 'EPSG:25832',
    heightDatum: 'DHHN2016',
    origin: { E0, N0 },
    anchor: { E: round(i.anchorEN[0], 1), N: round(i.anchorEN[1], 1), enterRadius_m: i.enterRadius_m ?? 300 },
    bboxEN: bboxENFromLocal(i.boxes),
    files: { model: 'buildings.glb', footprints: 'footprints.geojson' },
    viewer: { url: i.viewerUrl ?? VIEWER_URL },
    attribution: attributionString(ATTRIBUTION_ENTRIES),
    disclaimer_de: DISCLAIMER_DE,
    generated: i.generated,
    catalogueVersion: i.catalogueVersion,
    buildings: i.buildings,
  };
}

/** footprints.geojson (EPSG:25832, legacy `crs` member as the explorer's own GeoJSON files use). */
export function footprintsGeoJson(items: { id: string; name_de: string; confidence: Confidence; ring: readonly EN[] }[]): {
  type: 'FeatureCollection';
  crs: { type: 'name'; properties: { name: string } };
  features: { type: 'Feature'; properties: { id: string; name_de: string; confidence: Confidence }; geometry: { type: 'Polygon'; coordinates: number[][][] } }[];
} {
  return {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::25832' } },
    features: items.map((it) => {
      const ring = it.ring.map(([E, N]) => [round(E, 2), round(N, 2)]);
      const f = ring[0];
      const l = ring[ring.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
      return {
        type: 'Feature' as const,
        properties: { id: it.id, name_de: it.name_de, confidence: it.confidence },
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Position quantisation (KB-I62): int16 positions on one global grid + a node-local translation/scale
// ---------------------------------------------------------------------------------------------

/** Grid step of the quantised light-layer positions (m): 1/64 m → max rounding error 7.8 mm (≤ 1 cm). */
export const POSITION_STEP = 1 / 64;
/** Largest error a quantised position may have (m); nodes that cannot meet it stay float32. */
export const POSITION_MAX_ERROR = 0.01;

export interface QuantisedPositions {
  /** Non-normalised int16 VEC3 (KHR_mesh_quantization `SHORT`); world = offset + step · q. */
  q: Int16Array;
  /** Node translation (a multiple of `step`, so every node snaps to the same global grid). */
  offset: [number, number, number];
  /** Uniform node scale = grid step (m). */
  step: number;
  /** Largest |world − original| over all components (m). */
  maxError: number;
}

/**
 * Quantise local-frame positions to int16 on the grid `k · step` (k integer, shared by all nodes, so vertices that
 * coincide before export still coincide after it and abutting nodes cannot crack apart). The node offset is the
 * grid point nearest the bbox centre. Returns null when the node is too large for int16 at `step` (± 32767 steps)
 * or the error would exceed `maxError`; such a node keeps float32 positions.
 */
export function quantisePositions(pos: ArrayLike<number>, step = POSITION_STEP, maxError = POSITION_MAX_ERROR): QuantisedPositions | null {
  const n = pos.length / 3;
  if (!n) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[i + k]);
      hi[k] = Math.max(hi[k], pos[i + k]);
    }
  const offset = [0, 1, 2].map((k) => Math.round((lo[k] + hi[k]) / 2 / step) * step) as [number, number, number];
  const q = new Int16Array(n * 3);
  let err = 0;
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = Math.round((pos[i + k] - offset[k]) / step);
      if (v < -32767 || v > 32767) return null;
      q[i + k] = v;
      err = Math.max(err, Math.abs(offset[k] + v * step - pos[i + k]));
    }
  // float32 storage of the decoded value (three keeps positions in float32) adds < 0.1 mm at |x| < 3 km
  if (err > maxError) return null;
  return { q, offset, step, maxError: err };
}
