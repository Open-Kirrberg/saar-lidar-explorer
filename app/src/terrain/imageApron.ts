/**
 * 1-texel apron for `rgb` image textures (seam fix for orthophoto / historic maps, cf. layerApron.ts).
 * Chunk images have no apron (contract), so bilinear sampling clamps in the outer half texel and
 * shows a flat band + step at every chunk edge. The image is drawn into a (P+2)² canvas whose border
 * holds the neighbours' edge pixels (or the own edge = clamp while a neighbour is missing); when a
 * neighbour arrives later, only its 1-px strip is written into the GPU texture
 * (`renderer.copyTextureToTexture`, which also regenerates the mipmaps). Each chunk keeps only its
 * four edge strips (4·P·4 bytes) on the CPU.
 */
import { DataTexture, RGBAFormat, UnsignedByteType, Vector2 } from 'three';
import type { Texture, WebGLRenderer } from 'three';
import { opposite, SIDE_BIT, SIDE_OFFSET, SIDES } from './imageSides';
import type { Side } from './imageSides';

export { opposite, SIDE_BIT, SIDE_OFFSET, SIDES };
export type { Side };

/** Edge pixel strips (RGBA8, sRGB bytes) of one chunk image of side P: n/s rows, w/e columns. */
export interface ImageEdges {
  size: number;
  n: Uint8ClampedArray;
  s: Uint8ClampedArray;
  w: Uint8ClampedArray;
  e: Uint8ClampedArray;
}

/**
 * Compose the (P+2)² apron canvas of `bmp` (P × P). `neighbour(side)` returns the edges of the
 * same-level neighbour on that side (same P), or undefined (→ own edge). Returns the canvas, the
 * image's own edges and the mask (SIDE_BIT) of neighbours used.
 */
export function composeImageApron(
  bmp: ImageBitmap,
  neighbour: (side: Side) => ImageEdges | undefined,
): { canvas: OffscreenCanvas; edges: ImageEdges; mask: number } {
  const P = bmp.width;
  const S = P + 2;
  const canvas = new OffscreenCanvas(S, S);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
  ctx.drawImage(bmp, 1, 1);
  const grab = (x: number, y: number, w: number, h: number) => ctx.getImageData(x, y, w, h, { colorSpace: 'srgb' }).data;
  const edges: ImageEdges = { size: P, n: grab(1, 1, P, 1), s: grab(1, P, P, 1), w: grab(1, 1, 1, P), e: grab(P, 1, 1, P) };
  let mask = 0;
  const strip = (side: Side): Uint8ClampedArray => {
    const nb = neighbour(side);
    if (nb && nb.size === P) {
      mask |= SIDE_BIT[side];
      return nb[opposite(side)];
    }
    return edges[side];
  };
  const put = (data: Uint8ClampedArray, x: number, y: number, w: number, h: number) =>
    ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h, { colorSpace: 'srgb' }), x, y);
  const n = strip('n');
  const s = strip('s');
  const w = strip('w');
  const e = strip('e');
  put(n, 1, 0, P, 1);
  put(s, 1, S - 1, P, 1);
  put(w, 0, 1, 1, P);
  put(e, S - 1, 1, 1, P);
  // Corners: copy the adjacent north/south apron texel (diagonal neighbours are not used).
  const px = (a: Uint8ClampedArray, k: number) => a.subarray(4 * k, 4 * k + 4);
  put(px(n, 0), 0, 0, 1, 1);
  put(px(n, P - 1), S - 1, 0, 1, 1);
  put(px(s, 0), 0, S - 1, 1, 1);
  put(px(s, P - 1), S - 1, S - 1, 1, 1);
  return { canvas, edges, mask };
}

/** Destination of side `side`'s apron strip in a (P+2)² texture and its size. */
export function stripRegion(side: Side, P: number): { x: number; y: number; w: number; h: number } {
  switch (side) {
    case 'n':
      return { x: 1, y: 0, w: P, h: 1 };
    case 's':
      return { x: 1, y: P + 1, w: P, h: 1 };
    case 'w':
      return { x: 0, y: 1, w: 1, h: P };
    default:
      return { x: P + 1, y: 1, w: 1, h: P };
  }
}

/** Write `data` (the neighbour's edge) into apron side `side` of `dst` on the GPU (+ mipmaps). */
export function patchImageApron(renderer: WebGLRenderer, dst: Texture, side: Side, data: Uint8ClampedArray, P: number): void {
  const r = stripRegion(side, P);
  const src = new DataTexture(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), r.w, r.h, RGBAFormat, UnsignedByteType);
  renderer.copyTextureToTexture(src, dst, null, new Vector2(r.x, r.y));
  src.dispose();
}
