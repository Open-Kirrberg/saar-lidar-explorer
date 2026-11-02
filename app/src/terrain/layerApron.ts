/**
 * Pure: 1-texel apron for u8 layer textures (seam fix). Layer images have no apron (contract), so a
 * chunk's texture alone can only clamp in the outer half texel: bilinear sampling then shows a flat
 * 0.5-cell band on both sides of every chunk edge and a step at the edge — the "faint line" along
 * chunk borders. Copying the neighbours' edge texels into a (n+2)² texture lets the shader
 * interpolate across the border exactly like inside the chunk (UV: (p + 0.5) / (n + 2) at height
 * pixel p). Missing neighbours (not resident, AOI edge) fall back to the chunk's own edge (clamp).
 */

/** The 8 neighbours (di, dj); bit k of a mask = APRON_NEIGHBOURS[k]. +i = east, +j = south (row order). */
export const APRON_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * Build the (n+2)² apron image of an n×n chunk layer `own` (row 0 = north). `neighbour(di, dj)`
 * returns that neighbour's n×n data of the same layer and level, or undefined. Returns the image
 * and the mask of neighbours that were used.
 */
export function buildLayerApron(
  own: Uint8Array,
  n: number,
  neighbour: (di: number, dj: number) => Uint8Array | undefined,
  out: Uint8Array = new Uint8Array((n + 2) * (n + 2)),
): { data: Uint8Array; mask: number } {
  if (own.length !== n * n) throw new Error(`layer apron: ${own.length} texels, expected ${n * n}`);
  const S = n + 2;
  for (let r = 0; r < n; r++) out.set(own.subarray(r * n, r * n + n), (r + 1) * S + 1);
  let mask = 0;
  const nb: Array<Uint8Array | undefined> = APRON_NEIGHBOURS.map(([di, dj], k) => {
    const d = neighbour(di, dj);
    if (d && d.length === n * n) {
      mask |= 1 << k;
      return d;
    }
    return undefined;
  });
  const [nw, north, ne, west, east, sw, south, se] = nb;
  // Edges.
  for (let c = 0; c < n; c++) {
    out[c + 1] = north ? north[(n - 1) * n + c] : own[c];
    out[(S - 1) * S + c + 1] = south ? south[c] : own[(n - 1) * n + c];
  }
  for (let r = 0; r < n; r++) {
    out[(r + 1) * S] = west ? west[r * n + n - 1] : own[r * n];
    out[(r + 1) * S + S - 1] = east ? east[r * n] : own[r * n + n - 1];
  }
  // Corners: diagonal neighbour, else the adjacent apron edge texel (= clamp when that is missing too).
  out[0] = nw ? nw[n * n - 1] : out[1];
  out[S - 1] = ne ? ne[(n - 1) * n] : out[S - 2];
  out[(S - 1) * S] = sw ? sw[n - 1] : out[(S - 1) * S + 1];
  out[S * S - 1] = se ? se[0] : out[S * S - 2];
  return { data: out, mask };
}
