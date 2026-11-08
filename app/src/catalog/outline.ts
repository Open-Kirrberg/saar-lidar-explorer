/**
 * Outline of a catalog place for the minimap (S2): the boundary of the union of its owned 1 km
 * tiles (catalog `tiles` bitmap), as closed rings in EPSG:25832, plus a label point. Pure.
 */
import type { Bitmap } from '../data/globalGrid';
import { TILE_M } from '../data/globalGrid';

export type EN = [number, number];

/**
 * Closed rings (first point repeated at the end) around the set tiles. Each ring runs clockwise
 * (interior on the right) around outer boundaries and counter-clockwise around holes. Collinear
 * vertices are removed. Tiles touching only at a corner give separate rings.
 */
export function tileOutlineRings(bbox: readonly [number, number, number, number], tiles: Bitmap): EN[][] {
  const { w, h, cells } = tiles;
  const on = (c: number, r: number) => c >= 0 && r >= 0 && c < w && r < h && cells[r * w + c] === 1;
  // Grid vertex (x, y): x = column line 0…w (west → east), y = row line 0…h (north → south).
  const id = (x: number, y: number) => y * (w + 1) + x;
  const next = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const l = next.get(a);
    if (l) l.push(b);
    else next.set(a, [b]);
  };
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!on(c, r)) continue;
      // Clockwise in map view (north up): N edge west→east, E edge north→south, S edge east→west, W edge south→north.
      if (!on(c, r - 1)) add(id(c, r), id(c + 1, r));
      if (!on(c + 1, r)) add(id(c + 1, r), id(c + 1, r + 1));
      if (!on(c, r + 1)) add(id(c + 1, r + 1), id(c, r + 1));
      if (!on(c - 1, r)) add(id(c, r + 1), id(c, r));
    }
  }
  const toEN = (v: number): EN => {
    const x = v % (w + 1);
    const y = Math.floor(v / (w + 1));
    return [bbox[0] + x * TILE_M, bbox[3] - y * TILE_M];
  };
  const rings: EN[][] = [];
  for (const start of [...next.keys()].sort((a, b) => a - b)) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const verts: number[] = [start];
      let cur = start;
      for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
        const l = next.get(cur)!;
        const nxt = l.shift()!;
        cur = nxt;
        if (cur === start) break;
        verts.push(cur);
        if (!next.get(cur)?.length) break; // malformed (should not happen)
      }
      const pts = verts.map(toEN);
      rings.push(simplify(pts));
    }
  }
  return rings;
}

/** Drop collinear vertices of a closed ring (input without the closing point) and close it. */
function simplify(pts: EN[]): EN[] {
  const n = pts.length;
  const out: EN[] = [];
  for (let k = 0; k < n; k++) {
    const a = pts[(k - 1 + n) % n];
    const b = pts[k];
    const c = pts[(k + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  if (out.length) out.push(out[0]);
  return out;
}

/** Label point: centre of the set tile closest to the mean of all set tile centres. */
export function tileLabelPoint(bbox: readonly [number, number, number, number], tiles: Bitmap): EN | null {
  const { w, h, cells } = tiles;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (cells[r * w + c]) { sx += c + 0.5; sy += r + 0.5; n++; }
  if (!n) return null;
  const mx = sx / n;
  const my = sy / n;
  let best: EN | null = null;
  let bd = Infinity;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!cells[r * w + c]) continue;
      const d = (c + 0.5 - mx) ** 2 + (r + 0.5 - my) ** 2;
      if (d < bd) {
        bd = d;
        best = [bbox[0] + (c + 0.5) * TILE_M, bbox[3] - (r + 0.5) * TILE_M];
      }
    }
  }
  return best;
}
