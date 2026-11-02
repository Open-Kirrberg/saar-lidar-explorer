/**
 * Point-in-polygon parcel lookup on `vectors.flurstuecke.polygons` (contract: Polygon /
 * MultiPolygon per parcel, [E, N] EPSG:25832, not densified, not clipped; first ring = outer,
 * further rings = holes, winding not guaranteed; overlaps → first feature in file order).
 *
 * `buildParcelPolygons` packs the FeatureCollection into flat typed arrays (runs in the vector
 * worker, buffers are transferable); `ParcelPolygonIndex` adds a uniform grid over the parcel
 * bounding boxes and answers `find(E, N)`. Coordinates stay UTM in float64 (no float32 anywhere).
 * Pure: no three.js / DOM imports — unit-tested in tests/parcelPolygons.test.ts.
 */
import type { ParcelPolygonProps } from '../data/manifest';

export interface ParcelPolygonData {
  /** Interleaved E, N of every ring vertex (float64, UTM). */
  coords: Float64Array;
  /** Ring r spans vertices ringStart[r] … ringStart[r + 1] − 1 (length = rings + 1). */
  ringStart: Uint32Array;
  /** Polygon part p spans rings partStart[p] … partStart[p + 1] − 1; its first ring is the outer one. */
  partStart: Uint32Array;
  /** Feature f spans parts featStart[f] … featStart[f + 1] − 1. */
  featStart: Uint32Array;
  /** Per feature: minE, minN, maxE, maxN. */
  bbox: Float64Array;
  props: ParcelPolygonProps[];
  /** Features dropped (no usable geometry or no `text`). */
  skipped: number;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Untrusted properties → ParcelPolygonProps (null without a Flurnummer `text`). */
export function sanitizeParcelPolygonProps(p: Record<string, unknown> | null | undefined): ParcelPolygonProps | null {
  const q = p ?? {};
  const zae = str(q.zae);
  const nen = str(q.nen);
  const text = str(q.text) || (zae ? (nen ? `${zae}/${nen}` : zae) : '');
  if (!text) return null;
  const lage = str(q.lage);
  return {
    flstkennz: str(q.flstkennz),
    gemarkung: str(q.gemarkung),
    flur: str(q.flur),
    zae,
    ...(nen ? { nen } : {}),
    text,
    ...(lage ? { lage } : {}),
    ...(finite(q.flaeche_m2) && q.flaeche_m2 >= 0 ? { flaeche_m2: q.flaeche_m2 } : {}),
  };
}

/** Valid ring: ≥ 3 vertices with finite E, N (closing vertex optional). */
function ringOf(r: unknown): number[][] | null {
  if (!Array.isArray(r)) return null;
  const out: number[][] = [];
  for (const c of r) {
    if (!Array.isArray(c) || !finite(c[0]) || !finite(c[1])) return null;
    out.push([c[0], c[1]]);
  }
  return out.length >= 3 ? out : null;
}

/** Polygon (array of rings) → valid rings; null if the outer ring is unusable. Bad holes are dropped. */
function polygonOf(rings: unknown): number[][][] | null {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const outer = ringOf(rings[0]);
  if (!outer) return null;
  const out = [outer];
  for (let k = 1; k < rings.length; k++) {
    const h = ringOf(rings[k]);
    if (h) out.push(h);
  }
  return out;
}

/** FeatureCollection → packed arrays. Features without a usable (Multi)Polygon or `text` are skipped. */
export function buildParcelPolygons(fc: unknown): ParcelPolygonData {
  const feats = (fc as { features?: unknown })?.features;
  const coords: number[] = [];
  const ringStart: number[] = [0];
  const partStart: number[] = [0];
  const featStart: number[] = [0];
  const bbox: number[] = [];
  const props: ParcelPolygonProps[] = [];
  let skipped = 0;
  if (!Array.isArray(feats)) return pack();
  for (const f of feats as Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null }>) {
    const g = f?.geometry;
    const pr = sanitizeParcelPolygonProps(f?.properties);
    let polys: number[][][][] = [];
    if (g?.type === 'Polygon') {
      const p = polygonOf(g.coordinates);
      if (p) polys = [p];
    } else if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      for (const pc of g.coordinates) {
        const p = polygonOf(pc);
        if (p) polys.push(p);
      }
    }
    if (!pr || polys.length === 0) {
      skipped++;
      continue;
    }
    let minE = Infinity;
    let minN = Infinity;
    let maxE = -Infinity;
    let maxN = -Infinity;
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [E, N] of ring) {
          coords.push(E, N);
          if (E < minE) minE = E;
          if (E > maxE) maxE = E;
          if (N < minN) minN = N;
          if (N > maxN) maxN = N;
        }
        ringStart.push(coords.length / 2);
      }
      partStart.push(ringStart.length - 1);
    }
    featStart.push(partStart.length - 1);
    bbox.push(minE, minN, maxE, maxN);
    props.push(pr);
  }
  return pack();

  function pack(): ParcelPolygonData {
    return {
      coords: Float64Array.from(coords),
      ringStart: Uint32Array.from(ringStart),
      partStart: Uint32Array.from(partStart),
      featStart: Uint32Array.from(featStart),
      bbox: Float64Array.from(bbox),
      props,
      skipped,
    };
  }
}

/** Transferable buffers of the packed polygons (props are structured-cloned). */
export function parcelPolygonTransferables(d: ParcelPolygonData): ArrayBuffer[] {
  return [d.coords, d.ringStart, d.partStart, d.featStart, d.bbox].map((a) => a.buffer as ArrayBuffer);
}

/** Even–odd ray cast on ring r of the packed data (independent of winding and closing vertex). */
function inRing(d: ParcelPolygonData, r: number, E: number, N: number): boolean {
  const c = d.coords;
  const a = d.ringStart[r];
  const b = d.ringStart[r + 1];
  let inside = false;
  for (let i = a, j = b - 1; i < b; j = i++) {
    const ei = c[2 * i];
    const ni = c[2 * i + 1];
    const ej = c[2 * j];
    const nj = c[2 * j + 1];
    if (ni > N !== nj > N && E < ((ej - ei) * (N - ni)) / (nj - ni) + ei) inside = !inside;
  }
  return inside;
}

/** Is (E, N) inside feature f (any part: in the outer ring and in none of its holes)? */
export function featureContains(d: ParcelPolygonData, f: number, E: number, N: number): boolean {
  if (E < d.bbox[4 * f] || N < d.bbox[4 * f + 1] || E > d.bbox[4 * f + 2] || N > d.bbox[4 * f + 3]) return false;
  for (let p = d.featStart[f]; p < d.featStart[f + 1]; p++) {
    const r0 = d.partStart[p];
    const r1 = d.partStart[p + 1];
    if (!inRing(d, r0, E, N)) continue;
    let inHole = false;
    for (let r = r0 + 1; r < r1 && !inHole; r++) inHole = inRing(d, r, E, N);
    if (!inHole) return true;
  }
  return false;
}

/** Uniform grid over the parcel bounding boxes; `find` returns the first containing feature. */
export class ParcelPolygonIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly e0: number;
  private readonly n0: number;
  private readonly nx: number;
  private readonly ny: number;

  constructor(
    readonly data: ParcelPolygonData,
    readonly cellSize = 100,
  ) {
    const n = data.props.length;
    let e0 = Infinity;
    let n0 = Infinity;
    let e1 = -Infinity;
    let n1 = -Infinity;
    for (let f = 0; f < n; f++) {
      e0 = Math.min(e0, data.bbox[4 * f]);
      n0 = Math.min(n0, data.bbox[4 * f + 1]);
      e1 = Math.max(e1, data.bbox[4 * f + 2]);
      n1 = Math.max(n1, data.bbox[4 * f + 3]);
    }
    this.e0 = n ? e0 : 0;
    this.n0 = n ? n0 : 0;
    this.nx = n ? Math.floor((e1 - e0) / cellSize) + 1 : 0;
    this.ny = n ? Math.floor((n1 - n0) / cellSize) + 1 : 0;
    for (let f = 0; f < n; f++) {
      const [cx0, cy0] = this.cellOf(data.bbox[4 * f], data.bbox[4 * f + 1]);
      const [cx1, cy1] = this.cellOf(data.bbox[4 * f + 2], data.bbox[4 * f + 3]);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = cy * this.nx + cx;
          let c = this.cells.get(key);
          if (!c) this.cells.set(key, (c = []));
          c.push(f); // ascending f = file order
        }
      }
    }
  }

  get size(): number {
    return this.data.props.length;
  }

  private cellOf(E: number, N: number): [number, number] {
    return [Math.floor((E - this.e0) / this.cellSize), Math.floor((N - this.n0) / this.cellSize)];
  }

  /** Index of the first feature (file order) containing (E, N), or −1. */
  find(E: number, N: number): number {
    if (!Number.isFinite(E) || !Number.isFinite(N)) return -1;
    const [cx, cy] = this.cellOf(E, N);
    if (cx < 0 || cy < 0 || cx >= this.nx || cy >= this.ny) return -1;
    const c = this.cells.get(cy * this.nx + cx);
    if (!c) return -1;
    for (const f of c) if (featureContains(this.data, f, E, N)) return f;
    return -1;
  }

  /** Properties of the parcel containing (E, N), or null. */
  lookup(E: number, N: number): ParcelPolygonProps | null {
    const f = this.find(E, N);
    return f < 0 ? null : this.data.props[f];
  }
}
