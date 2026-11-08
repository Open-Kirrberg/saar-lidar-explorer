/**
 * TypeScript reference of the live relief method `rvt-vat-combined-v1` (data contract "Derived
 * relief modes"; = pipeline/build.py VAT_GENERAL / VAT_FLAT through rvt.blend_func). The GLSL twin
 * is `liveVat()` in terrain.frag.glsl — keep both in sync (tests/liveVat.test.ts). Pure.
 */

/** Preset (s_max °, o_min °, o_max °, v_min). */
export type VatPreset = readonly [number, number, number, number];
export const VAT_GENERAL: VatPreset = [50, 68, 93, 0.7];
export const VAT_FLAT: VatPreset = [15, 85, 91, 0.9];
/** Fixed single-direction sun of the VAT hillshade (independent of the UI sun). */
export const VAT_SUN_AZ_DEG = 315;
export const VAT_SUN_EL_DEG = 35;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DEG = Math.PI / 180;
const SIN_E = Math.sin(VAT_SUN_EL_DEG * DEG);
const COS_E = Math.cos(VAT_SUN_EL_DEG * DEG);
const LE = COS_E * Math.sin(VAT_SUN_AZ_DEG * DEG);
const LN = COS_E * Math.cos(VAT_SUN_AZ_DEG * DEG);

/**
 * Hillshade for gradient (∂h/∂E, ∂h/∂N) in m/m: clamp(n · L, 0, 1), n = normalize(−∂h/∂E, −∂h/∂N, 1),
 * L = (cos e · sin a, cos e · cos a, sin e) in (east, north, up).
 */
export function vatHillshade(dE: number, dN: number): number {
  const len = Math.hypot(dE, dN, 1);
  return clamp01((-dE * LE - dN * LN + SIN_E) / len);
}

/** Slope in degrees: atan(|∇h|). */
export function slopeDeg(dE: number, dN: number): number {
  return Math.atan(Math.hypot(dE, dN)) / DEG;
}

/** One preset: slope (luminosity 50 %) → positive openness (overlay, full strength, rvt quirk) → svf (multiply 25 %). */
export function vatPreset(hs: number, sDeg: number, svf: number, opnsPos: number, p: VatPreset): number {
  const [sMax, oMin, oMax, vMin] = p;
  const r1 = 0.5 * (1 - clamp01(sDeg / sMax)) + 0.5 * hs;
  const o = clamp01((opnsPos - oMin) / (oMax - oMin));
  const r2 = r1 > 0.5 ? 1 - (1 - 2 * (r1 - 0.5)) * (1 - o) : 2 * r1 * o;
  const v = clamp01((svf - vMin) / (1 - vMin));
  return 0.75 * r2 + 0.25 * v * r2;
}

/** VAT ∈ [0, 1] from the true-height gradient (m/m), svf (0–1) and positive openness (°). */
export function liveVat(dE: number, dN: number, svf: number, opnsPos: number): number {
  const hs = vatHillshade(dE, dN);
  const s = slopeDeg(dE, dN);
  return 0.5 * vatPreset(hs, s, svf, opnsPos, VAT_GENERAL) + 0.5 * vatPreset(hs, s, svf, opnsPos, VAT_FLAT);
}

/** u8 decode `min + v/255 · (max − min)`. */
export const decodeU8 = (v: number, min: number, max: number) => min + (v / 255) * (max - min);

/**
 * Live VAT over an n×n chunk: `heights` = the (n+2)² height image with apron (row 0 = north, 1 m
 * cells), svf / opns u8 n×n images with their manifest ranges. Gradient = central differences on
 * the cell centres (the apron supplies the neighbours). Returns VAT in [0, 1] per cell (n²).
 */
export function liveVatChunk(
  heights: Float32Array,
  svfU8: Uint8Array,
  opnsU8: Uint8Array,
  n: number,
  svfRange: { min: number; max: number },
  opnsRange: { min: number; max: number },
  cellSize = 1,
): Float32Array {
  const S = n + 2;
  const out = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const p = (r + 1) * S + c + 1;
      const dE = (heights[p + 1] - heights[p - 1]) / (2 * cellSize);
      // Row r grows southwards: ∂h/∂N = (north − south) / 2.
      const dN = (heights[p - S] - heights[p + S]) / (2 * cellSize);
      const k = r * n + c;
      out[k] = liveVat(dE, dN, decodeU8(svfU8[k], svfRange.min, svfRange.max), decodeU8(opnsU8[k], opnsRange.min, opnsRange.max));
    }
  }
  return out;
}

/** Mean and p99 of |a·255 − b| (VAT in [0, 1] vs baked u8) — the contract's tolerance metric. */
export function vatError(live: Float32Array, baked: Uint8Array): { mean: number; p99: number; max: number } {
  const d = new Float32Array(live.length);
  let sum = 0;
  let max = 0;
  for (let k = 0; k < live.length; k++) {
    const e = Math.abs(Math.round(clamp01(live[k]) * 255) - baked[k]);
    d[k] = e;
    sum += e;
    if (e > max) max = e;
  }
  d.sort();
  return { mean: sum / Math.max(1, live.length), p99: d[Math.min(d.length - 1, Math.floor(0.99 * d.length))] ?? 0, max };
}
