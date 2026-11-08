/**
 * v3 vectors (S2, contract "Many places", rule for `flurstuecke.lines: 'derived'` and
 * `osm.densified: false`), pure part:
 * - `polygonEdgeLines`: parcel boundary lines derived from the polygons file — every ring segment,
 *   each undirected segment (endpoints rounded to 0.01 m) once, chained into runs per ring.
 * - `clipLinesToTiles`: cut lines exactly at the tile grid and keep the pieces inside present tiles
 *   (the union of a place's tiles), so neighbouring places never draw a boundary twice.
 * Lines are in the local world frame (x = E − E0, z = −(N − N0), float64). No three / DOM.
 */
import { densifyLine, toLocal } from './drape';
import type { LocalLine, Origin } from './drape';

/** Present-tile clip in the local frame: tile (c, r) covers x ∈ [x0 + c·size, …), z ∈ [zTop + r·size, …), row 0 north. */
export interface TileClip {
  x0: number;
  zTop: number;
  size: number;
  w: number;
  h: number;
  /** Row-major, 1 = present (a decoded presence / tiles bitmap). */
  cells: Uint8Array;
}

type Pos = number[];
const isPos = (p: unknown): p is Pos => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

function ringsOf(g: { type?: string; coordinates?: unknown } | null | undefined): Pos[][] {
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === 'Polygon') return g.coordinates as Pos[][];
  if (g.type === 'MultiPolygon') return (g.coordinates as Pos[][][]).flat();
  return [];
}

/**
 * Polygon FeatureCollection → boundary lines (not densified). Each undirected segment, with its
 * endpoints rounded to 0.01 m, is emitted once; consecutive new segments of a ring form one line.
 */
export function polygonEdgeLines(fc: unknown, origin: Origin, style: number): LocalLine[] {
  const feats = (fc as { features?: unknown })?.features;
  if (!Array.isArray(feats)) return [];
  const seen = new Set<string>();
  const out: LocalLine[] = [];
  const cm = (v: number) => Math.round(v * 100);
  for (const f of feats as Array<{ geometry?: { type?: string; coordinates?: unknown } | null }>) {
    for (const ring of ringsOf(f?.geometry)) {
      if (!Array.isArray(ring)) continue;
      let run: number[] = [];
      const flush = () => {
        if (run.length >= 4) out.push({ xz: Float64Array.from(run), style });
        run = [];
      };
      let prev: [number, number] | null = null;
      for (const p of ring) {
        if (!isPos(p)) continue;
        const cur: [number, number] = [cm(p[0]), cm(p[1])];
        if (prev && (prev[0] !== cur[0] || prev[1] !== cur[1])) {
          const a = `${prev[0]},${prev[1]}`;
          const b = `${cur[0]},${cur[1]}`;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (seen.has(key)) flush();
          else {
            seen.add(key);
            if (run.length === 0) {
              const l = toLocal(prev[0] / 100, prev[1] / 100, origin);
              run.push(l.x, l.z);
            }
            const l = toLocal(cur[0] / 100, cur[1] / 100, origin);
            run.push(l.x, l.z);
          }
        }
        prev = cur;
      }
      flush();
    }
  }
  return out;
}

function tileOn(c: TileClip, x: number, z: number): boolean {
  const col = Math.floor((x - c.x0) / c.size);
  const row = Math.floor((z - c.zTop) / c.size);
  return col >= 0 && row >= 0 && col < c.w && row < c.h && c.cells[row * c.w + col] === 1;
}

/**
 * Cut every line at the tile grid lines (exact intersection points) and keep the pieces whose
 * midpoint lies in a present tile. A line crossing out and back in becomes several lines.
 */
export function clipLinesToTiles(lines: LocalLine[], clip: TileClip): LocalLine[] {
  const out: LocalLine[] = [];
  const ts: number[] = [];
  for (const l of lines) {
    const n = l.xz.length / 2;
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 4) out.push({ xz: Float64Array.from(run), style: l.style });
      run = [];
    };
    for (let k = 0; k + 1 < n; k++) {
      const x0 = l.xz[2 * k];
      const z0 = l.xz[2 * k + 1];
      const x1 = l.xz[2 * k + 2];
      const z1 = l.xz[2 * k + 3];
      // Parameters where the segment crosses a vertical (x) or horizontal (z) grid line.
      ts.length = 0;
      ts.push(0);
      const cross = (a0: number, a1: number, base: number) => {
        if (a0 === a1) return;
        const lo = Math.min(a0, a1);
        const hi = Math.max(a0, a1);
        for (let g = Math.ceil((lo - base) / clip.size) * clip.size + base; g < hi; g += clip.size) {
          if (g > lo) ts.push((g - a0) / (a1 - a0));
        }
      };
      cross(x0, x1, clip.x0);
      cross(z0, z1, clip.zTop);
      ts.push(1);
      ts.sort((a, b) => a - b);
      for (let s = 0; s + 1 < ts.length; s++) {
        const ta = ts[s];
        const tb = ts[s + 1];
        if (tb - ta <= 1e-12) continue;
        const tm = (ta + tb) / 2;
        const xa = x0 + (x1 - x0) * ta;
        const za = z0 + (z1 - z0) * ta;
        const xb = x0 + (x1 - x0) * tb;
        const zb = z0 + (z1 - z0) * tb;
        if (tileOn(clip, x0 + (x1 - x0) * tm, z0 + (z1 - z0) * tm)) {
          if (run.length === 0) run.push(xa, za);
          run.push(xb, zb);
        } else flush();
      }
    }
    flush();
  }
  return out;
}

/** Densify every line to ≤ `maxSeg` m (linear in the local frame). */
export function densifyLines(lines: LocalLine[], maxSeg = 2): LocalLine[] {
  return lines.map((l) => ({ xz: Float64Array.from(densifyLine(l.xz, maxSeg)), style: l.style }));
}

/** A place's present tiles (v3 `presence` at tile resolution, or the catalog `tiles`) as a clip in `origin`'s frame. */
export function tileClipFor(
  bbox: { E0: number; N0: number; H: number },
  bitmap: { w: number; h: number; cells: Uint8Array },
  origin: Origin,
  size = 1000,
): TileClip {
  const nw = toLocal(bbox.E0, bbox.N0 + bbox.H, origin);
  return { x0: nw.x, zTop: nw.z, size, w: bitmap.w, h: bitmap.h, cells: bitmap.cells };
}
