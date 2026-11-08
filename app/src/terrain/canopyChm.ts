/**
 * v3 canopy without a `dsm` (contract "No dsm in v3; canopy from DTM + CHM"): DSM = DTM + CHM per
 * cell. Pure.
 */

/** Manifest key of the canopy height model (u8, 0–40 m). */
export const CHM_KEY = 'chm';

/**
 * DSM height image (side², same 1-cell apron as the DTM) = `dtm` + decoded CHM. `chmApron` is the
 * CHM layer with its 1-texel apron ((n+2)² = side², texel p ↔ height pixel p, see layerApron.ts),
 * `min`/`max` its manifest decode range.
 */
export function dsmFromChm(dtm: Float32Array, chmApron: Uint8Array, min: number, max: number, out = new Float32Array(dtm.length)): Float32Array {
  if (chmApron.length !== dtm.length) throw new Error(`chm apron ${chmApron.length} ≠ dtm ${dtm.length} samples`);
  const s = (max - min) / 255;
  for (let k = 0; k < dtm.length; k++) out[k] = dtm[k] + min + chmApron[k] * s;
  return out;
}

/** DSM at one point from a bilinear DTM height and a bilinear CHM value (u8 decoded). */
export function dsmAt(dtmH: number, chmU8: number, min: number, max: number): number {
  return dtmH + min + (chmU8 / 255) * (max - min);
}
