/**
 * Overview-level downsampling per docs/data-contract.md "Levels (v2)" (pure; used by the
 * fixture generator and tests): level-k cell = mean of the 2^k × 2^k block of 1 m cells, the
 * raster edge-padded (indices clamped) to a multiple of 2^k → ceil(w/2^k) × ceil(h/2^k) cells.
 */
export function blockMean(src: Float32Array, w: number, h: number, f: number): { data: Float32Array; width: number; height: number } {
  const W = Math.ceil(w / f);
  const H = Math.ceil(h / f);
  const out = new Float32Array(W * H);
  const inv = 1 / (f * f);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let s = 0;
      for (let y = 0; y < f; y++) {
        const row = Math.min(r * f + y, h - 1) * w;
        for (let x = 0; x < f; x++) s += src[row + Math.min(c * f + x, w - 1)];
      }
      out[r * W + c] = s * inv;
    }
  }
  return { data: out, width: W, height: H };
}
