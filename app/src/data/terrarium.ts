/**
 * Terrarium height encoding (see docs/data-contract.md):
 *   h = (R·256 + G + B/256) − 32768   [metres], ≈ 3.9 mm quantisation step.
 * Pure functions, shared by the browser worker, the fixture generator and tests.
 */

export const TERRARIUM_OFFSET = 32768;

/** Encode one height (metres) into Terrarium R, G, B bytes (round-to-nearest 1/256 m). */
export function encodeTerrarium(h: number): [number, number, number] {
  const v = Math.round((h + TERRARIUM_OFFSET) * 256);
  const clamped = Math.min(Math.max(v, 0), 0xffffff);
  return [(clamped >> 16) & 0xff, (clamped >> 8) & 0xff, clamped & 0xff];
}

export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - TERRARIUM_OFFSET;
}

/**
 * Decode interleaved pixels (RGBA from ImageData, or RGB) to a Float32Array of heights.
 * @param channels 4 for RGBA (ImageData), 3 for packed RGB.
 */
export function decodeTerrarium(
  pixels: ArrayLike<number>,
  count: number,
  channels: 3 | 4 = 4,
): Float32Array {
  const out = new Float32Array(count);
  for (let k = 0, o = 0; k < count; k++, o += channels) {
    out[k] = pixels[o] * 256 + pixels[o + 1] + pixels[o + 2] / 256 - TERRARIUM_OFFSET;
  }
  return out;
}

/** Encode heights into an RGBA buffer (alpha 255), e.g. for PNG writers. */
export function encodeTerrariumRGBA(heights: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(heights.length * 4);
  for (let k = 0; k < heights.length; k++) {
    const [r, g, b] = encodeTerrarium(heights[k]);
    out[k * 4] = r;
    out[k * 4 + 1] = g;
    out[k * 4 + 2] = b;
    out[k * 4 + 3] = 255;
  }
  return out;
}
